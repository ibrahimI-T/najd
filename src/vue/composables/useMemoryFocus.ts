// A learned note the owner chose in the session panel ("Memory used"): Settings > Conversation memory opens with it in view and highlighted,
// so a preference that shaped an answer is corrected in one click instead of being looked for (daily-use observation 2026-11-14).
import { ref } from 'vue'

export const memoryFocus = ref<{ kind: string; id: string } | null>(null)

// The memory trace names a learned note "<kind>:<note id>" (electron/memory-service.cjs); only learned preferences and lessons are listed
// on that page, so other kinds (saved notes, earlier chats) open the page without a highlight.
export function focusFromTrace(uid: string): { kind: string; id: string } | null {
  const match = /^(preference|experience):(.+)$/.exec(String(uid || ''))
  return match ? { kind: match[1], id: match[2] } : null
}
