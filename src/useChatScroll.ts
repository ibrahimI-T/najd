import { useLayoutEffect, useRef, useState } from 'react'

export function nearBottom(element: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  return element.scrollHeight - element.clientHeight - element.scrollTop < 80
}

export function useChatScroll(sessionId: string | null, revision: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [showLatest, setShowLatest] = useState(false)
  const toLatest = () => {
    following.current = true
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
    setShowLatest(false)
  }
  useLayoutEffect(() => { toLatest() }, [sessionId])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      if (following.current) element.scrollTop = element.scrollHeight
      setShowLatest(!nearBottom(element))
    }
    update()
    const observer = new ResizeObserver(update)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [sessionId, revision])
  return { ref, showLatest, toLatest, onScroll: () => {
    if (!ref.current) return
    following.current = nearBottom(ref.current)
    setShowLatest(!following.current)
  } }
}
