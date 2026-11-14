import type { Lang, ShellMode } from './types'

// Appearance and shell preferences. Language and an explicit light/dark/system choice carry over from the earlier preference key once;
// the earlier decorative themes become Dark. Nothing secret is stored here.
export type ThemeChoice = 'light' | 'system' | 'dark'
export type Density = 'comfortable' | 'compact'
export interface Prefs {
  version: 1; language: Lang; theme: ThemeChoice; fontSize: 13 | 14 | 15 | 16; zoom: number; density: Density; mode: ShellMode
  railWidth: number; railCollapsed: boolean; workbenchWidth: number
  taskSuggestions: boolean; watermarkMedia: boolean; prompts: string[]; displayName: string
}
export const PREF_KEY = 'najd.workstation.preferences.v1'
const OLD_KEY = 'najd.preferences.v1'
export const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5]
export const RAIL = { min: 200, max: 400, base: 264 }
export const WORKBENCH = { min: 320, max: 1100, base: 560 }
export const defaults: Prefs = { version: 1, language: 'ar', theme: 'dark', fontSize: 14, zoom: 1, density: 'comfortable', mode: 'work', railWidth: RAIL.base, railCollapsed: false, workbenchWidth: WORKBENCH.base, taskSuggestions: true, watermarkMedia: false, prompts: [], displayName: '' }
const clamp = (value: unknown, { min, max, base }: { min: number; max: number; base: number }) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : base

function migrated(old: string | null): Partial<Prefs> {
  try {
    const value = old ? JSON.parse(old) as Record<string, unknown> : null
    if (!value) return {}
    return { language: value.language === 'en' ? 'en' : 'ar', theme: value.theme === 'light' ? 'light' : value.theme === 'system' ? 'system' : 'dark' }
  } catch { return {} }
}

export function loadPrefs(storage: Pick<Storage, 'getItem'>): Prefs {
  let raw: Record<string, unknown> | null = null
  try { raw = JSON.parse(storage.getItem(PREF_KEY) || 'null') } catch { raw = null }
  if (!raw || typeof raw !== 'object') { let old = null; try { old = storage.getItem(OLD_KEY) } catch {} return { ...defaults, ...migrated(old) } }
  return {
    version: 1, language: raw.language === 'en' ? 'en' : 'ar',
    theme: raw.theme === 'light' || raw.theme === 'system' ? raw.theme : 'dark',
    fontSize: [13, 14, 15, 16].includes(raw.fontSize as number) ? raw.fontSize as Prefs['fontSize'] : 14,
    zoom: ZOOMS.includes(raw.zoom as number) ? raw.zoom as number : 1,
    density: raw.density === 'compact' ? 'compact' : 'comfortable', mode: raw.mode === 'chat' ? 'chat' : 'work',
    railWidth: clamp(raw.railWidth, RAIL), railCollapsed: raw.railCollapsed === true, workbenchWidth: clamp(raw.workbenchWidth, WORKBENCH),
    taskSuggestions: raw.taskSuggestions !== false, watermarkMedia: raw.watermarkMedia === true,
    displayName: typeof raw.displayName === 'string' ? raw.displayName.slice(0, 60) : '',
    prompts: Array.isArray(raw.prompts) ? raw.prompts.filter((item): item is string => typeof item === 'string').slice(0, 100) : []
  }
}
export function savePrefs(storage: Pick<Storage, 'setItem'>, prefs: Prefs) { try { storage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch {} }
