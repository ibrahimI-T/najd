import { onMounted, ref, type Ref } from 'vue'
import { dismissToast, toast } from './useToast'
import { usePrefs } from './usePrefs'
import { actionText } from '../../workstation/errorText'

// Reads a main-process value once on mount and after each action; an action's failure shows its code and still re-reads the value.
// `done` says what a successful action did (a text, or one built from its result); a failure is also announced (UI crawl 2026-11-09).
export const cleanError = (reason: unknown) => String((reason as Error)?.message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
export function useLoad<T>(read: (() => Promise<T>) | undefined) {
  const value = ref<T | null>(null) as Ref<T | null>, failure = ref<string | null>(null)
  const { prefs } = usePrefs()
  async function load() { if (!read) return; try { value.value = await read(); failure.value = null } catch (reason) { failure.value = cleanError(reason) } }
  // An action that takes a while (stopping the engine, a check, an install) says at once that it is working, then reports its result
  // (UI crawl 2026-11-09: the engine Stop button looked dead for the seconds it took). busy is true while an action runs.
  const busy = ref(false)
  async function run(work: () => Promise<unknown>, done?: string | ((result: any) => string | null)) {
    failure.value = null; busy.value = true
    let working: number | null = null
    const timer = setTimeout(() => { working = toast(prefs.language === 'ar' ? 'جارٍ التنفيذ…' : 'Working…', 'info') }, 700)
    try { const result = await work(); await load(); const text = typeof done === 'function' ? done(result) : done; if (text) toast(text, 'ok') }
    catch (reason) { failure.value = actionText(cleanError(reason), prefs.language === 'ar' ? 'ar' : 'en'); toast(failure.value, 'error'); void load() }
    finally { clearTimeout(timer); if (working !== null) dismissToast(working); busy.value = false }
  }
  onMounted(() => { void load() })
  return { value, failure, load, run, busy }
}
