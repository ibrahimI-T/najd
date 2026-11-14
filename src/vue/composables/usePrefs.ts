import { reactive, ref, watchEffect } from 'vue'
import { loadPrefs, savePrefs, type Prefs } from '../../workstation/prefs'

// The same preference record the current renderer stores, so moving to Vue changes nothing the owner set.
const state = reactive<Prefs>(loadPrefs(localStorage))
let applied = false
// Follows the Windows light/dark switch while the theme is "System".
const systemDark = ref(matchMedia('(prefers-color-scheme: dark)').matches)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => { systemDark.value = event.matches })

export function usePrefs() {
  if (!applied) {
    applied = true
    watchEffect(() => {
      savePrefs(localStorage, { ...state, prompts: [...state.prompts] })
      const root = document.documentElement
      root.lang = state.language
      root.dir = state.language === 'ar' ? 'rtl' : 'ltr'
      root.dataset.density = state.density
      root.style.setProperty('--text-body', state.fontSize + 'px')
      const dark = state.theme === 'system' ? systemDark.value : state.theme === 'dark'
      root.dataset.theme = dark ? 'dark' : 'light'
      window.najdAppearance?.setScale(state.zoom)
    })
  }
  const s = (arabic: string, english: string) => state.language === 'ar' ? arabic : english
  const change = (patch: Partial<Prefs>) => Object.assign(state, patch)
  return { prefs: state, s, change }
}
