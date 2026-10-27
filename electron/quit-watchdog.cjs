// A quit must never hang. Shutdown stops services in order and waits for them; if something blocks (a task that ignores cancellation, a service that does not stop),
// this watchdog ends the process tree after a grace period so NAJD does not stay running with its window and tray icon already gone.
function createQuitWatchdog({ graceMs = 45000, kill, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  let timer = null
  return {
    start() {
      if (timer) return
      timer = setTimer(() => { timer = null; log('quit watchdog fired'); try { kill() } catch { /* the process is ending anyway */ } }, graceMs)
      timer?.unref?.()
    },
    stop() { if (timer) { clearTimer(timer); timer = null } },
    isArmed: () => timer !== null
  }
}
module.exports = { createQuitWatchdog }
