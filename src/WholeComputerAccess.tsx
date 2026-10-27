import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'

// Whole-computer reading (owner request 2026-10-19): on, NAJD reads any fixed drive without choosing folders; off, only
// the folders below. NAJD's own protected data and sensitive files (keys, passwords) stay refused either way.
export function WholeComputerAccess({ language, onChange }: { language: 'ar' | 'en'; onChange?: (on: boolean) => void }) {
  const ar = language === 'ar'
  const [state, setState] = useState<{ wholeComputer: boolean; drives: string[] } | null>(null)
  useEffect(() => { void window.najdFiles?.wholeComputer?.().then(setState).catch(() => setState(null)) }, [])
  if (!window.najdFiles?.wholeComputer || !state) return null
  const toggle = async () => { try { const next = await window.najdFiles!.wholeComputer!(!state.wholeComputer); setState(next); onChange?.(next.wholeComputer) } catch { /* keep the shown state */ } }
  return <div className="whole-computer">
    <HardDrive size={18} />
    <div><strong>{ar ? 'الوصول لكامل الجهاز' : 'Whole computer'}</strong>
      <p>{state.wholeComputer ? (ar ? `يقرأ نجد كل الأقراص (${state.drives.join(' ')}) دون الحاجة إلى تحديد مجلدات. ملفات نجد المحمية والمفاتيح وكلمات المرور تبقى ممنوعة.` : `NAJD reads every drive (${state.drives.join(' ')}) without choosing folders. NAJD's protected data, keys and passwords stay refused.`)
        : (ar ? 'يقرأ نجد المجلدات التي تضيفها أدناه فقط.' : 'NAJD reads only the folders you add below.')}</p></div>
    <button type="button" role="switch" className="market-switch" aria-checked={state.wholeComputer} aria-label={ar ? 'الوصول لكامل الجهاز' : 'Whole computer'} onClick={() => { void toggle() }} />
  </div>
}
