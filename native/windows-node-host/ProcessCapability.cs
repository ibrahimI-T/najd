using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using OpenClaw.Shared;

// Background commands for NAJD (docs/AGENT-PLATFORM-M2-PLAN.md, M2c). Each runs hidden, suspended until it is in a
// Job object with KILL_ON_JOB_CLOSE and no breakaway, so the whole family ends when NAJD stops it, when this host
// exits, or when this host dies. Liveness and the limit follow the job family, not only the first process
// (M2-R06). NAJD decides and approves in Electron; this host only runs what NAJD sends over its private pipe.
sealed class ProcessCapability : NodeCapabilityBase, IDisposable
{
    private const int MaxRunning = 4, MaxTracked = 32;
    private static readonly Regex EnvName = new(@"^[A-Za-z_][A-Za-z0-9_()]{0,63}$", RegexOptions.CultureInvariant);
    private readonly Dictionary<string, (OwnedWindowsProcess Owned, string Log, DateTime Started)> _jobs = new();
    private readonly object _gate = new();
    // Jobs ended by their own deadline (M2-R16-002).
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> _timedOut = new();
    public ProcessCapability() : base(NullLogger.Instance) { }
    public override string Category => "najd";
    public override IReadOnlyList<string> Commands => ["najd.process.start", "najd.process.list", "najd.process.stop"];

    public override Task<NodeInvokeResponse> ExecuteAsync(NodeInvokeRequest request)
    {
        try
        {
            return Task.FromResult(request.Command switch
            {
                "najd.process.start" => Start(request.Args),
                "najd.process.list" => Success(List()),
                "najd.process.stop" => Stop(GetStringArg(request.Args, "id")),
                _ => Error("PERMISSION_DENIED")
            });
        }
        catch { return Task.FromResult(Error("PROCESS_FAILED")); }
    }

    // Variables Windows programs expect; copied from this host when present.
    private static readonly string[] SystemVariables = ["SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT", "OS",
        "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
        "CommonProgramFiles", "PSModulePath", "TEMP", "TMP", "USERPROFILE", "USERNAME", "LOCALAPPDATA", "APPDATA", "HOMEDRIVE", "HOMEPATH"];

    private static string Quote(string value) => "'" + value.Replace("'", "''") + "'";

    private NodeInvokeResponse Start(JsonElement args)
    {
        // Commands never run with administrator rights: an elevated host refuses before creating anything (M2-R8-001).
        if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return Error("ADMIN_NOT_ALLOWED");
        var command = GetStringArg(args, "command");
        var cwd = GetStringArg(args, "cwd");
        var log = GetStringArg(args, "log");
        if (string.IsNullOrWhiteSpace(command) || command.Length > 8000 || command.Contains('\0') ||
            string.IsNullOrEmpty(cwd) || !Path.IsPathFullyQualified(cwd) || !Directory.Exists(cwd) ||
            string.IsNullOrEmpty(log) || !Path.IsPathFullyQualified(log) || !log.EndsWith(".log", StringComparison.OrdinalIgnoreCase) ||
            !Directory.Exists(Path.GetDirectoryName(log)))
            return Error("INVALID_INPUT");
        // An optional deadline the host enforces on the job itself, independent of NAJD's request queue (M2-R16-002).
        int? deadline = null;
        if (args.TryGetProperty("timeoutMs", out var limit))
        {
            if (limit.ValueKind != JsonValueKind.Number || !limit.TryGetInt32(out var milliseconds) || milliseconds < 1000 || milliseconds > 3600000) return Error("INVALID_INPUT");
            deadline = milliseconds;
        }
        // The command's whole environment: what Windows itself needs, then exactly what NAJD prepared (secrets already
        // removed in Electron; names and sizes bounded here too). It travels as a native environment block, never on
        // the command line, and nothing else of this host's environment is inherited (M2-R3-006).
        var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in SystemVariables)
            if (Environment.GetEnvironmentVariable(name) is { Length: > 0 } value) environment[name] = value;
        var system = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        environment["PATH"] = system + @"\System32;" + system + ";" + system + @"\System32\WindowsPowerShell\v1.0";
        if (args.TryGetProperty("env", out var env) && env.ValueKind == JsonValueKind.Object)
        {
            var count = 0;
            foreach (var item in env.EnumerateObject())
            {
                var value = item.Value.ValueKind == JsonValueKind.String ? item.Value.GetString() : null;
                if (++count > 80 || !EnvName.IsMatch(item.Name) || value is null || value.Length > 8000 || value.Contains('\0')) return Error("INVALID_INPUT");
                environment[item.Name] = value;
            }
        }
        lock (_gate)
        {
            if (_jobs.Values.Count(job => job.Owned.ActiveProcesses > 0) >= MaxRunning) return Error("PROCESS_LIMIT");
            // Output goes to NAJD's log by UTF-8 bytes, keeping the newest 4 MB when it passes 5 MB; the bytes cut from
            // the front are recorded in "<log>.meta" so NAJD's offsets stay absolute (M2-R09). The command text is only
            // inside the encoded script, never on the command line.
            var script = new StringBuilder()
                .Append("$ErrorActionPreference = 'Continue'\n")
                // Output of programs it runs is decoded as UTF-8, not the system code page (M2-R6-002).
                .Append("try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }\n")
                .Append("$najdLog = ").Append(Quote(log)).Append("\n")
                .Append("$najdMeta = $najdLog + '.meta'; $najdTrimmed = 0; $najdUtf8 = New-Object System.Text.UTF8Encoding($false)\n")
                // Trimming reads the log exclusively; while NAJD holds it the trim is retried after the next chunk and,
                // once output ends, until NAJD lets go (bounded), so the log does not stay above 5 MB (M2-R4-005). The
                // kept part starts on a whole UTF-8 character (M2-R3-002).
                // The trim record is replaced atomically (written beside it, then swapped in), so it is always a
                // complete record, the previous one or the new one (M2-R5-004).
                .Append("function NajdMeta([string]$json) {\n")
                .Append("  $temp = $najdMeta + '.tmp'; [IO.File]::WriteAllText($temp, $json)\n")
                .Append("  if ([IO.File]::Exists($najdMeta)) { [IO.File]::Replace($temp, $najdMeta, [NullString]::Value) } else { [IO.File]::Move($temp, $najdMeta) }\n")
                .Append("}\n")
                // The kept part is written in full to "<log>.trim" first and then swapped in with File.Replace, so
                // the log is always either the whole old log or the whole kept part. The pending record names the kept
                // length; NAJD trusts it only when the log has exactly that length (M2-R10-003).
                // A record exists from the start, so NAJD can tell "not trimmed yet" from a record mid-swap.
                .Append("if (-not [IO.File]::Exists($najdMeta)) { NajdMeta '{\"trimmedBefore\":0}' }\n")
                .Append("function NajdTrim {\n")
                .Append("  if ((New-Object IO.FileInfo $najdLog).Length -le 5MB) { return $true }\n")
                .Append("  try { $lock = [IO.File]::Open($najdLog, 'Open', 'Read', 'None') } catch { return $false }\n")
                .Append("  try {\n")
                .Append("    $all = New-Object byte[] $lock.Length; $read = 0; while ($read -lt $all.Length) { $n = $lock.Read($all, $read, $all.Length - $read); if ($n -le 0) { break }; $read += $n }\n")
                .Append("  } finally { $lock.Close() }\n")
                .Append("  if ($read -le 5MB) { return $true }\n")
                .Append("  $cut = $read - 4MB; while ($cut -lt $read -and ($all[$cut] -band 0xC0) -eq 0x80) { $cut++ }\n")
                .Append("  $kept = $read - $cut; $next = $script:najdTrimmed + $cut; $trim = $najdLog + '.trim'\n")
                .Append("  $stream = [IO.File]::Open($trim, 'Create', 'Write', 'None'); try { $stream.Write($all, $cut, $kept); $stream.Flush($true) } finally { $stream.Close() }\n")
                .Append("  NajdMeta ('{\"trimmedBefore\":' + $script:najdTrimmed + ',\"pending\":' + $next + ',\"kept\":' + $kept + '}')\n")
                .Append("  try { [IO.File]::Replace($trim, $najdLog, [NullString]::Value) }\n")
                .Append("  catch { [IO.File]::Delete($trim); NajdMeta ('{\"trimmedBefore\":' + $script:najdTrimmed + '}'); return $false }\n")
                .Append("  $script:najdTrimmed = $next; NajdMeta ('{\"trimmedBefore\":' + $next + '}')\n")
                .Append("  return $true\n")
                .Append("}\n")
                // Output is appended in chunks of at most 64 KB, each followed by the size check.
                .Append("function NajdWrite([string]$text) {\n")
                .Append("  $bytes = $najdUtf8.GetBytes($text + \"`n\")\n")
                .Append("  for ($at = 0; $at -lt $bytes.Length; $at += 65536) {\n")
                .Append("    $count = [Math]::Min(65536, $bytes.Length - $at)\n")
                .Append("    $stream = [IO.File]::Open($najdLog, 'Append', 'Write', 'ReadWrite'); $stream.Write($bytes, $at, $count); $stream.Close()\n")
                .Append("    [void](NajdTrim)\n")
                .Append("  }\n")
                .Append("}\n")
                // A program's error lines are logged as written. A PowerShell error (including one that stops the
                // command) makes the exit code nonzero even when no program set one; a program's own exit code is kept
                // (M2-R8-002).
                .Append("$global:LASTEXITCODE = 0; $global:najdPsError = $false\n")
                .Append("try {\n")
                .Append("& {\n").Append(command).Append("\n} *>&1 | ForEach-Object {\n")
                .Append("  if ($_ -is [System.Management.Automation.ErrorRecord]) {\n")
                .Append("    if ($_.FullyQualifiedErrorId -in 'NativeCommandError', 'NativeCommandErrorMessage') { NajdWrite $_.ToString() }\n")
                .Append("    else { $global:najdPsError = $true; NajdWrite (($_ | Out-String).TrimEnd([char]13, [char]10)) }\n")
                // Text (including every line a program prints) is written exactly as produced, trailing spaces and
                // tabs included; only objects are formatted, and only the line break Out-String adds is removed
                // (M2-R23-003).
                .Append("  } elseif ($_ -is [string]) { NajdWrite $_ } else { NajdWrite (($_ | Out-String).TrimEnd([char]13, [char]10)) }\n")
                .Append("}\n")
                .Append("} catch { $global:najdPsError = $true; NajdWrite $_.ToString() }\n")
                .Append("$najdExit = [int]$LASTEXITCODE; if ($global:najdPsError -and $najdExit -eq 0) { $najdExit = 1 }\n")
                .Append("for ($najdTry = 0; $najdTry -lt 100 -and -not (NajdTrim); $najdTry++) { Start-Sleep -Milliseconds 50 }\n")
                .Append("exit $najdExit\n").ToString();
            var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var shell = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            // Too long for one Windows command line: refused before anything runs.
            if (shell.Length + encoded.Length + 64 >= OwnedWindowsProcess.MaxCommandLine) return Error("INVALID_INPUT");
            // A failure inside Start happens before the command runs (it is still suspended) and is a refusal.
            OwnedWindowsProcess owned;
            TestHooks.Pause(args);
            if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED"); // cancelled before it ran (M2-R11-002)
            try { owned = OwnedWindowsProcess.Start(shell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], cwd, hidden: true, environment); }
            catch { return Error("START_REFUSED"); }
            // From here the command may already have run: a failure ends its family and is reported as such, never as a
            // refusal (M2-R2-003).
            try
            {
                var id = Guid.NewGuid().ToString("N");
                // Keep the table bounded: forget the oldest families that have fully ended.
                foreach (var stale in _jobs.Where(job => job.Value.Owned.ActiveProcesses == 0).OrderBy(job => job.Value.Started).Take(Math.Max(0, _jobs.Count + 1 - MaxTracked)).ToList())
                { stale.Value.Owned.Dispose(); _jobs.Remove(stale.Key); }
                _jobs[id] = (owned, log, DateTime.UtcNow);
                if (deadline is { } after)
                    _ = Task.Delay(after).ContinueWith(_ =>
                    {
                        try { if (owned.ActiveProcesses > 0) { _timedOut[id] = true; owned.Terminate(); } }
                        catch (ObjectDisposedException) { } // already stopped and released
                    });
                return Success(new { id, pid = owned.Process.Id, created = owned.CreatedFileTime.ToString(), contained = true });
            }
            catch { owned.Dispose(); return Error("STARTED_THEN_FAILED"); }
        }
    }

    private object List()
    {
        lock (_gate)
            return _jobs.Select(job =>
            {
                var active = job.Value.Owned.ActiveProcesses;
                var owned = job.Value.Owned;
                return new { id = job.Key, pid = owned.Process.Id, running = active > 0, activeProcesses = active, rootExited = owned.RootExited,
                    exitCode = active == 0 ? owned.RootExitCode : null, timedOut = _timedOut.ContainsKey(job.Key) };
            }).ToArray();
    }

    private NodeInvokeResponse Stop(string? id)
    {
        (OwnedWindowsProcess Owned, string Log, DateTime Started) job;
        lock (_gate)
        {
            if (id is null || !_jobs.TryGetValue(id, out job)) return Error("NOT_FOUND");
        }
        var wasRunning = job.Owned.ActiveProcesses > 0;
        // The whole family, then a bounded wait for it to close. Only a family seen closed is forgotten; otherwise the
        // job stays tracked (listed as running) and can be stopped again (M2-R4-002).
        var closed = job.Owned.Terminate() || !wasRunning;
        if (closed)
        {
            lock (_gate) _jobs.Remove(id);
            job.Owned.Dispose();
        }
        return Success(new { id, stopped = wasRunning, familyClosed = closed });
    }

    public void Dispose()
    {
        lock (_gate)
        {
            foreach (var job in _jobs.Values) { try { job.Owned.Dispose(); } catch { } }
            _jobs.Clear();
        }
    }
}
