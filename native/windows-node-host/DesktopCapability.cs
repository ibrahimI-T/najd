using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using UIA = Interop.UIAutomationClient;
using OpenClaw.Shared;

// Desktop windows for NAJD (docs/AGENT-PLATFORM-M2-PLAN.md, M2d): list visible windows, open a fixed app or a
// file NAJD validated, read a window's UI Automation tree, and act on one element. NAJD approves in Electron;
// this host re-checks the live target immediately before acting (M2-002) and refuses sensitive fields such as
// passwords, card numbers and verification codes (M2-001). It never acts on its own elevated rights.
sealed class DesktopCapability : NodeCapabilityBase
{
    // Web and Electron windows (Claude, VS Code, browsers) nest their content 15 to 25 levels deep; the earlier depth of 14 cut off every
    // chat, document and input in them (measured 2026-11-10 on the Claude app: 50 of 385 controls read, its input at depth 16 never reached).
    private const int MaxElements = 800, MaxSearch = 6000, MaxDepth = 64;
    // Unnamed groups, panes and custom wrappers carry no meaning of their own: they are walked through but not listed.
    private static readonly HashSet<int> Structural = [50026, 50033, 50025];
    // Field labels that mean credentials, payment or one-time codes (English and Arabic).
    private static readonly Regex Sensitive = new(
        @"pass(word|code|phrase)?|\bpin\b|otp|one[- ]?time|verification\s*code|security\s*code|2fa|card\s*(number|no)|credit|debit|\bcvv|\bcvc|expir|\biban\b|swift|routing|account\s*(number|no)|\bacct|كلمة\s*(المرور|السر)|الرقم\s*السري|رقم\s*البطاقة|البطاقة|رمز\s*(التحقق|الأمان)|آيبان|ايبان|الآيبان|رقم\s*الحساب|تاريخ\s*الانتهاء",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    // Windows whose unlabeled fields are treated as sensitive (conservative refusal).
    private static readonly Regex SensitiveWindow = new(
        @"\bpay(ment)?\b|checkout|\bbank|sign[- ]?in|log[- ]?in|wallet|الدفع|دفع|بنك|تسجيل\s*الدخول|محفظة",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public DesktopCapability() : base(NullLogger.Instance) { }
    public override string Category => "najd";
    public override IReadOnlyList<string> Commands => ["najd.desktop.windows", "najd.desktop.open", "najd.desktop.read", "najd.desktop.act"];

    public override async Task<NodeInvokeResponse> ExecuteAsync(NodeInvokeRequest request)
    {
        if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return Error("ADMIN_NOT_ALLOWED");
        try
        {
            return await Task.Run(() => request.Command switch
            {
                "najd.desktop.windows" => Success(Windows()),
                "najd.desktop.open" => Open(request.Args),
                "najd.desktop.read" => Read(request.Args),
                "najd.desktop.act" => request.Args.TryGetProperty("point", out _) ? ActAtPoint(request.Args) : Act(request.Args),
                _ => Error("PERMISSION_DENIED")
            });
        }
        catch (COMException) { return Error("DESKTOP_ACTION_FAILED"); }
        catch (InvalidOperationException) { return Error("STALE_TARGET"); }
        catch { return Error("DESKTOP_ACTION_FAILED"); }
    }

    private static long? Created(int pid)
    {
        try { using var process = Process.GetProcessById(pid); return process.StartTime.ToFileTimeUtc(); } catch { return null; }
    }

    private static object[] Windows()
    {
        var result = new List<object>();
        EnumWindows((window, _) =>
        {
            if (!IsWindowVisible(window) || GetWindowTextLength(window) == 0 || result.Count >= 60) return true;
            var title = WindowTitle(window);
            GetWindowThreadProcessId(window, out var pid);
            var created = Created((int)pid);
            if (created is null) return true; // a process this user cannot inspect (for example elevated): not listed
            string name;
            try { using var process = Process.GetProcessById((int)pid); name = process.ProcessName; } catch { return true; }
            // FILETIME values exceed JavaScript's exact integers, so the creation time travels as a string.
            // The full title identifies the window; one too long to show in full for approval is marked (M2-R27-001).
            result.Add(new { window = window.ToInt64().ToString(), title, titleTooLong = title.Length > MaxShownTitle, process = name, pid = (int)pid, created = created.Value.ToString() });
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }

    // Programs the user asks to open start in the user's own environment (NAJD passes it as NAJD_USER_*), so a browser
    // opens with the user's profile and sign-ins instead of the host's private folders. Restored right after.
    private static Process? StartAsUser(ProcessStartInfo info)
    {
        var saved = new Dictionary<string, string?>();
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            var key = (string)entry.Key;
            if (!key.StartsWith("NAJD_USER_", StringComparison.Ordinal)) continue;
            var name = key["NAJD_USER_".Length..];
            saved[name] = Environment.GetEnvironmentVariable(name);
            Environment.SetEnvironmentVariable(name, (string?)entry.Value);
        }
        try { return Process.Start(info); }
        finally { foreach (var (name, value) in saved) Environment.SetEnvironmentVariable(name, value); }
    }

    private NodeInvokeResponse Open(JsonElement args)
    {
        var app = GetStringArg(args, "app");
        var file = GetStringArg(args, "file");
        var url = GetStringArg(args, "url");
        // Windows Settings opens through its own protocol (ms-settings:), the way Start opens it.
        if (app == "settings")
        {
            if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED");
            using var settings = StartAsUser(new ProcessStartInfo("ms-settings:") { UseShellExecute = true });
            return Success(new { opened = true, app });
        }
        if (!string.IsNullOrEmpty(url))
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) || url.Length > 2000) return Error("INVALID_INPUT");
            if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED");
            if (!string.IsNullOrEmpty(app))
            {
                if (app is not ("edge" or "chrome")) return Error("INVALID_INPUT");
                var executable = WindowsAppPaths.Find(app)?.Path;
                if (executable is null) return Error("NOT_FOUND");
                var start = new ProcessStartInfo(executable) { UseShellExecute = false };
                start.ArgumentList.Add(uri.AbsoluteUri);
                using var named = StartAsUser(start);
                return Success(new { opened = true, app, url = uri.AbsoluteUri });
            }
            using var browser = StartAsUser(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            return Success(new { opened = true, url = uri.AbsoluteUri });
        }
        // Any installed app by the AppID the Start menu lists for it (NAJD read it with Get-StartApps); it opens the
        // way Start opens it, through shell:AppsFolder.
        var appId = GetStringArg(args, "appId");
        if (!string.IsNullOrEmpty(appId))
        {
            if (appId.Length > 512 || appId.Any(c => char.IsControl(c) || c == '"')) return Error("INVALID_INPUT");
            if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED");
            var shellExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
            using var launched = StartAsUser(new ProcessStartInfo(shellExe, "\"shell:AppsFolder\\" + appId + "\"") { UseShellExecute = true });
            return Success(new { opened = true, appId });
        }
        if (!string.IsNullOrEmpty(app))
        {
            var system = Environment.SystemDirectory;
            var executable = app switch
            {
                "notepad" => Path.Combine(system, "notepad.exe"),
                "calc" => Path.Combine(system, "calc.exe"),
                "mspaint" => Path.Combine(system, "mspaint.exe"),
                "explorer" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"),
                "taskmgr" => Path.Combine(system, "Taskmgr.exe"),
                "control" => Path.Combine(system, "control.exe"),
                "chrome" or "edge" => WindowsAppPaths.Find(app)?.Path,
                _ => null
            };
            if (executable is null || !File.Exists(executable)) return Error("NOT_FOUND");
            if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED"); // the task was cancelled while this waited (M2-R11-002)
            using var started = StartAsUser(new ProcessStartInfo(executable) { UseShellExecute = true });
            return Success(new { opened = true, app });
        }
        // NAJD validated the path against the workspace and granted folders before sending it.
        if (string.IsNullOrEmpty(file) || !Path.IsPathFullyQualified(file) || !(File.Exists(file) || Directory.Exists(file))) return Error("NOT_FOUND");
        if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED");
        using var opened = StartAsUser(new ProcessStartInfo(file) { UseShellExecute = true });
        return Success(new { opened = true, file });
    }

    // The window must still belong to the same process instance it was read from (handle reuse is refused).
    private static IntPtr Resolve(JsonElement args)
    {
        var raw = args.TryGetProperty("window", out var w) ? w.GetString() : null;
        if (!long.TryParse(raw, out var handle) || !args.TryGetProperty("pid", out var pidElement) || !args.TryGetProperty("created", out var createdElement))
            throw new InvalidOperationException();
        var window = new IntPtr(handle);
        if (!IsWindow(window)) throw new InvalidOperationException();
        GetWindowThreadProcessId(window, out var pid);
        if ((int)pid != pidElement.GetInt32() || !long.TryParse(createdElement.GetString(), out var created) || Created((int)pid) != created) throw new InvalidOperationException();
        return window;
    }

    private static string RuntimeId(UIA.IUIAutomationElement element)
    {
        try { return string.Join(".", ((Array)element.GetRuntimeId()).Cast<object>()); } catch { return ""; }
    }

    // Identifiers as words: "card_number", "account-number", "cardNumber" and "CVVCode" become "card number",
    // "account number", "card Number" and "CVV Code", so the sensitive-label check sees them (M2-R26-003).
    private static string Words(string label) =>
        Regex.Replace(Regex.Replace(Regex.Replace(label, "([a-z0-9])([A-Z])", "$1 $2"), "([A-Z]+)([A-Z][a-z])", "$1 $2"), @"[_\-\.]+", " ");

    private static string Clip(string? value, int size) => value is null ? "" : value.Length > size ? value[..size] : value;

    // Identity of an element's full attributes (not the clipped text shown to the model), so a change anywhere in
    // its name or automation id makes an approved target stale (M2-R5-005).
    private static string TargetKey(UIA.IUIAutomationElement element) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(
            (element.CurrentName ?? "") + "\0" + (element.CurrentAutomationId ?? "") + "\0" + element.CurrentControlType)));

    // The whole title, however long (not a fixed-size prefix), so a change anywhere in it is seen (M2-R27-001).
    internal const int MaxShownTitle = 1000;
    internal static string WindowTitle(IntPtr window)
    {
        var length = Math.Max(0, GetWindowTextLength(window));
        var title = new StringBuilder(length + 2); GetWindowText(window, title, title.Capacity); return title.ToString();
    }

    // Generic automation ids (textBox1, edit3, txt2) say nothing about a field and do not count as a label.
    private static readonly Regex GenericId = new(@"^(?:(?:textbox|text|edit|input|field|tb|txt|ctl|control|box|entry|element|item|maskedtextbox|combobox|cb)\d*|\d+)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // Text near a field: up to three preceding siblings and the parent's name, as many forms label fields this way
    // without a UI Automation label link (M2-R03).
    private static IEnumerable<string> NearbyLabels(UIA.IUIAutomationTreeWalker walker, UIA.IUIAutomationElement element)
    {
        var sibling = element;
        for (var index = 0; index < 3; index++)
        {
            try { sibling = walker.GetPreviousSiblingElement(sibling); } catch (COMException) { break; }
            if (sibling is null) break;
            string? name = null;
            try { name = sibling.CurrentName; } catch (COMException) { }
            if (!string.IsNullOrWhiteSpace(name)) yield return name;
        }
        string? parent = null;
        try { parent = walker.GetParentElement(element)?.CurrentName; } catch (COMException) { }
        if (!string.IsNullOrWhiteSpace(parent)) yield return parent;
    }

    // Editable: an edit or combo box, or any other control whose value can be written (M2-R2-001).
    private static bool IsEditable(UIA.IUIAutomationElement element)
    {
        if (element.CurrentControlType is 50004 or 50003) return true;
        try { return element.GetCurrentPattern(10002) is UIA.IUIAutomationValuePattern value && value.CurrentIsReadOnly == 0; }
        catch (COMException) { return false; } catch (InvalidCastException) { return false; }
    }

    // Sensitive: a password control; a field whose own name, help text, label link, meaningful automation id or nearby
    // text names credentials, payment or codes; or an editable field in a payment, bank or sign-in window that has no
    // label of its own (conservative refusal, M2-001/M2-R03). Nearby text and the parent's name can only make a field
    // sensitive: they never count as its label, since they may describe the window or a neighbouring field (M2-R2-001).
    private static bool IsSensitive(UIA.IUIAutomationTreeWalker walker, UIA.IUIAutomationElement element, string windowTitle)
    {
        if (element.CurrentIsPassword != 0) return true;
        var own = new List<string> { element.CurrentName ?? "", element.CurrentHelpText ?? "" };
        try { var labeledBy = element.CurrentLabeledBy; if (labeledBy is not null) own.Add(labeledBy.CurrentName ?? ""); } catch (COMException) { }
        var id = element.CurrentAutomationId ?? "";
        if (!GenericId.IsMatch(id)) own.Add(id);
        var editable = IsEditable(element);
        var nearby = editable ? NearbyLabels(walker, element).ToList() : [];
        if (own.Concat(nearby).Any(label => Sensitive.IsMatch(label) || Sensitive.IsMatch(Words(label)))) return true;
        var labelled = own.Any(label => !string.IsNullOrWhiteSpace(label));
        return editable && !labelled && SensitiveWindow.IsMatch(windowTitle);
    }

    private static readonly Dictionary<int, string> Roles = new()
    {
        [50000] = "button", [50002] = "checkbox", [50003] = "combobox", [50004] = "edit", [50005] = "hyperlink", [50007] = "listitem",
        [50008] = "list", [50011] = "menuitem", [50013] = "radio", [50019] = "tab", [50020] = "text", [50024] = "tree", [50032] = "window", [50033] = "pane", [50030] = "document"
    };

    private NodeInvokeResponse Read(JsonElement args)
    {
        var window = Resolve(args);
        var title = WindowTitle(window);
        // Only the window that was approved is read: its title must be the approved one before reading and still be it
        // afterwards, otherwise nothing is returned (M2-R22-001).
        var expectTitle = GetStringArg(args, "title");
        if (expectTitle is null || expectTitle != title) return Error("STALE_TARGET");
        // A minimized Chromium or Electron window (Claude, browsers, VS Code) shows no web content to accessibility: it is restored
        // first, which the result reports (restored). Chromium also builds its tree lazily on the first request, so a sparse read is
        // repeated briefly until the number of controls stops growing (2026-11-10: a minimized test window read 8 controls, no input).
        var restored = false;
        if (IsIconic(window)) { ShowWindow(window, 9); restored = true; Thread.Sleep(400); }
        UIA.IUIAutomation automation = new UIA.CUIAutomation8();
        var root = automation.ElementFromHandle(window);
        var walker = automation.ControlViewWalker;
        (List<object> Elements, bool Complete) Walk()
        {
            var elements = new List<object>();
            var queue = new Queue<(UIA.IUIAutomationElement Element, int Depth)>();
            queue.Enqueue((root, 0));
            // Whether every control was read: the element, depth and queue bounds can leave some out, and that is reported
            // rather than looking like a complete window (M2-R28-002).
            var complete = true;
            while (queue.Count > 0 && elements.Count < MaxElements)
            {
                var (element, depth) = queue.Dequeue();
                try
                {
                    var structural = depth > 0 && Structural.Contains(element.CurrentControlType) && string.IsNullOrWhiteSpace(element.CurrentName);
                    if (structural)
                    {
                        if (depth >= MaxDepth) { try { if (walker.GetFirstChildElement(element) is not null) complete = false; } catch (COMException) { complete = false; } continue; }
                        var inner = walker.GetFirstChildElement(element);
                        for (; inner is not null && queue.Count < MaxSearch; inner = walker.GetNextSiblingElement(inner)) queue.Enqueue((inner, depth + 1));
                        if (inner is not null) complete = false;
                        continue;
                    }
                    var sensitive = IsSensitive(walker, element, title);
                    string? value = null;
                    if (!sensitive)
                        try { value = ((UIA.IUIAutomationValuePattern)element.GetCurrentPattern(10002))?.CurrentValue; } catch (COMException) { } catch (InvalidCastException) { }
                    elements.Add(new
                    {
                        id = RuntimeId(element), name = Clip(element.CurrentName, 200), role = Roles.GetValueOrDefault(element.CurrentControlType, "other"),
                        controlType = element.CurrentControlType, automationId = Clip(element.CurrentAutomationId, 200), enabled = element.CurrentIsEnabled != 0,
                        value = value is null ? null : value.Length > 300 ? value[..300] : value, valueTruncated = value is not null && value.Length > 300, sensitive, key = TargetKey(element),
                        // The name was longer than what is returned, so it cannot be shown in full for approval (M2-R20-002).
                        nameTruncated = (element.CurrentName?.Length ?? 0) > 200
                    });
                    if (depth >= MaxDepth) { try { if (walker.GetFirstChildElement(element) is not null) complete = false; } catch (COMException) { complete = false; } continue; }
                    var child = walker.GetFirstChildElement(element);
                    for (; child is not null && queue.Count < MaxSearch; child = walker.GetNextSiblingElement(child))
                        queue.Enqueue((child, depth + 1));
                    if (child is not null) complete = false;
                }
                // An element or its children could not be inspected (for example it disappeared while reading): coverage can
                // no longer be shown complete (M2-R29-002). Optional patterns such as a missing value are handled above.
                catch (COMException) { complete = false; }
            }
            if (queue.Count > 0) complete = false;
            return (elements, complete);
        }
        var (elements, complete) = Walk();
        for (var attempt = 0; attempt < 5 && (restored || elements.Count < 40); attempt++)
        {
            Thread.Sleep(300);
            var next = Walk();
            if (next.Elements.Count <= elements.Count) break;
            (elements, complete) = next;
        }
        if (WindowTitle(window) != expectTitle) return Error("STALE_TARGET");
        try { if (Resolve(args) != window) return Error("STALE_TARGET"); } catch (InvalidOperationException) { return Error("STALE_TARGET"); }
        return Success(new { title, elements, complete, restored });
    }

    private NodeInvokeResponse Act(JsonElement args)
    {
        var window = Resolve(args);
        var title = WindowTitle(window);
        var target = GetStringArg(args, "element");
        var action = GetStringArg(args, "action");
        var text = GetStringArg(args, "text") ?? "";
        var expectKey = GetStringArg(args, "key") ?? "";
        var expectName = GetStringArg(args, "name") ?? "";
        var expectAutomationId = GetStringArg(args, "automationId") ?? "";
        var expectType = args.TryGetProperty("controlType", out var type) ? type.GetInt32() : -1;
        // The window must still show what was read and approved (its title, as when a document window switches to
        // another document while keeping its toolbar): otherwise the target is stale (M2-R9-002).
        var expectTitle = GetStringArg(args, "title");
        if (expectTitle is null || expectTitle != title) return Error("STALE_TARGET");
        if (string.IsNullOrEmpty(target) || action is not ("invoke" or "setValue" or "select" or "toggle" or "focus" or "click" or "type" or "scroll" or "drag") || text.Length > 4000)
            return Error("INVALID_INPUT");
        UIA.IUIAutomation automation = new UIA.CUIAutomation8();
        var root = automation.ElementFromHandle(window);
        var walker = automation.ControlViewWalker;
        UIA.IUIAutomationElement? Find(string id)
        {
            var queue = new Queue<UIA.IUIAutomationElement>();
            queue.Enqueue(root);
            for (var seen = 0; queue.Count > 0 && seen < MaxSearch; seen++)
            {
                var current = queue.Dequeue();
                if (RuntimeId(current) == id) return current;
                for (var child = walker.GetFirstChildElement(current); child is not null; child = walker.GetNextSiblingElement(child)) queue.Enqueue(child);
            }
            return null;
        }
        var element = Find(target!);
        // The live element must be the one that was read and approved (same runtime id and attributes).
        if (element is null || TargetKey(element) != expectKey || Clip(element.CurrentName, 200) != expectName ||
            Clip(element.CurrentAutomationId, 200) != expectAutomationId || element.CurrentControlType != expectType)
            return Error("STALE_TARGET");
        if (element.CurrentIsEnabled == 0) return Error("ELEMENT_DISABLED");
        if (action == "setValue" && IsSensitive(walker, element, title)) return Error("SENSITIVE_FIELD");
        if (WindowTitle(window) != expectTitle) return Error("STALE_TARGET"); // checked again right before acting
        // Checked immediately before each effect, after any slow preparation: a task cancelled meanwhile does nothing,
        // and a window that now shows something else is stale (M2-R11-002, M2-R12-002).
        // Everything checked before the slow preparation is checked again here, since the control may have changed
        // meanwhile (another label, disabled, now a password or payment field) while keeping its runtime id (M2-R13-001).
        string? BeforeEffect()
        {
            TestHooks.Pause(args);
            if (OperationCancellation.Token.IsCancellationRequested) return "CANCELLED";
            try { if (Resolve(args) != window) return "STALE_TARGET"; } catch (InvalidOperationException) { return "STALE_TARGET"; }
            if (WindowTitle(window) != expectTitle) return "STALE_TARGET";
            try
            {
                if (RuntimeId(element) != target || TargetKey(element) != expectKey || Clip(element.CurrentName, 200) != expectName ||
                    Clip(element.CurrentAutomationId, 200) != expectAutomationId || element.CurrentControlType != expectType) return "STALE_TARGET";
                if (element.CurrentIsEnabled == 0) return "ELEMENT_DISABLED";
                if (action == "setValue" && IsSensitive(walker, element, title)) return "SENSITIVE_FIELD";
            }
            catch (COMException) { return "STALE_TARGET"; } // the control went away
            return null;
        }
        // The real Windows pointer moves to the control before any effect, so the owner sees what NAJD is about to do
        // ("follow": a short glide, "fast": a jump, "off": no move except for a real click). If the owner moved the mouse since
        // NAJD last placed it, nothing is done: the owner has taken over (USER_ACTIVE) and the model must ask before continuing.
        var pointer = GetStringArg(args, "pointer") is "fast" or "off" ? GetStringArg(args, "pointer")! : "follow";
        if (!OwnerApproved(args) && UserTookOver()) return Error("USER_ACTIVE");
        var center = Center(element);
        if (center is { } spot && pointer != "off" && action != "click") MovePointer(spot.X, spot.Y, pointer);
        object verified;
        switch (action)
        {
            case "click":
            {
                // A real left click at the control's centre, for web and Electron controls that offer no pattern. The point must
                // land on this window (not on another window covering it).
                if (center is not { } point) return Error("NO_POSITION");
                if (GetAncestor(WindowFromPoint(new POINT { X = point.X, Y = point.Y }), 2) != window) return Error("TARGET_COVERED");
                var before = Observe(automation, window, element);
                if (BeforeEffect() is { } refusedClick) return Error(refusedClick);
                MovePointer(point.X, point.Y, pointer == "off" ? "fast" : pointer);
                Click();
                string after = before;
                for (var attempt = 0; attempt < 10 && after == before; attempt++) { Thread.Sleep(100); after = Observe(automation, window, element); }
                verified = new { verified = after != before, changed = after != before, at = new { x = point.X, y = point.Y }, note = after != before ? "the window changed after the click" : "clicked; no visible change was observed" };
                break;
            }
            case "drag":
            {
                // A real drag from this control's centre onto another control of the same window, both from the latest read
                // (2026-11-13): press, glide, release. The destination must still be the control that was read and approved, and
                // both ends must land on this window, as for a click.
                if (!args.TryGetProperty("to", out var dest) || dest.ValueKind != JsonValueKind.Object) return Error("INVALID_INPUT");
                var destId = GetStringArg(dest, "element");
                if (string.IsNullOrEmpty(destId) || destId == target) return Error("INVALID_INPUT");
                var destKey = GetStringArg(dest, "key") ?? ""; var destName = GetStringArg(dest, "name") ?? ""; var destAutomationId = GetStringArg(dest, "automationId") ?? "";
                var destType = dest.TryGetProperty("controlType", out var dt) ? dt.GetInt32() : -1;
                var destination = Find(destId!);
                bool DestinationIsRead() { try { return destination is not null && RuntimeId(destination) == destId && TargetKey(destination) == destKey && Clip(destination.CurrentName, 200) == destName && Clip(destination.CurrentAutomationId, 200) == destAutomationId && destination.CurrentControlType == destType; } catch (COMException) { return false; } }
                if (!DestinationIsRead()) return Error("STALE_TARGET");
                if (center is not { } from || Center(destination!) is not { } end) return Error("NO_POSITION");
                if (GetAncestor(WindowFromPoint(new POINT { X = from.X, Y = from.Y }), 2) != window || GetAncestor(WindowFromPoint(new POINT { X = end.X, Y = end.Y }), 2) != window) return Error("TARGET_COVERED");
                var beforeDrag = Observe(automation, window, element);
                if (BeforeEffect() is { } refusedDrag) return Error(refusedDrag);
                if (!DestinationIsRead()) return Error("STALE_TARGET");
                MovePointer(from.X, from.Y, pointer == "off" ? "fast" : pointer);
                Button(true); Thread.Sleep(60);
                MovePointer(end.X, end.Y, "follow");
                Thread.Sleep(60); Button(false);
                MarkOwnInput();
                string afterDrag = beforeDrag;
                for (var attempt = 0; attempt < 10 && afterDrag == beforeDrag; attempt++) { Thread.Sleep(100); afterDrag = Observe(automation, window, element); }
                verified = new { verified = afterDrag != beforeDrag, from = new { x = from.X, y = from.Y }, to = new { x = end.X, y = end.Y }, note = afterDrag != beforeDrag ? "the window changed after the drag" : "dragged; no change was observed" };
                break;
            }
            case "scroll":
            {
                // The real mouse wheel over the control (text: up, down, left or right, optionally a count 1-10 as in "down 3").
                // Confirmed when a scrollable ancestor's position changed or the window's visible text did.
                if (center is not { } wheelPoint) return Error("NO_POSITION");
                if (GetAncestor(WindowFromPoint(new POINT { X = wheelPoint.X, Y = wheelPoint.Y }), 2) != window) return Error("TARGET_COVERED");
                var parts = text.Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var direction = parts.Length > 0 ? parts[0] : "down";
                if (direction is not ("up" or "down" or "left" or "right")) return Error("INVALID_INPUT");
                var notches = parts.Length > 1 && int.TryParse(parts[1], out var n) ? Math.Clamp(n, 1, 10) : 3;
                var scroller = ScrollAncestor(walker, element);
                var beforeScroll = ScrollPosition(scroller); var beforeText = Observe(automation, window, element);
                if (BeforeEffect() is { } refusedScroll) return Error(refusedScroll);
                MovePointer(wheelPoint.X, wheelPoint.Y, pointer == "off" ? "fast" : pointer);
                Wheel(direction, notches);
                var moved = false;
                for (var attempt = 0; attempt < 10 && !moved; attempt++) { Thread.Sleep(80); moved = ScrollPosition(scroller) != beforeScroll || Observe(automation, window, element) != beforeText; }
                verified = new { verified = moved, at = new { x = wheelPoint.X, y = wheelPoint.Y }, note = moved ? "scrolled" : "the wheel was turned; no change was observed (already at the end, or this view does not report its position)" };
                break;
            }
            case "type":
            {
                // Real keystrokes into the control (rich editors in web and Electron apps ignore programmatic values). Typing never
                // presses Enter alone, so it never sends: a line break is Shift+Enter. The text is read back to confirm it arrived.
                if (BeforeEffect() is { } refusedType) return Error(refusedType);
                try { element.SetFocus(); } catch (COMException) { }
                Thread.Sleep(60);
                if (element.CurrentHasKeyboardFocus == 0 && center is { } focusPoint && GetAncestor(WindowFromPoint(new POINT { X = focusPoint.X, Y = focusPoint.Y }), 2) == window) { MovePointer(focusPoint.X, focusPoint.Y, "fast"); Click(); Thread.Sleep(80); }
                if (element.CurrentHasKeyboardFocus == 0) return Error("NOT_FOCUSABLE");
                TypeText(text);
                var lastLine = text.Replace("\r\n", "\n").Split('\n')[^1];
                var seen = false;
                for (var attempt = 0; attempt < 20 && !seen; attempt++) { seen = ReadText(element).Contains(lastLine, StringComparison.Ordinal); if (!seen) Thread.Sleep(50); }
                verified = new { verified = seen, at = center is { } typedAt ? new { x = typedAt.X, y = typedAt.Y } : null, note = seen ? "the typed text is in the field" : "typed; the text could not be read back from the field" };
                break;
            }
            case "setValue":
            {
                var pattern = (UIA.IUIAutomationValuePattern)element.GetCurrentPattern(10002) ?? throw new InvalidOperationException();
                if (pattern.CurrentIsReadOnly != 0) return Error("READ_ONLY");
                if (BeforeEffect() is { } refusedSet) return Error(refusedSet);
                pattern.SetValue(text);
                var ok = false;
                // Rich editors report an empty field as a single line break: compared without trailing line breaks (2026-11-10).
                for (var attempt = 0; attempt < 20 && !ok; attempt++) { ok = (pattern.CurrentValue ?? "").TrimEnd('\r', '\n') == text.TrimEnd('\r', '\n'); if (!ok) Thread.Sleep(50); }
                verified = new { verified = ok, value = ok ? text : null, at = AtOf(center) };
                break;
            }
            case "toggle":
            {
                var pattern = (UIA.IUIAutomationTogglePattern)element.GetCurrentPattern(10015) ?? throw new InvalidOperationException();
                var before = pattern.CurrentToggleState;
                if (BeforeEffect() is { } refusedToggle) return Error(refusedToggle);
                pattern.Toggle();
                verified = new { verified = pattern.CurrentToggleState != before, state = pattern.CurrentToggleState.ToString(), at = AtOf(center) };
                break;
            }
            case "select":
            {
                var pattern = (UIA.IUIAutomationSelectionItemPattern)element.GetCurrentPattern(10010) ?? throw new InvalidOperationException();
                if (BeforeEffect() is { } refusedSelect) return Error(refusedSelect);
                pattern.Select();
                verified = new { verified = pattern.CurrentIsSelected != 0, at = AtOf(center) };
                break;
            }
            case "focus":
                if (BeforeEffect() is { } refusedFocus) return Error(refusedFocus);
                element.SetFocus();
                verified = new { verified = element.CurrentHasKeyboardFocus != 0, at = AtOf(center) };
                break;
            default:
            {
                var invoke = element.GetCurrentPattern(10000) as UIA.IUIAutomationInvokePattern;
                if (invoke is null) return Error("NOT_INVOKABLE");
                // Pressing has no generic postcondition, so the result is what was observed to change (M2-R18): the
                // window's title or text, its process's windows, or the pressed control itself.
                var before = Observe(automation, window, element);
                if (BeforeEffect() is { } refusedInvoke) return Error(refusedInvoke);
                invoke.Invoke();
                string after = before;
                for (var attempt = 0; attempt < 10 && after == before; attempt++) { Thread.Sleep(100); after = Observe(automation, window, element); }
                verified = new { verified = after != before, changed = after != before, at = AtOf(center), note = after != before ? "the window changed after pressing" : "pressed; no visible change was observed" };
                break;
            }
        }
        return Success(verified);
    }

    // A bounded fingerprint of what a user would notice: title, the pressed control, the first visible texts, and
    // how many windows the same process has.
    private static string Observe(UIA.IUIAutomation automation, IntPtr window, UIA.IUIAutomationElement pressed)
    {
        var parts = new StringBuilder(IsWindow(window) ? WindowTitle(window) : "<closed>");
        try { parts.Append('|').Append(pressed.CurrentName).Append('|').Append(pressed.CurrentIsEnabled); } catch (COMException) { parts.Append("|<gone>"); }
        try
        {
            var walker = automation.ControlViewWalker; var queue = new Queue<UIA.IUIAutomationElement>(); queue.Enqueue(automation.ElementFromHandle(window));
            for (var seen = 0; queue.Count > 0 && seen < 800; seen++)
            {
                var current = queue.Dequeue();
                parts.Append('|').Append(current.CurrentName);
                try { parts.Append('=').Append(((UIA.IUIAutomationValuePattern)current.GetCurrentPattern(10002))?.CurrentValue); } catch (COMException) { } catch (InvalidCastException) { }
                for (var child = walker.GetFirstChildElement(current); child is not null; child = walker.GetNextSiblingElement(child)) queue.Enqueue(child);
            }
        }
        catch (COMException) { }
        GetWindowThreadProcessId(window, out var pid);
        var windows = 0;
        EnumWindows((candidate, _) => { GetWindowThreadProcessId(candidate, out var owner); if (owner == pid && IsWindowVisible(candidate)) windows++; return true; }, IntPtr.Zero);
        return parts.Append("|windows=").Append(windows).ToString();
    }



    // Visual route (2026-11-10): a window that shows its content to accessibility only partly or not at all (a fresh Chromium or
    // Electron window, a game, a canvas) is acted on at a point the model chose from this window's screenshot. The point arrives as
    // thousandths of the window's width and height, so it maps to the window's current place and size on any display scale. The
    // point must land on this window; typing first clicks there and is refused when the focused field is sensitive; Enter is never
    // pressed by typing.
    private NodeInvokeResponse ActAtPoint(JsonElement args)
    {
        var window = Resolve(args);
        var expectTitle = GetStringArg(args, "title");
        if (expectTitle is null || WindowTitle(window) != expectTitle) return Error("STALE_TARGET");
        var action = GetStringArg(args, "action");
        var text = GetStringArg(args, "text") ?? "";
        if (action is not ("click" or "type" or "drag") || text.Length > 4000) return Error("INVALID_INPUT");
        var point = args.GetProperty("point");
        var px = point.GetProperty("x").GetInt32(); var py = point.GetProperty("y").GetInt32();
        if (px < 0 || px > 1000 || py < 0 || py > 1000) return Error("INVALID_INPUT");
        if (!OwnerApproved(args) && UserTookOver()) return Error("USER_ACTIVE");
        if (IsIconic(window)) { ShowWindow(window, 9); Thread.Sleep(300); }
        GetWindowRect(window, out var rect);
        var x = rect.Left + (int)Math.Round((rect.Right - rect.Left) * px / 1000.0);
        var y = rect.Top + (int)Math.Round((rect.Bottom - rect.Top) * py / 1000.0);
        if (GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2) != window) return Error("TARGET_COVERED");
        UIA.IUIAutomation automation = new UIA.CUIAutomation8();
        var root = automation.ElementFromHandle(window);
        var before = Observe(automation, window, root);
        TestHooks.Pause(args);
        if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED");
        if (WindowTitle(window) != expectTitle) return Error("STALE_TARGET");
        var pointer = GetStringArg(args, "pointer") is "off" ? "fast" : GetStringArg(args, "pointer") is "fast" ? "fast" : "follow";
        if (action == "drag")
        {
            // A real drag from the point to a second point of the same window ("to", thousandths): press, glide, release.
            if (!args.TryGetProperty("to", out var to)) return Error("INVALID_INPUT");
            var tx = to.GetProperty("x").GetInt32(); var ty = to.GetProperty("y").GetInt32();
            if (tx < 0 || tx > 1000 || ty < 0 || ty > 1000) return Error("INVALID_INPUT");
            var x2 = rect.Left + (int)Math.Round((rect.Right - rect.Left) * tx / 1000.0);
            var y2 = rect.Top + (int)Math.Round((rect.Bottom - rect.Top) * ty / 1000.0);
            if (GetAncestor(WindowFromPoint(new POINT { X = x2, Y = y2 }), 2) != window) return Error("TARGET_COVERED");
            MovePointer(x, y, pointer);
            Button(true); Thread.Sleep(60);
            MovePointer(x2, y2, "follow");
            Thread.Sleep(60); Button(false);
            MarkOwnInput();
            string moved = before;
            for (var attempt = 0; attempt < 10 && moved == before; attempt++) { Thread.Sleep(100); moved = Observe(automation, window, root); }
            return Success(new { verified = moved != before, from = new { x, y }, to = new { x = x2, y = y2 }, note = moved != before ? "the window changed after the drag" : "dragged; no change was observed (check with a new screenshot)" });
        }
        MovePointer(x, y, pointer);
        Click();
        if (action == "click")
        {
            string after = before;
            for (var attempt = 0; attempt < 10 && after == before; attempt++) { Thread.Sleep(100); after = Observe(automation, window, root); }
            return Success(new { verified = after != before, changed = after != before, at = new { x, y }, note = after != before ? "the window changed after the click" : "clicked; no visible change was observed" });
        }
        Thread.Sleep(120);
        UIA.IUIAutomationElement? focused = null;
        try { focused = automation.GetFocusedElement(); } catch (COMException) { }
        if (focused is not null && IsSensitive(automation.ControlViewWalker, focused, expectTitle)) return Error("SENSITIVE_FIELD");
        TypeText(text);
        var lastLine = text.Replace("\r\n", "\n").Split('\n')[^1];
        var seen = false;
        for (var attempt = 0; attempt < 20 && !seen && focused is not null; attempt++) { seen = ReadText(focused).Contains(lastLine, StringComparison.Ordinal); if (!seen) Thread.Sleep(50); }
        return Success(new { verified = seen, at = new { x, y }, note = seen ? "the typed text is in the focused field" : "typed at the point; the text could not be read back (check with a new screenshot)" });
    }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(IntPtr window, out RECT rect);
    // ---- Visible pointer, real input and owner takeover (2026-11-10) ----
    // The owner pressed Allow for this very action a moment ago (NAJD says so): their mouse and keyboard use is that approval, not a takeover.
    private static bool OwnerApproved(JsonElement args) => args.TryGetProperty("ownerApproved", out var value) && value.ValueKind == JsonValueKind.True;
    private static UIA.IUIAutomationElement? ScrollAncestor(UIA.IUIAutomationTreeWalker walker, UIA.IUIAutomationElement element)
    {
        try { for (var current = element; current is not null; current = walker.GetParentElement(current)) if (current.GetCurrentPattern(10004) is UIA.IUIAutomationScrollPattern) return current; }
        catch (COMException) { }
        return null;
    }
    private static string ScrollPosition(UIA.IUIAutomationElement? scroller)
    {
        try { return scroller?.GetCurrentPattern(10004) is UIA.IUIAutomationScrollPattern pattern ? pattern.CurrentVerticalScrollPercent.ToString("F2") + "/" + pattern.CurrentHorizontalScrollPercent.ToString("F2") : ""; }
        catch (COMException) { return ""; }
    }
    private static void Wheel(string direction, int notches)
    {
        var horizontal = direction is "left" or "right";
        var delta = (direction is "up" or "right" ? 120 : -120);
        for (var i = 0; i < notches; i++)
        {
            var input = new[] { new INPUT { type = 0, U = new InputUnion { mi = new MOUSEINPUT { mouseData = unchecked((uint)delta), dwFlags = horizontal ? 0x1000u : 0x0800u } } } };
            SendInput(1, input, Marshal.SizeOf<INPUT>());
            Thread.Sleep(30);
        }
        MarkOwnInput();
    }
    // Keyboard and mouse use by the owner (2026-11-10): Windows' last-input time moved on after NAJD's own last input.
    private static uint lastOwnInputTick;
    private static void MarkOwnInput() { var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() }; if (GetLastInputInfo(ref info)) lastOwnInputTick = info.dwTime; GetCursorPos(out var at); lastX = at.X; lastY = at.Y; lastMoveTicks = Environment.TickCount64; }
    private static bool OwnerInputSince()
    {
        if (lastOwnInputTick == 0) return false;
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        return GetLastInputInfo(ref info) && unchecked(info.dwTime - lastOwnInputTick) > 150 && unchecked(info.dwTime - lastOwnInputTick) < 0x7fffffff;
    }
    [StructLayout(LayoutKind.Sequential)] private struct LASTINPUTINFO { public uint cbSize, dwTime; }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    private static long lastMoveTicks;
    private static int lastX = int.MinValue, lastY;
    private static bool UserTookOver()
    {
        if (lastX == int.MinValue || Environment.TickCount64 - lastMoveTicks > 15000) return false;
        GetCursorPos(out var now);
        return Math.Abs(now.X - lastX) > 8 || Math.Abs(now.Y - lastY) > 8 || OwnerInputSince();
    }
    // Where the pointer went for an act (the control's centre), reported so NAJD can draw a ring there; null when the control has no position.
    private static object? AtOf((int X, int Y)? center) => center is { } spot ? new { x = spot.X, y = spot.Y } : null;
    private static (int X, int Y)? Center(UIA.IUIAutomationElement element)
    {
        try { var r = element.CurrentBoundingRectangle; if (r.right <= r.left || r.bottom <= r.top) return null; return ((r.left + r.right) / 2, (r.top + r.bottom) / 2); }
        catch (COMException) { return null; }
    }
    private static void MovePointer(int x, int y, string mode)
    {
        if (mode == "fast") SetCursorPos(x, y);
        else
        {
            GetCursorPos(out var from);
            const int steps = 14; // about 0.2 s: visible, not slow
            for (var i = 1; i <= steps; i++) { var t = i / (double)steps; t = t * t * (3 - 2 * t); SetCursorPos((int)(from.X + (x - from.X) * t), (int)(from.Y + (y - from.Y) * t)); Thread.Sleep(14); }
        }
        // Where the pointer really is (Windows keeps it on a screen), so the owner-takeover check compares against that.
        GetCursorPos(out var placed); lastX = placed.X; lastY = placed.Y; lastMoveTicks = Environment.TickCount64;
        { var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() }; if (GetLastInputInfo(ref info)) lastOwnInputTick = info.dwTime; }
    }
    private static void Click()
    {
        var inputs = new INPUT[] { new() { type = 0, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = 0x0002 } } }, new() { type = 0, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = 0x0004 } } } };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        MarkOwnInput();
    }
    private static void Button(bool down) { var input = new[] { new INPUT { type = 0, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = down ? 0x0002u : 0x0004u } } } }; SendInput(1, input, Marshal.SizeOf<INPUT>()); }
    private static void Key(ushort vk, bool up) { var input = new[] { new INPUT { type = 1, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? 0x0002u : 0u } } } }; SendInput(1, input, Marshal.SizeOf<INPUT>()); }
    private static void TypeText(string text)
    {
        foreach (var ch in text.Replace("\r\n", "\n"))
        {
            if (ch == '\n') { Key(0x10, false); Key(0x0D, false); Key(0x0D, true); Key(0x10, true); continue; } // Shift+Enter: a new line, never send
            var pair = new[] { new INPUT { type = 1, U = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = 0x0004 } } }, new INPUT { type = 1, U = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = 0x0004 | 0x0002 } } } };
            SendInput(2, pair, Marshal.SizeOf<INPUT>());
        }
        MarkOwnInput();
    }
    private static string ReadText(UIA.IUIAutomationElement element)
    {
        try { if (element.GetCurrentPattern(10002) is UIA.IUIAutomationValuePattern value && value.CurrentValue is { Length: > 0 } v) return v; } catch (COMException) { }
        try { if (element.GetCurrentPattern(10014) is UIA.IUIAutomationTextPattern textPattern) return textPattern.DocumentRange.GetText(20000) ?? ""; } catch (COMException) { }
        return element.CurrentName ?? "";
    }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public InputUnion U; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
}
