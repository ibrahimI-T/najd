import { useEffect, useState } from 'react'
import { FileText, Film, Image as ImageIcon, X } from 'lucide-react'
import { ImageViewer } from './ImageViewer'

// The picture of a library asset (an image, or a video's first frame), or null.
export function useThumbnail(id: string, enabled = true) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (enabled && window.najdLibrary?.thumbnail) void window.najdLibrary.thumbnail(id).then(value => { if (alive) setUrl(value) }).catch(() => {})
    return () => { alive = false }
  }, [id, enabled])
  return url
}

// Pictures and videos are shown as a large preview tile (click to see it whole, ✕ to remove); other files as a named chip.
function Chip({ item, ar, disabled, onRemove }: { item: NajdAsset; ar: boolean; disabled: boolean; onRemove: () => void }) {
  const visual = item.kind === 'image' || item.kind === 'video'
  const thumb = useThumbnail(item.id, visual)
  const [open, setOpen] = useState(false)
  const remove = `${ar ? 'إزالة' : 'Remove'} ${item.name}`
  if (visual && thumb) return <div className="attachment-tile" data-kind={item.kind} title={item.name}>
    <button type="button" className="attachment-tile-view" onClick={() => setOpen(true)} aria-label={(ar ? 'عرض ' : 'View ') + item.name}><img src={thumb} alt="" />{item.kind === 'video' && <Film size={16} className="attachment-tile-badge" />}</button>
    <button type="button" className="attachment-tile-remove" disabled={disabled} onClick={onRemove} aria-label={remove}><X size={12} /></button>
    {open && <ImageViewer src={thumb} alt={item.name} ar={ar} onClose={() => setOpen(false)} />}
  </div>
  const Icon = item.kind === 'image' ? ImageIcon : item.kind === 'video' ? Film : FileText
  return <button type="button" className="attachment-chip" disabled={disabled} onClick={onRemove} aria-label={remove} title={item.name}>
    <Icon size={14} /><bdi>{item.name}</bdi><X size={12} aria-hidden="true" />
  </button>
}

export function AttachmentChips({ items, ar, disabled, onChange }: { items: NajdAsset[]; ar: boolean; disabled: boolean; onChange: (items: NajdAsset[]) => void }) {
  if (!items.length) return null
  return <div className="attachment-chips">{items.map(item =>
    <Chip key={item.id} item={item} ar={ar} disabled={disabled} onRemove={() => onChange(items.filter(asset => asset.id !== item.id))} />)}</div>
}

// Files dropped on, or pictures pasted into, the composer are imported into the library and attached.
export async function importFromTransfer(transfer: DataTransfer, kind: 'drop' | 'paste'): Promise<NajdAsset[]> {
  const library = window.najdLibrary
  if (!library) return []
  if (kind === 'drop' && transfer.files.length) return library.importDropped(Array.from(transfer.files).slice(0, 8))
  const pictures = Array.from(transfer.items).filter(item => item.kind === 'file' && /^image\/(png|jpeg|webp|gif|bmp)$/.test(item.type))
    .map(item => item.getAsFile()).filter((file): file is File => !!file).slice(0, 4)
  const imported: NajdAsset[] = []
  for (const [index, file] of pictures.entries()) {
    const extension = file.type.split('/')[1].replace('jpeg', 'jpg')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    imported.push(await library.importBytes(`Pasted image ${stamp}${pictures.length > 1 ? '-' + (index + 1) : ''}.${extension}`, await file.arrayBuffer()))
  }
  return imported
}
