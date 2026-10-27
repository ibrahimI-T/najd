using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Contain the browser before it can create children. Closing the job cannot
// affect a browser from another profile or a process selected by model text.
sealed class OwnedWindowsProcess : IDisposable
{
    private readonly SafeFileHandle _job;
    private readonly SafeFileHandle _handle;
    public Process Process { get; }
    public bool FamilyClosed { get; private set; }
    public long CreatedFileTime { get; private init; }
    private OwnedWindowsProcess(SafeFileHandle job, SafeFileHandle handle, Process process)
        => (_job, _handle, Process) = (job, handle, process);

    // Longest command line CreateProcess accepts, including its terminating null.
    public const int MaxCommandLine = 32767;

    // hidden: background work without a console window (CREATE_NO_WINDOW); still suspended until it is in the job.
    // environment: the complete environment of the new process (a native Unicode block), or null to inherit this host's.
    public static OwnedWindowsProcess Start(string executable, IReadOnlyList<string> arguments, string cwd, bool hidden = false,
        IReadOnlyDictionary<string, string>? environment = null)
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job.IsInvalid) throw new Win32Exception();
        var limits = new JobLimits { Basic = new JobBasic { Flags = 0x2000 } }; // KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<JobLimits>()))
        { job.Dispose(); throw new Win32Exception(); }
        var args = new[] { executable }.Concat(arguments).ToArray();
        if (args.Any(arg => arg.Contains('"') || arg.EndsWith('\\')))
        { job.Dispose(); throw new InvalidDataException(); }
        var command = new StringBuilder(string.Join(" ", args.Select(arg => $"\"{arg}\"")));
        if (command.Length >= MaxCommandLine) { job.Dispose(); throw new InvalidDataException(); }
        var startup = new StartupInfo { Size = (uint)Marshal.SizeOf<StartupInfo>(), Flags = 1, Show = (ushort)(hidden ? 0 : 1) };
        // Variables sorted by name, each "name=value\0", the block ending with an extra "\0" (CREATE_UNICODE_ENVIRONMENT).
        var block = environment is null ? IntPtr.Zero : Marshal.StringToHGlobalUni(string.Concat(environment
            .OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase).Select(item => item.Key + "=" + item.Value + "\0")) + "\0");
        ProcessInformation native;
        try
        {
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, (hidden ? 0x08000004u : 0x00000004u) | (environment is null ? 0u : 0x400u),
                    block, cwd, ref startup, out native)) // CREATE_SUSPENDED
            { job.Dispose(); throw new Win32Exception(); }
        }
        finally { if (block != IntPtr.Zero) Marshal.FreeHGlobal(block); }
        var handle = new SafeFileHandle(native.Process, true);
        using var thread = new SafeFileHandle(native.Thread, true);
        try
        {
            // Identity is captured while the process is still suspended, so a command that ends at once cannot make the
            // start look failed after it already ran (M2-R2-003).
            if (!AssignProcessToJobObject(job, handle) || !GetProcessTimes(handle, out var created, out _, out _, out _))
                throw new Win32Exception();
            var process = Process.GetProcessById((int)native.ProcessId);
            if (ResumeThread(thread) == uint.MaxValue) { process.Dispose(); throw new Win32Exception(); }
            return new OwnedWindowsProcess(job, handle, process) { CreatedFileTime = created };
        }
        catch
        {
            TerminateProcess(handle, 1); handle.Dispose(); job.Dispose(); throw;
        }
    }

    // Processes still alive in this family (the root may have exited while its children run).
    public int ActiveProcesses =>
        !_job.IsClosed && QueryInformationJobObject(_job, 1, out var accounting, (uint)Marshal.SizeOf<JobAccounting>(), IntPtr.Zero) ? (int)accounting.ActiveProcesses : 0;

    // Whether a process id belongs to this family (the root or a child inside its job). Unknown or exited ids are not owned.
    public bool Owns(int pid)
    {
        if (_job.IsClosed || pid <= 0) return false;
        using var other = OpenProcess(0x1000, false, (uint)pid); // PROCESS_QUERY_LIMITED_INFORMATION
        return !other.IsInvalid && IsProcessInJob(other, _job, out var inside) && inside;
    }

    // Read through the handle NAJD owns: Process.ExitCode throws for a process .NET did not start itself.
    public bool RootExited => _handle.IsClosed || WaitForSingleObject(_handle, 0) == 0;
    public int? RootExitCode => !_handle.IsClosed && RootExited && GetExitCodeProcess(_handle, out var code) ? unchecked((int)code) : null;

    // Terminates the whole family and waits (bounded) until the job reports no live process. The job stays open, so a
    // family not yet seen closed can still be observed and terminated again (M2-R4-002).
    public bool Terminate()
    {
        if (_job.IsClosed) return FamilyClosed;
        TerminateJobObject(_job, 0);
        for (var attempt = 0; attempt < 50; attempt++)
        {
            if (QueryInformationJobObject(_job, 1, out var accounting, (uint)Marshal.SizeOf<JobAccounting>(), IntPtr.Zero) && accounting.ActiveProcesses == 0)
            { FamilyClosed = true; break; }
            Thread.Sleep(100);
        }
        return FamilyClosed;
    }

    public void Dispose()
    {
        if (_job.IsClosed) return;
        try { Terminate(); }
        finally
        {
            _job.Dispose();
            try { if (!Process.HasExited) Process.WaitForExit(5000); }
            finally { _handle.Dispose(); }
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct JobBasic
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct JobAccounting
    { public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, TotalProcesses, ActiveProcesses, Terminated; }
    [StructLayout(LayoutKind.Sequential)] private struct JobLimits
    { public JobBasic Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo
    {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XCount, YCount, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Stdin, Stdout, Stderr;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation
    { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(SafeFileHandle process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(SafeFileHandle job, int type, ref JobLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(SafeFileHandle job, SafeFileHandle process);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment,
        string directory, ref StartupInfo startup, out ProcessInformation process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeFileHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsProcessInJob(SafeFileHandle process, SafeFileHandle job, [MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(SafeFileHandle process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int type, out JobAccounting accounting, uint size, IntPtr returned);
}
