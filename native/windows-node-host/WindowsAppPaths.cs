using Microsoft.Win32;

// Registry entries are discovery hints, never an executable authorization source.
static class WindowsAppPaths
{
    internal sealed record InstalledApp(string Path, string Source);
    public static InstalledApp? Find(string app)
    {
        var relative = app switch
        {
            "chrome" => "Google/Chrome/Application/chrome.exe",
            "edge" => "Microsoft/Edge/Application/msedge.exe",
            _ => throw new ArgumentException("Unsupported application")
        };
        var candidates = new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 }
            .Select(folder => Path.GetFullPath(Path.Combine(Environment.GetFolderPath(folder), relative)))
            .Distinct(StringComparer.OrdinalIgnoreCase).Where(TrustedFile).ToArray();
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using var hive = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
                using var key = hive.OpenSubKey($@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{Path.GetFileName(relative)}", writable: false);
                var registered = key?.GetValue("", null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
                if (registered is null || registered.Length > 1024) continue;
                var value = registered.Trim().Trim('"');
                var matching = candidates.FirstOrDefault(candidate => string.Equals(candidate, value, StringComparison.OrdinalIgnoreCase));
                if (matching is not null) return new(matching, "app-paths");
            }
            catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException)
            { /* A read-only registry failure falls back to fixed protected paths. */ }
        }
        return candidates.FirstOrDefault() is { } fallback ? new(fallback, "program-files") : null;
    }

    private static bool TrustedFile(string executable)
    {
        try
        {
            if (!File.Exists(executable) || (File.GetAttributes(executable) & FileAttributes.ReparsePoint) != 0) return false;
            for (var directory = new FileInfo(executable).Directory; directory is not null; directory = directory.Parent)
                if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) return false;
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return false; }
    }
}
