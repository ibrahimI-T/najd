import type { CanvasItem } from '../ChatBlocks'

// State of the right workbench: an ordered tab strip with one active tab. Pure, so opening, closing and focus are tested without a window.
export type WorkbenchTab =
  | { id: string; kind: 'apps'; title: string }
  | { id: string; kind: 'browser'; title: string; browserId: string }
  | { id: string; kind: 'canvas'; title: string; item: CanvasItem }
  | { id: string; kind: 'details'; title: string }
  | { id: string; kind: 'file'; title: string; assetId: string }
  | { id: string; kind: 'dashboard'; title: string; documentId: string }
  | { id: string; kind: 'app'; title: string; html: string }
export interface WorkbenchState { open: boolean; full: boolean; tabs: WorkbenchTab[]; active: string | null }
export const emptyWorkbench: WorkbenchState = { open: false, full: false, tabs: [], active: null }
const MAX_TABS = 20

export function openTab(state: WorkbenchState, tab: WorkbenchTab): WorkbenchState {
  const known = state.tabs.some(item => item.id === tab.id)
  const tabs = known ? state.tabs.map(item => item.id === tab.id ? tab : item) : [...state.tabs, tab].slice(-MAX_TABS)
  return { ...state, open: true, tabs, active: tab.id }
}
export function closeTab(state: WorkbenchState, id: string): WorkbenchState {
  const index = state.tabs.findIndex(item => item.id === id)
  if (index < 0) return state
  const tabs = state.tabs.filter(item => item.id !== id)
  const active = state.active !== id ? state.active : (tabs[index] || tabs[index - 1])?.id ?? null
  return { ...state, tabs, active, full: tabs.length > 0 && state.full }
}
export function retitle(state: WorkbenchState, id: string, title: string): WorkbenchState {
  return { ...state, tabs: state.tabs.map(item => item.id === id && item.title !== title ? { ...item, title } : item) }
}
