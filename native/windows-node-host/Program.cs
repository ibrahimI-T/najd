using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OpenClaw.Shared;
using OpenClaw.Shared.Capabilities;
using OpenClaw.Shared.Mcp;

// Private parent pipe only. Never read existing tray settings, tokens or profiles.
static async Task<string?> ReadControlAsync()
{
    var text = new StringBuilder();
    var buffer = new char[1];
    while (await Console.In.ReadAsync(buffer.AsMemory()) > 0)
    {
        if (buffer[0] == '\n') return text.ToString().TrimEnd('\r');
        // Bounded owner frames; NAJD rejects larger requests before sending them (M2-R07).
        if (text.Length >= 65536) throw new InvalidDataException();
        text.Append(buffer[0]);
    }
    return text.Length == 0 ? null : throw new InvalidDataException();
}

// The parent writes UTF-8 JSON lines; without this Windows decodes them with the console code page and Arabic or
// other non-Latin text typed into windows arrives garbled (owner report 2026-10-19).
Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
try
{
    if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
    using var config = JsonDocument.Parse(await ReadControlAsync() ?? throw new InvalidDataException());
    List<INodeCapability> capabilities = [new DiscoveryCapability()];
    var bridge = new McpToolBridge(() => capabilities, NullLogger.Instance, "najd-windows-node", "0.1.0");
    if (config.RootElement.TryGetProperty("transport", out var transport) && transport.GetString() == "stdio")
    {
        using var ownerCancellation = new CancellationTokenSource();
        capabilities.Add(new WindowsDemoCapability(ownerCancellation.Token));
        // Background commands for NAJD; disposed (job closed) when the host exits, and closed by Windows if it dies.
        using var processes = new ProcessCapability();
        capabilities.Add(processes);
        capabilities.Add(new DesktopCapability());
        capabilities.Add(new ScreenCaptureCapability());
        WindowsNodeClient? node = null;
        var pairedSignal = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var pendingSignal = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (config.RootElement.TryGetProperty("gateway", out var gateway))
        {
            var url = new Uri(gateway.GetProperty("url").GetString()!);
            var identityPath = gateway.GetProperty("identityPath").GetString()!;
            var credential = gateway.GetProperty("token").GetString()!;
            if (url.Scheme != "ws" || url.Host != "127.0.0.1" || url.Port < 1024 || url.UserInfo.Length > 0 ||
                url.AbsolutePath != "/" || url.Query.Length > 0 || url.Fragment.Length > 0 ||
                credential.Length != 64 || !credential.All(Uri.IsHexDigit) || !Path.IsPathFullyQualified(identityPath))
                throw new InvalidDataException();
            node = new WindowsNodeClient(url.ToString(), credential, identityPath, new ProtocolDiagnosticLogger());
        }
        using var ownedNode = node;
        if (node is not null)
        {
            var failure = GatewayErrorKind.Unknown;
            node.ConnectionFailure += (_, kind) => failure = kind;
            node.HandshakeSucceeded += (_, _) => pairedSignal.TrySetResult();
            node.PairingStatusChanged += (_, status) =>
            {
                if (status.Status == PairingStatus.Pending && status.ApprovalKind == PairingApprovalKind.DevicePair && status.RequestId is not null)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new { state = "pairing", nodeId = status.DeviceId, requestId = status.RequestId }));
                    Console.Out.Flush();
                    pendingSignal.TrySetResult();
                }
            };
            // Pair a local identity without advertising action commands. Gateway
            // dispatch must gain a NAJD task approval broker before registration.
            await node.ConnectAsync().WaitAsync(TimeSpan.FromSeconds(15));
            var signal = await Task.WhenAny(pairedSignal.Task, pendingSignal.Task).WaitAsync(TimeSpan.FromSeconds(20));
            if (signal == pendingSignal.Task)
            {
                if (await ReadControlAsync() != "pairing-approved") throw new InvalidDataException();
                // The Gateway closes a NOT_PAIRED socket. A fresh explicit
                // connection obtains the now-approved node's own device token.
                await node.ConnectAsync().WaitAsync(TimeSpan.FromSeconds(15));
                await pairedSignal.Task.WaitAsync(TimeSpan.FromSeconds(20));
            }
            if (!node.IsConnected) { Console.Error.WriteLine($"NODE_CONNECT_{failure}"); throw new InvalidOperationException(); }
        }
        Console.WriteLine(JsonSerializer.Serialize(new { state = "ready", transport = "stdio",
            gatewayConnected = node?.IsConnected ?? false, nodeId = node?.FullDeviceId }));
        await Console.Out.FlushAsync();
        // Console's synchronized TextReader can block before returning a Task.
        // Keep the single bounded owner read on its own thread during actions.
        var next = Task.Run(ReadControlAsync);
        while (await next is { } request && request != "stop")
        {
            // A cancel that arrives after its request already finished has nothing left to cancel.
            if (request == "cancel") { next = Task.Run(ReadControlAsync); continue; }
            // Initialization notifications have no response. Consume them in order
            // before starting the next owner read; ordinary action requests retain
            // the existing concurrent cancel/EOF handling below.
            if (IsInitializedNotification(request))
            {
                if (await bridge.HandleRequestAsync(request) is not null) throw new InvalidDataException();
                next = Task.Run(ReadControlAsync);
                continue;
            }
            OperationCancellation.Begin();
            // The owner's next line is read while the request runs on the thread pool, so a cancel or a shutdown is
            // received even while a handler works synchronously (M2-R12-001).
            next = Task.Run(ReadControlAsync);
            var executing = Task.Run(() => bridge.HandleRequestAsync(request));
            var shuttingDown = false;
            while (await Task.WhenAny(executing, next) == next)
            {
                var ownerControl = await next;
                // The user cancelled the task: cancel this request only; it answers and the host keeps serving, while
                // still watching for a shutdown (M2-R11-002, M2-R12-003).
                if (ownerControl == "cancel") { OperationCancellation.Cancel(); next = Task.Run(ReadControlAsync); continue; }
                if (ownerControl is not null && ownerControl != "stop") throw new InvalidDataException();
                shuttingDown = true;
                break;
            }
            if (shuttingDown)
            {
                // Stop, or the owner went away: the active request is cancelled as well, given a bounded moment to
                // finish its cleanup, and the host exits, which closes every job it owns (M2-R12-003).
                OperationCancellation.Cancel();
                ownerCancellation.Cancel();
                try
                {
                    var final = await executing.WaitAsync(TimeSpan.FromSeconds(8));
                    if (final is not null) { Console.WriteLine(DescribeWindowsTools(final)); await Console.Out.FlushAsync(); }
                }
                catch (TimeoutException) { }
                return;
            }
            var response = await executing;
            if (response is not null) { Console.WriteLine(DescribeWindowsTools(response)); await Console.Out.FlushAsync(); }
        }
        return;
    }
    var port = config.RootElement.GetProperty("port").GetInt32();
    var token = config.RootElement.GetProperty("token").GetString();
    if (port < 1024 || port > 65535 || token is null || token.Length != 64 || !token.All(Uri.IsHexDigit))
        throw new InvalidDataException();
    await using var server = new McpHttpServer(bridge, port, NullLogger.Instance, token);
    server.Start();
    Console.WriteLine(JsonSerializer.Serialize(new { state = "ready", port }));
    await Console.Out.FlushAsync();
    // EOF from the owner is also shutdown. No shell, tool invocation or live
    // permission change is accepted through this control channel.
    var control = await ReadControlAsync();
    if (control is not null && control != "stop") throw new InvalidDataException();
    await server.StopAsync(TimeSpan.FromSeconds(3));
}
catch
{
    Console.Error.WriteLine("WINDOWS_NODE_FAILED");
    Environment.ExitCode = 1;
}

static bool IsInitializedNotification(string request)
{
    try
    {
        using var document = JsonDocument.Parse(request);
        var root = document.RootElement;
        return root.ValueKind == JsonValueKind.Object && !root.TryGetProperty("id", out _) &&
            root.TryGetProperty("method", out var method) && method.ValueKind == JsonValueKind.String &&
            method.GetString() == "notifications/initialized";
    }
    catch (JsonException) { return false; }
}

static string DescribeWindowsTools(string response)
{
    var frame = JsonNode.Parse(response);
    if (frame?["result"]?["tools"] is not JsonArray tools) return response;
    foreach (var tool in tools)
    {
        if (tool?["name"]?.GetValue<string>() != "najd.windows.demo") continue;
        tool["description"] = "Open an isolated Chrome or Edge local test window, verify a fixed input through Windows UI Automation, and close its owned process family. Requires NAJD core approval. No existing profiles or arbitrary commands.";
        tool["inputSchema"] = JsonNode.Parse("""{"type":"object","properties":{"app":{"type":"string","enum":["chrome","edge"]}},"required":["app"],"additionalProperties":false}""");
    }
    return frame!.ToJsonString();
}

sealed class DiscoveryCapability : NodeCapabilityBase
{
    private readonly SystemCapability _system = new(NullLogger.Instance, includeRunCommands: false);
    private static readonly HashSet<string> AllowedBins = new(StringComparer.OrdinalIgnoreCase)
        { "notepad", "calc", "mspaint", "chrome", "edge" };
    public DiscoveryCapability() : base(NullLogger.Instance) { }
    public override string Category => "system";
    public override IReadOnlyList<string> Commands => ["system.which"];

    public override async Task<NodeInvokeResponse> ExecuteAsync(NodeInvokeRequest request)
    {
        if (request.Command != "system.which") return Error("PERMISSION_DENIED");
        var bins = GetStringArrayArg(request.Args, "bins");
        if (bins.Length is < 1 or > 5 || bins.Any(bin => !AllowedBins.Contains(bin)))
            return Error("PERMISSION_DENIED");
        var response = await _system.ExecuteAsync(request);
        if (!response.Ok) return response;
        var found = JsonSerializer.Deserialize<Dictionary<string, string>>(
            JsonSerializer.SerializeToElement(response.Payload).GetProperty("bins"))!;
        var sources = new Dictionary<string, string>();
        foreach (var bin in bins.Where(bin => bin.Equals("chrome", StringComparison.OrdinalIgnoreCase) || bin.Equals("edge", StringComparison.OrdinalIgnoreCase)))
        {
            found.Remove(bin);
            if (WindowsAppPaths.Find(bin.ToLowerInvariant()) is not { } installed) continue;
            found[bin] = installed.Path;
            sources[bin] = installed.Source;
        }
        return Success(new { bins = found, sources });
    }
}

// Emit protocol categories only, never the raw frame, identity or credential.
sealed class ProtocolDiagnosticLogger : IOpenClawLogger
{
    public void Info(string message) { }
    public void Warn(string message) => Categories(message);
    public void Error(string message, Exception? ex = null) { }
    public void Debug(string message)
    {
        if (!message.StartsWith("[NODE RX] ")) return;
        try
        {
            using var frame = JsonDocument.Parse(message[10..]);
            if (!frame.RootElement.TryGetProperty("error", out var failure)) return;
            var code = failure.TryGetProperty("code", out var field) ? field.GetString() : null;
            if (code is "INVALID_REQUEST" or "NOT_PAIRED" or "UNAVAILABLE" or "UNAUTHORIZED")
                Console.Error.WriteLine($"NODE_PROTOCOL_{code}");
            var text = failure.TryGetProperty("message", out field) ? field.GetString() ?? "" : "";
            Categories(text);
        }
        catch { }
    }
    private static void Categories(string text)
    {
        foreach (var category in new[] { "origin not allowed", "invalid connect params", "pairing required", "signature", "unauthorized", "protocol", "hello-ok", "challenge" })
            if (text.Contains(category, StringComparison.OrdinalIgnoreCase))
                Console.Error.WriteLine($"NODE_REASON_{category.Replace(' ', '_').Replace('-', '_')}");
    }
}
