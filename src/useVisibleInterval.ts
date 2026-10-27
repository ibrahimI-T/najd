import { useEffect, useRef } from 'react'

// The window counts as hidden when the page says so OR the main process reports the window minimized/hidden.
// Electron can keep document.visibilityState "visible" for a minimized window on Windows (measured with the
// profiler: IsIconic true while the page stayed visible), so the main-process signal is authoritative too.
const isHidden = () => document.visibilityState !== 'visible' || window.najdWindow?.isHidden() === true

// Runs `callback` every `ms` only while the window is shown. Hidden or minimized windows do no polling;
// when the window is shown again the callback runs once immediately, then the interval resumes.
// Returns a function that stops it for good (call it from an effect cleanup).
export function visibleInterval(callback: () => void, ms: number): () => void {
  let timer: number | undefined
  const start = () => { if (timer === undefined) timer = window.setInterval(callback, ms) }
  const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined } }
  const onChange = () => {
    if (!isHidden()) { if (timer === undefined) { callback(); start() } }
    else stop()
  }
  if (!isHidden()) start()
  document.addEventListener('visibilitychange', onChange)
  const unsubscribe = window.najdWindow?.onHiddenChange(onChange)
  return () => { stop(); document.removeEventListener('visibilitychange', onChange); unsubscribe?.() }
}

// Hook form; pass `enabled = false` to pause it.
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const saved = useRef(callback)
  saved.current = callback
  useEffect(() => enabled ? visibleInterval(() => saved.current(), ms) : undefined, [ms, enabled])
}
