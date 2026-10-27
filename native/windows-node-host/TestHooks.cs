using System.Text.Json;

// Test-only pause before an effect, so smoke tests can cancel a request at a known point (M2-R12-001/002). Active only
// when the host was started with NAJD_HOST_TEST=1, which NAJD itself never sets; otherwise it does nothing.
static class TestHooks
{
    private static readonly bool Enabled = Environment.GetEnvironmentVariable("NAJD_HOST_TEST") == "1";
    public static void Pause(JsonElement args)
    {
        if (!Enabled || args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("testPauseMs", out var value) ||
            !value.TryGetInt32(out var milliseconds) || milliseconds <= 0 || milliseconds > 5000) return;
        Thread.Sleep(milliseconds);
    }
}
