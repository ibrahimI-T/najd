import { reactive } from 'vue'

// One place that says what an action did (UI crawl 2026-11-09: export, import, save, check and stop gave no sign of success, so the owner
// could not tell a working button from a dead one). Messages disappear after a few seconds; errors stay longer.
export type Toast = { id: number; text: string; tone: 'ok' | 'info' | 'error' }
const state = reactive({ items: [] as Toast[] })
let next = 1
export function toast(text: string, tone: Toast['tone'] = 'ok'): number | null {
  if (!text) return null
  const item = { id: next++, text: text.slice(0, 300), tone }
  state.items = [...state.items.slice(-3), item]
  setTimeout(() => { state.items = state.items.filter(entry => entry.id !== item.id) }, tone === 'error' ? 8000 : 4000)
  return item.id
}
export const dismissToast = (id: number) => { state.items = state.items.filter(entry => entry.id !== id) }
export const useToasts = () => state
