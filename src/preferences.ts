export type Language = 'ar' | 'en'
export type Theme = 'system' | 'light' | 'dark' | 'navy' | 'najd' | 'graphite'
// design marks the appearance generation; version 2 introduced the Najd Gold glass theme, version 3 the graphite
// night theme as the default (Najd Gold stays selectable).
export type Preferences = { language: Language; theme: Theme; accent: string; fontScale: number; design: 4 }

export const defaultPreferences: Preferences = { language: 'ar', theme: 'graphite', accent: '#2f8cff', fontScale: 1, design: 4 }
const themes: Theme[] = ['system', 'light', 'dark', 'navy', 'najd', 'graphite']

export function normalizeAccent(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toLowerCase() : defaultPreferences.accent
}

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return { ...defaultPreferences }
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return { ...defaultPreferences }
    const stored = value as Record<string, unknown>
    let theme = themes.includes(stored.theme as Theme) ? stored.theme as Theme : defaultPreferences.theme
    // One-time move from the earlier default (charcoal) to the redesigned default; any
    // other explicit choice, and every choice made after the redesign, is kept.
    if (typeof stored.design !== 'number' && theme === 'dark') theme = 'najd'
    // One-time move to the graphite default (owner request 2026-10-19): earlier Najd Gold and charcoal appearances move
    // once; any choice made after this version stays.
    // Version 4 repeats the move once for installs that already stored version 3 with charcoal (owner live test).
    if (stored.design !== 4 && (theme === 'najd' || theme === 'dark')) theme = 'graphite'
    return {
      language: stored.language === 'en' ? 'en' : 'ar',
      theme,
      accent: normalizeAccent(stored.accent),
      fontScale: typeof stored.fontScale === 'number' && [1, 1.15, 1.25].includes(stored.fontScale) ? stored.fontScale : 1,
      design: 4
    }
  } catch {
    return { ...defaultPreferences }
  }
}

export function updatePreferences(current: Preferences, change: Partial<Preferences>): Preferences {
  return { ...current, ...change }
}
