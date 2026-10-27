using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using UIA = Interop.UIAutomationClient;
using OpenClaw.Shared;

sealed class WindowsDemoCapability : NodeCapabilityBase
{
    private readonly CancellationToken _ownerCancellation;
    public WindowsDemoCapability(CancellationToken ownerCancellation) : base(NullLogger.Instance)
        => _ownerCancellation = ownerCancellation;
    public override string Category => "najd";
    public override IReadOnlyList<string> Commands => ["najd.windows.demo"];

    public override async Task<NodeInvokeResponse> ExecuteAsync(NodeInvokeRequest request)
    {
        var app = GetStringArg(request.Args, "app");
        if (request.Command != "najd.windows.demo" || app is not ("chrome" or "edge") ||
            request.Args.ValueKind != JsonValueKind.Object || request.Args.EnumerateObject().Count() != 1)
            return Error("PERMISSION_DENIED");
        if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            return Error("ADMIN_NOT_ALLOWED");
        // Cancelled by the owner's shutdown or by a cancel of this request (M2-R11-002).
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_ownerCancellation, OperationCancellation.Token);
        return Success(await Task.Run(() => Run(app, linked.Token)));
    }

    private static object Run(string app, CancellationToken cancellation)
    {
        var opened = false; var windowOwned = false; var focused = false; var inputVerified = false; var closed = false; var cleaned = false;
        var stage = "discovery";
        var parent = Path.GetFullPath(Environment.CurrentDirectory);
        var root = Path.Combine(parent, $"windows-demo-{Guid.NewGuid():N}");
        OwnedWindowsProcess? owned = null;
        try
        {
            cancellation.ThrowIfCancellationRequested();
            var executable = WindowsAppPaths.Find(app)?.Path ?? throw new FileNotFoundException();
            Directory.CreateDirectory(root);
            var title = $"NAJD Windows Proof {Guid.NewGuid():N}";
            var page = Path.Combine(root, "proof.html");
            File.WriteAllText(page, $"<!doctype html><meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>{title}</title><h1>NAJD local Windows proof</h1><label>NAJD fixture input<input id='najd-proof-input' aria-label='NAJD fixture input' value=''></label>");
            stage = "open";
            cancellation.ThrowIfCancellationRequested();
            owned = OwnedWindowsProcess.Start(executable, [
                $"--user-data-dir={Path.Combine(root, "profile")}", "--no-first-run", "--no-default-browser-check",
                "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-gpu", "--force-renderer-accessibility=complete",
                "--enable-features=UiaProvider",
                "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows",
                "--new-window", new Uri(page).AbsoluteUri ], root);
            var deadline = DateTime.UtcNow.AddSeconds(20);
            IntPtr window = IntPtr.Zero;
            stage = "window";
            while (DateTime.UtcNow < deadline)
            {
                cancellation.ThrowIfCancellationRequested();
                if (owned.Process.HasExited) throw new InvalidOperationException();
                owned.Process.Refresh(); window = owned.Process.MainWindowHandle;
                if (window != IntPtr.Zero && owned.Process.MainWindowTitle.Contains(title, StringComparison.Ordinal)) break;
                Thread.Sleep(100);
            }
            GetWindowThreadProcessId(window, out var pid);
            if (window == IntPtr.Zero || pid != owned.Process.Id || !owned.Process.MainWindowTitle.Contains(title, StringComparison.Ordinal))
                throw new InvalidOperationException();
            opened = true;
            stage = "focus";
            ShowWindow(window, 9); // Restore only this owned fixture window.
            UIA.IUIAutomation automation = new UIA.CUIAutomation8();
            var automationWindow = automation.ElementFromHandle(window);
            try { automationWindow.SetFocus(); } catch (COMException) { }
            // Windows refuses to bring a background program's window to the front while the user works in another one
            // (foreground lock), and NAJD never works around that. Bringing it forward is only attempted and reported as it is
            // (focused); UIA writes to the field itself, as najd.desktop.act does, so the proof needed before writing is that
            // the window and the field belong to the process NAJD started (owned, checked below) (C51-01).
            SetForegroundWindow(window);
            for (var attempt = 0; attempt < 10 && !focused; attempt++) { focused = GetForegroundWindow() == window; if (!focused) Thread.Sleep(100); }
            stage = "find-input";
            UIA.IUIAutomationElement? field = null;
            UIA.IUIAutomationValuePattern? value = null;
            while (DateTime.UtcNow < deadline)
            {
                cancellation.ThrowIfCancellationRequested();
                var condition = automation.CreateOrCondition(
                    automation.CreatePropertyCondition(30011, "najd-proof-input"),
                    automation.CreatePropertyCondition(30005, "NAJD fixture input"));
                var matches = automationWindow.FindAll((UIA.TreeScope)4, condition);
                for (var index = 0; index < matches.Length; index++)
                {
                    var candidate = matches.GetElement(index);
                    try { value = (UIA.IUIAutomationValuePattern)candidate.GetCurrentPattern(10002); }
                    catch (COMException) { continue; }
                    if (value is not null) { field = candidate; break; }
                }
                if (field is not null) break;
                Thread.Sleep(100);
            }
            stage = field is null ? "input-not-found" : "input-pattern";
            owned.Process.Refresh();
            GetWindowThreadProcessId(window, out var windowOwner);
            if (windowOwner != owned.Process.Id || owned.Process.MainWindowHandle != window || !owned.Process.MainWindowTitle.Contains(title, StringComparison.Ordinal) ||
                field is null || field.CurrentIsEnabled == 0 || field.CurrentIsPassword != 0 || value is null) throw new InvalidOperationException();
            // The field must be in the browser NAJD started (its own process family), never in another window.
            if (!owned.Owns(field.CurrentProcessId)) throw new InvalidOperationException();
            windowOwned = true;
            if (value.CurrentIsReadOnly != 0) throw new InvalidOperationException();
            stage = "set-input";
            cancellation.ThrowIfCancellationRequested();
            value.SetValue("NAJD automation proof");
            stage = "verify-input";
            for (var attempt = 0; attempt < 30; attempt++)
            {
                cancellation.ThrowIfCancellationRequested();
                inputVerified = value.CurrentValue == "NAJD automation proof";
                if (inputVerified) break;
                Thread.Sleep(100);
            }
        }
        catch (OperationCanceledException) { stage = "cancelled"; }
        catch { /* Report postconditions below, never raw OS/application data. */ }
        finally
        {
            if (owned is not null)
            {
                owned.Dispose(); closed = owned.FamilyClosed && owned.Process.HasExited; owned.Process.Dispose();
            }
            if (Path.GetFullPath(root).StartsWith(parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && Directory.Exists(root))
            {
                for (var attempt = 0; attempt < 10; attempt++)
                {
                    try { Directory.Delete(root, recursive: true); cleaned = true; break; }
                    catch (IOException) { Thread.Sleep(100); }
                    catch (UnauthorizedAccessException) { Thread.Sleep(100); }
                }
            }
        }
        // focused is reported, not required: Windows may keep the window behind the app the user is working in.
        return new { app, opened, owned = windowOwned, focused, inputVerified, closed, cleaned, verified = opened && windowOwned && inputVerified && closed && cleaned, stage };
    }

    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ShowWindow(IntPtr window, int command);
}
