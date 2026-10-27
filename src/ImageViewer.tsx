import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// A picture shown whole over the app; Escape, the close button or a click outside the picture closes it.
export function ImageViewer({ src, alt, ar, onClose }: { src: string; alt: string; ar: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); previous?.focus?.() }
  }, [onClose])
  return createPortal(<div className="image-viewer" role="dialog" aria-modal="true" aria-label={alt || (ar ? 'صورة' : 'Picture')} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <button type="button" ref={close} className="image-viewer-close" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><X size={18} /></button>
    <img src={src} alt={alt} />
  </div>, document.body)
}
