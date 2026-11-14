import { useEffect } from 'react'
import { visibleInterval } from '../useVisibleInterval'

// Runs at once, then on an interval that pauses while the window is hidden.
export function useVisibleIntervalEffect(work: () => void, ms: number) {
  useEffect(() => { work(); return visibleInterval(work, ms) }, [])
}
