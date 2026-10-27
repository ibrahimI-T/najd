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
    private const int MaxElements = 300, MaxSearch = 3000;
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
                "najd.desktop.act" => Act(request.Args),
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
        UIA.IUIAutomation automation = new UIA.CUIAutomation8();
        var root = automation.ElementFromHandle(window);
        var walker = automation.ControlViewWalker;
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
                if (depth >= 14) { try { if (walker.GetFirstChildElement(element) is not null) complete = false; } catch (COMException) { complete = false; } continue; }
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
        if (WindowTitle(window) != expectTitle) return Error("STALE_TARGET");
        try { if (Resolve(args) != window) return Error("STALE_TARGET"); } catch (InvalidOperationException) { return Error("STALE_TARGET"); }
        return Success(new { title, elements, complete });
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
        if (string.IsNullOrEmpty(target) || action is not ("invoke" or "setValue" or "select" or "toggle" or "focus") || text.Length > 4000)
            return Error("INVALID_INPUT");
        UIA.IUIAutomation automation = new UIA.CUIAutomation8();
        var root = automation.ElementFromHandle(window);
        var walker = automation.ControlViewWalker;
        UIA.IUIAutomationElement? element = null;
        var queue = new Queue<UIA.IUIAutomationElement>();
        queue.Enqueue(root);
        for (var seen = 0; queue.Count > 0 && seen < MaxSearch && element is null; seen++)
        {
            var current = queue.Dequeue();
            if (RuntimeId(current) == target) { element = current; break; }
            for (var child = walker.GetFirstChildElement(current); child is not null; child = walker.GetNextSiblingElement(child)) queue.Enqueue(child);
        }
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
        object verified;
        switch (action)
        {
            case "setValue":
            {
                var pattern = (UIA.IUIAutomationValuePattern)element.GetCurrentPattern(10002) ?? throw new InvalidOperationException();
                if (pattern.CurrentIsReadOnly != 0) return Error("READ_ONLY");
                if (BeforeEffect() is { } refusedSet) return Error(refusedSet);
                pattern.SetValue(text);
                var ok = false;
                for (var attempt = 0; attempt < 20 && !ok; attempt++) { ok = pattern.CurrentValue == text; if (!ok) Thread.Sleep(50); }
                verified = new { verified = ok, value = ok ? text : null };
                break;
            }
            case "toggle":
            {
                var pattern = (UIA.IUIAutomationTogglePattern)element.GetCurrentPattern(10015) ?? throw new InvalidOperationException();
                var before = pattern.CurrentToggleState;
                if (BeforeEffect() is { } refusedToggle) return Error(refusedToggle);
                pattern.Toggle();
                verified = new { verified = pattern.CurrentToggleState != before, state = pattern.CurrentToggleState.ToString() };
                break;
            }
            case "select":
            {
                var pattern = (UIA.IUIAutomationSelectionItemPattern)element.GetCurrentPattern(10010) ?? throw new InvalidOperationException();
                if (BeforeEffect() is { } refusedSelect) return Error(refusedSelect);
                pattern.Select();
                verified = new { verified = pattern.CurrentIsSelected != 0 };
                break;
            }
            case "focus":
                if (BeforeEffect() is { } refusedFocus) return Error(refusedFocus);
                element.SetFocus();
                verified = new { verified = element.CurrentHasKeyboardFocus != 0 };
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
                verified = new { verified = after != before, changed = after != before, note = after != before ? "the window changed after pressing" : "pressed; no visible change was observed" };
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
            for (var seen = 0; queue.Count > 0 && seen < 200; seen++)
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

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
}
