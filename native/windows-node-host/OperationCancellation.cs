// Cancellation of the one NAJD request the host is executing (M2-R11-002). NAJD sends "cancel" on its control channel
// when the user cancels the task; the host cancels only that request and keeps running (background commands keep
// running too). Capabilities check the token immediately before any effect and then refuse with CANCELLED, which
// tells NAJD that nothing was done.
static class OperationCancellation
{
    private static CancellationTokenSource _current = new();
    public static CancellationToken Token => Volatile.Read(ref _current).Token;
    public static void Begin() { var previous = Interlocked.Exchange(ref _current, new CancellationTokenSource()); previous.Dispose(); }
    public static void Cancel() => Volatile.Read(ref _current).Cancel();
}
