// Type to queue: a question typed while NAJD is still working on the previous one waits, and is sent when that one ends. Only the last typed
// question waits (typing another replaces it), and the owner can drop it. Nothing here sends by itself while NAJD is busy.
export function createQueue({ busy, send, onChange = () => {} }) {
  let waiting = null
  return {
    // Sends at once when idle; otherwise keeps the text. Returns 'sent' or 'queued'.
    offer(text) {
      if (!busy()) { send(text); return 'sent' }
      waiting = text; onChange(true); return 'queued'
    },
    // Call whenever the state may have changed: sends the waiting question once NAJD is idle. Returns whether it sent.
    settle() {
      if (waiting === null || busy()) return false
      const text = waiting; waiting = null; onChange(false); send(text); return true
    },
    clear() { if (waiting !== null) { waiting = null; onChange(false) } },
    pending: () => waiting !== null
  }
}
