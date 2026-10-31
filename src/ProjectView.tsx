import { useEffect, useState } from 'react'
import { FolderOpen, FolderX, MessageSquarePlus, MessageSquareText, Trash2, X } from 'lucide-react'
import { AttachmentPicker } from './AttachmentPicker'

// One project (owner request 2026-10-31, like projects in ChatGPT and Claude): its instructions, its files and folder, and
// its chats. Everything here belongs to this project only; chats outside it never see any of it.
export function ProjectView({ project, language, sessions, busy, onChanged, onRemoved, onOpenChat, onNewChat, onClose }: {
  project: NajdProject; language: 'ar' | 'en'; sessions: NajdSessionSummary[]; busy: boolean
  onChanged: (project: NajdProject) => void; onRemoved: () => void; onOpenChat: (id: string) => void; onNewChat: () => void; onClose: () => void
}) {
  const ar = language === 'ar'
  const [name, setName] = useState(project.name)
  const [instructions, setInstructions] = useState(project.instructions)
  const [assets, setAssets] = useState<NajdAsset[]>([])
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  useEffect(() => { setName(project.name); setInstructions(project.instructions); setState('idle') }, [project.id])
  // The project's files as library items (a file removed from the library is simply not shown).
  useEffect(() => {
    let live = true
    void window.najdLibrary?.list().then(items => { if (live) setAssets(project.files.map(file => items.find(item => item.id === file.id)).filter((item): item is NajdAsset => !!item)) }).catch(() => {})
    return () => { live = false }
  }, [project.id, project.files])
  const api = window.najdProjects
  const dirty = name.trim() !== project.name || instructions !== project.instructions
  async function save() {
    if (!api || !name.trim()) return
    setState('saving')
    try { onChanged(await api.save({ id: project.id, name, instructions })); setState('saved') } catch { setState('failed') }
  }
  async function run(work: () => Promise<NajdProject>) { try { onChanged(await work()) } catch { setState('failed') } }
  async function remove() {
    if (!api || !window.confirm(ar ? `حذف المشروع "${project.name}"؟ المحادثات تبقى، بس تطلع من المشروع.` : `Delete the project "${project.name}"? Its chats stay, outside the project.`)) return
    try { await api.remove(project.id); onRemoved() } catch { setState('failed') }
  }
  const chats = sessions.filter(session => project.chats.includes(session.id))
  return <section className="project-view" aria-label={ar ? 'المشروع' : 'Project'}>
    <header className="project-head">
      <input className="project-name" value={name} maxLength={80} aria-label={ar ? 'اسم المشروع' : 'Project name'} onChange={event => setName(event.target.value)} dir="auto" />
      <button type="button" className="icon-button" onClick={onClose} aria-label={ar ? 'إغلاق المشروع' : 'Close project'} title={ar ? 'إغلاق' : 'Close'}><X size={17} /></button>
    </header>
    <button type="button" className="project-new-chat" disabled={busy} onClick={onNewChat}><MessageSquarePlus size={17} /><span>{ar ? 'محادثة جديدة في المشروع' : 'New chat in this project'}</span></button>

    <div className="project-grid">
      <div className="project-card">
        <h3>{ar ? 'تعليمات المشروع' : 'Project instructions'}</h3>
        <p className="project-hint">{ar ? 'تنطبق على كل محادثة في هذا المشروع فقط.' : 'Applies to every chat in this project, and only there.'}</p>
        <textarea value={instructions} maxLength={8000} rows={7} dir="auto" placeholder={ar ? 'مثال: هذا موقع مطعم، اكتب بالعربي، استخدم ألوان الهوية...' : 'For example: this is a restaurant website; write in Arabic; use the brand colours...'}
          onChange={event => { setInstructions(event.target.value); setState('idle') }} />
        <div className="project-actions">
          <button type="button" className="browser-action" disabled={!dirty || !name.trim() || state === 'saving'} onClick={() => { void save() }}>{ar ? 'حفظ' : 'Save'}</button>
          {state === 'saved' && <span className="project-status" role="status">{ar ? 'انحفظ' : 'Saved'}</span>}
          {state === 'failed' && <span className="project-status failed" role="alert">{ar ? 'ما انحفظ، جرّب مرة ثانية' : 'Not saved; try again'}</span>}
        </div>
      </div>

      <div className="project-card">
        <h3>{ar ? 'ملفات المشروع' : 'Project files'}</h3>
        <p className="project-hint">{ar ? 'ترفق تلقائيًا مع محادثات المشروع (20 ملف بحد أقصى).' : 'Attached to the project\'s chats automatically (up to 20).'}</p>
        {assets.length ? <ul className="project-files">{assets.map(item => <li key={item.id}><bdi dir="auto">{item.name}</bdi>
          <button type="button" className="icon-button" aria-label={(ar ? 'إزالة من المشروع: ' : 'Remove from project: ') + item.name}
            onClick={() => { void run(() => api!.setFiles(project.id, assets.filter(asset => asset.id !== item.id).map(asset => asset.id))) }}><Trash2 size={14} /></button></li>)}</ul>
          : <p className="project-empty">{ar ? 'ما فيه ملفات بعد.' : 'No files yet.'}</p>}
        <div className="project-actions">
          <AttachmentPicker language={language} selected={assets} disabled={busy} onBusyChange={() => {}}
            onChange={items => { void run(() => api!.setFiles(project.id, items.slice(0, 20).map(item => item.id))) }} />
          <span className="project-add-label">{ar ? 'أضف ملفات أو اخترها من المكتبة' : 'Add files or pick them from the library'}</span>
        </div>
        <h3 className="project-sub">{ar ? 'مجلد المشروع' : 'Project folder'}</h3>
        {project.folder ? <p className="project-folder"><bdi dir="ltr">{project.folder}</bdi>
          <button type="button" className="icon-button" aria-label={ar ? 'فك ربط المجلد' : 'Unlink folder'} title={ar ? 'فك ربط المجلد' : 'Unlink folder'}
            onClick={() => { void run(() => api!.clearFolder(project.id)) }}><FolderX size={15} /></button></p>
          : <p className="project-empty">{ar ? 'اختر مجلد يشتغل فيه نجد على ملفات المشروع.' : 'Choose a folder where NAJD works on the project files.'}</p>}
        <div className="project-actions"><button type="button" className="browser-action" onClick={() => { void run(() => api!.chooseFolder(project.id)) }}>
          <FolderOpen size={15} /><span>{project.folder ? (ar ? 'تغيير المجلد' : 'Change folder') : (ar ? 'اختيار مجلد' : 'Choose folder')}</span></button></div>
      </div>

      <div className="project-card">
        <h3>{ar ? 'محادثات المشروع' : 'Project chats'}</h3>
        {chats.length ? <ul className="project-chats">{chats.map(chat => <li key={chat.id}>
          <button type="button" disabled={busy} onClick={() => onOpenChat(chat.id)}><MessageSquareText size={15} /><span dir="auto">{chat.title || (ar ? 'محادثة جديدة' : 'New chat')}</span></button></li>)}</ul>
          : <p className="project-empty">{ar ? 'ابدأ أول محادثة في المشروع.' : 'Start the first chat in this project.'}</p>}
      </div>
    </div>
    <button type="button" className="project-delete" onClick={() => { void remove() }}><Trash2 size={15} /><span>{ar ? 'حذف المشروع' : 'Delete project'}</span></button>
  </section>
}
