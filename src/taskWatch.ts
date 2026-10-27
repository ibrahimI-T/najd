// Waits for the next state of a running task. Main pushes "task changed" notifications (ids only); this fetches the
// snapshot once per change instead of polling every 100 ms. A slow fallback keeps working if a notification is missed
// (or when the page runs without the Electron bridge).
const PUSH_FALLBACK_MS = 2000
const POLL_MS = 400
const COALESCE_MS = 40
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export async function nextTaskState(task: NajdTask): Promise<NajdTask> {
  const seen = task.lastSequence ?? 0
  const push = window.najdAgent?.onTaskChanged
  let wake: () => void = () => {}
  const changed = new Promise<void>(resolve => { wake = resolve })
  const off = push?.((id, sequence) => { if (id === task.id && sequence > seen) wake() })
  try {
    // A change can land between the last snapshot and this subscription, so look once before waiting.
    let fresh = await window.najdCore!.getTask(task.id)
    if (fresh.state !== task.state || (fresh.lastSequence ?? 0) > seen) return fresh
    await Promise.race([changed, sleep(push ? PUSH_FALLBACK_MS : POLL_MS)])
    await sleep(COALESCE_MS) // bursts of events become one fetch
    fresh = await window.najdCore!.getTask(task.id)
    return fresh
  } finally { off?.() }
}
