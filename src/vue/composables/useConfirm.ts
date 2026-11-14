import { reactive } from 'vue'

// The app's own confirmation (live test 2026-11-09: window.confirm showed a system box titled "najd-agent" with English OK/Cancel in
// the Arabic interface). One question at a time; answering or closing resolves it.
type Pending = { text: string; action: string; resolve: (value: boolean) => void }
const state = reactive({ pending: null as Pending | null })
export function confirmAction(text: string, action: string): Promise<boolean> {
  state.pending?.resolve(false)
  return new Promise(resolve => { state.pending = { text, action, resolve } })
}
export function answerConfirm(value: boolean) { const current = state.pending; state.pending = null; current?.resolve(value) }
export const useConfirmState = () => state
