using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text.Json;
using OpenClaw.Shared;

// najd.screen.capture (docs/AGENT-PLATFORM-M2-PLAN.md, M2e): one window (rendered with PrintWindow, so it can be
// covered) or the primary screen, scaled down to at most 1280 px on the longer side and written as a PNG to the
// path NAJD gives. NAJD approves every capture in Electron (screens can contain private data).
sealed class ScreenCaptureCapability : NodeCapabilityBase
{
    private const int MaxSide = 1280;
    public ScreenCaptureCapability() : base(NullLogger.Instance) { }
    public override string Category => "najd";
    public override IReadOnlyList<string> Commands => ["najd.screen.capture"];

    public override Task<NodeInvokeResponse> ExecuteAsync(NodeInvokeRequest request)
    {
        try { return Task.FromResult(request.Command == "najd.screen.capture" ? Capture(request.Args) : Error("PERMISSION_DENIED")); }
        catch (InvalidOperationException) { return Task.FromResult(Error("STALE_TARGET")); }
        catch { return Task.FromResult(Error("CAPTURE_FAILED")); }
    }

    private NodeInvokeResponse Capture(JsonElement args)
    {
        var output = GetStringArg(args, "output");
        if (string.IsNullOrEmpty(output) || !Path.IsPathFullyQualified(output) || !output.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ||
            !Directory.Exists(Path.GetDirectoryName(output))) return Error("INVALID_INPUT");
        var raw = GetStringArg(args, "window");
        IntPtr window = IntPtr.Zero;
        Func<bool> targetStill = () => true; // the whole screen has no target to recheck
        if (!string.IsNullOrEmpty(raw))
        {
            // Same identity rule as desktop actions: the handle must still belong to the same process instance.
            if (!long.TryParse(raw, out var handle) || !args.TryGetProperty("pid", out var pidElement) || !long.TryParse(GetStringArg(args, "created"), out var created))
                return Error("INVALID_INPUT");
            window = new IntPtr(handle);
            var expectedPid = pidElement.GetInt32();
            var expectedTitle = GetStringArg(args, "title");
            // The same process instance, still showing what was approved (a changed title means another tab or
            // document) (M2-R10-001). Checked now, right before capturing and again afterwards (M2-R14-004).
            targetStill = () =>
            {
                if (!IsWindow(window)) return false;
                GetWindowThreadProcessId(window, out var pid);
                long? live = null;
                try { using var process = System.Diagnostics.Process.GetProcessById((int)pid); live = process.StartTime.ToFileTimeUtc(); } catch { }
                if ((int)pid != expectedPid || live != created) return false;
                // The whole title, as for actions and reads (M2-R27-001).
                return expectedTitle is not null && expectedTitle == DesktopCapability.WindowTitle(window);
            };
            if (!targetStill()) throw new InvalidOperationException();
        }
        int width, height;
        if (window != IntPtr.Zero) { GetWindowRect(window, out var rect); width = rect.Right - rect.Left; height = rect.Bottom - rect.Top; }
        else { width = GetSystemMetrics(0); height = GetSystemMetrics(1); }
        if (width <= 0 || height <= 0 || width > 16384 || height > 16384) return Error("CAPTURE_FAILED");
        TestHooks.Pause(args);
        if (OperationCancellation.Token.IsCancellationRequested) return Error("CANCELLED"); // no picture is taken for a cancelled task (M2-R11-002)
        if (!targetStill()) throw new InvalidOperationException();
        var screen = GetDC(IntPtr.Zero);
        var memory = CreateCompatibleDC(screen);
        var bitmap = CreateCompatibleBitmap(screen, width, height);
        var old = SelectObject(memory, bitmap);
        byte[] pixels;
        try
        {
            var ok = window != IntPtr.Zero ? PrintWindow(window, memory, 2) : BitBlt(memory, 0, 0, width, height, screen, 0, 0, 0x00CC0020);
            if (!ok) return Error("CAPTURE_FAILED");
            var info = new BitmapInfo { Size = 40, Width = width, Height = -height, Planes = 1, BitCount = 32 };
            pixels = new byte[width * height * 4];
            SelectObject(memory, old);
            if (GetDIBits(memory, bitmap, 0, (uint)height, pixels, ref info, 0) == 0) return Error("CAPTURE_FAILED");
        }
        finally { DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(IntPtr.Zero, screen); }
        // A window that changed while it was being captured: the picture is discarded, never written (M2-R14-004).
        if (!targetStill()) throw new InvalidOperationException();
        var scale = Math.Min(1.0, (double)MaxSide / Math.Max(width, height));
        var outWidth = Math.Max(1, (int)(width * scale)); var outHeight = Math.Max(1, (int)(height * scale));
        File.WriteAllBytes(output, EncodePng(pixels, width, height, outWidth, outHeight));
        return Success(new { output, width = outWidth, height = outHeight });
    }

    // Minimal PNG writer (RGB, no filter, zlib) with nearest-neighbour scaling from 32-bit BGRA pixels.
    private static byte[] EncodePng(byte[] bgra, int width, int height, int outWidth, int outHeight)
    {
        var raw = new byte[(outWidth * 3 + 1) * outHeight];
        for (var y = 0; y < outHeight; y++)
        {
            var sourceY = (int)((long)y * height / outHeight);
            var row = y * (outWidth * 3 + 1);
            raw[row] = 0;
            for (var x = 0; x < outWidth; x++)
            {
                var source = (sourceY * width + (int)((long)x * width / outWidth)) * 4;
                raw[row + 1 + x * 3] = bgra[source + 2]; raw[row + 2 + x * 3] = bgra[source + 1]; raw[row + 3 + x * 3] = bgra[source];
            }
        }
        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Fastest, leaveOpen: true)) zlib.Write(raw);
        using var png = new MemoryStream();
        png.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        var header = new byte[13];
        WriteBigEndian(header, 0, outWidth); WriteBigEndian(header, 4, outHeight);
        header[8] = 8; header[9] = 2; // 8-bit RGB
        Chunk(png, "IHDR", header); Chunk(png, "IDAT", compressed.ToArray()); Chunk(png, "IEND", []);
        return png.ToArray();
    }
    private static void WriteBigEndian(byte[] buffer, int offset, int value)
    { buffer[offset] = (byte)(value >> 24); buffer[offset + 1] = (byte)(value >> 16); buffer[offset + 2] = (byte)(value >> 8); buffer[offset + 3] = (byte)value; }
    private static void Chunk(Stream stream, string type, byte[] data)
    {
        var length = new byte[4]; WriteBigEndian(length, 0, data.Length); stream.Write(length);
        var typed = new byte[4 + data.Length]; System.Text.Encoding.ASCII.GetBytes(type).CopyTo(typed, 0); data.CopyTo(typed, 4);
        stream.Write(typed);
        var crc = new byte[4]; WriteBigEndian(crc, 0, (int)Crc32(typed)); stream.Write(crc);
    }
    private static readonly uint[] CrcTable = Enumerable.Range(0, 256).Select(n =>
    { var c = (uint)n; for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; return c; }).ToArray();
    private static uint Crc32(byte[] data) { var c = 0xFFFFFFFFu; foreach (var b in data) c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8); return c ^ 0xFFFFFFFFu; }

    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapInfo
    { public uint Size; public int Width, Height; public ushort Planes, BitCount; public uint Compression, SizeImage; public int XPels, YPels; public uint ClrUsed, ClrImportant; }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool BitBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint lines, byte[] bits, ref BitmapInfo info, uint usage);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(IntPtr item);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteDC(IntPtr dc);
}
