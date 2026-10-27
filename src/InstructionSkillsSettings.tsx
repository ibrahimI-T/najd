import { SKILL_DESCRIPTIONS_AR } from './skillDescriptionsAr'
import { useEffect, useState } from 'react'

export function InstructionSkillsSettings({ language, busy }: { language: 'ar' | 'en'; busy: boolean }) {
  const ar = language === 'ar'
  const [skills, setSkills] = useState<NajdInstructionSkill[]>([])
  const [query, setQuery] = useState(''), [working, setWorking] = useState(false), [failed, setFailed] = useState(false)
  const [url, setUrl] = useState(''), [installError, setInstallError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.najdSkills?.list().then(rows => { if (active) setSkills(rows) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  async function toggle(skill: NajdInstructionSkill) {
    if (working || busy || !window.najdSkills) return
    setWorking(true); setFailed(false)
    try { await window.najdSkills.setEnabled(skill.id, !skill.enabled); setSkills(await window.najdSkills.list()) }
    catch { setFailed(true) } finally { setWorking(false) }
  }
  async function act(work: () => Promise<unknown>) {
    if (working || busy || !window.najdSkills) return
    setWorking(true); setFailed(false); setInstallError(null)
    try { await work(); setSkills(await window.najdSkills.list()) }
    catch (error) { setInstallError(String((error as Error).message || '').match(/[A-Z_]{4,}/)?.[0] || 'FAILED') } finally { setWorking(false) }
  }
  const compat: Record<string, string> = ar
    ? { 'instructions-only': 'تعليمات فقط · جاهزة', 'needs-runtime': 'تحتاج تشغيل خارجي (غير مثبّت)', 'platform-mismatch': 'غير مخصصة لويندوز' }
    : { 'instructions-only': 'Instructions only · ready', 'needs-runtime': 'Needs external runtime (not installed)', 'platform-mismatch': 'Not intended for Windows' }
  const matching = skills.filter(skill => `${skill.name} ${skill.description} ${SKILL_DESCRIPTIONS_AR[skill.name] || ""} ${skill.source}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="upstream-skills browser-card">
    <h3>{ar ? 'مهارات نجد' : 'NAJD skills'} <small>({skills.length})</small></h3>
    <p>{ar ? 'فعّل تعليمات المهارة ليكتشفها النموذج ويقرأ المطلوب منها وقت الحاجة. التعليمات مضمّنة محليًا؛ الأدوات والمكتبات والحسابات التي تحتاجها المهارة لها تجهيز وصلاحيات مستقلة، ولم يكتمل ربطها الكامل بعد.' : 'Enable a skill for model discovery and on-demand guidance. Instructions are bundled locally. Required tools, libraries and accounts have separate setup and permissions; full executable integration is not complete.'}</p>
    <form className="skill-install" onSubmit={event => { event.preventDefault(); void act(async () => { await window.najdSkills!.install(url.trim()); setUrl('') }) }}>
      <label>{ar ? 'تثبيت مهارة من GitHub أو رابط (zip أو SKILL.md)' : 'Install a skill from GitHub or a URL (zip or SKILL.md)'}
        <input dir="ltr" value={url} maxLength={500} placeholder="https://github.com/owner/repo" onChange={event => setUrl(event.target.value)} /></label>
      <button type="submit" className="browser-action" disabled={working || busy || !url.trim()}>{ar ? 'تثبيت (معطّلة افتراضيًا)' : 'Install (disabled by default)'}</button>
      {installError && <p role="alert">{ar ? 'تعذّر التثبيت: ' : 'Install failed: '}<bdi>{installError}</bdi></p>}
      <p>{ar ? 'تُحفظ تعليمات SKILL.md فقط. أي سكربتات أو مكتبات مذكورة فيها لا تُشغَّل ولا تُثبَّت تلقائيًا.' : 'Only SKILL.md guidance is stored. Scripts and dependencies it mentions are never run or installed automatically.'}</p>
    </form>
    <label>{ar ? 'بحث المهارات' : 'Search skills'}<input className="upstream-skill-search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>
    {failed && <p role="alert">{ar ? 'تعذّر تحديث المهارات. بياناتك محفوظة؛ حاول مرة أخرى.' : 'Skills could not be updated. Existing data is preserved; try again.'}</p>}
    {matching.slice(0, 30).map(skill => <article key={skill.id} data-instruction-skill={skill.id}>
      <div className="browser-actions"><strong dir="auto">{skill.name}</strong>
        {skill.builtIn ? <span className="model-note">{ar ? 'دليل من نجد، مفعّل دائمًا' : 'NAJD guide, always on'}</span> : <button type="button" className="browser-action" aria-pressed={skill.enabled} disabled={working || busy} onClick={() => { void toggle(skill) }}>{skill.enabled ? (ar ? 'تعطيل التعليمات' : 'Disable guidance') : (ar ? 'تفعيل التعليمات' : 'Enable guidance')}</button>}
      </div>
      <p dir="auto">{ar ? SKILL_DESCRIPTIONS_AR[skill.name] || skill.description : skill.description}</p>
      {skill.external && <p><strong>{compat[skill.compatibility || 'instructions-only']}</strong> <span dir="auto">{skill.note}</span></p>}
      {skill.external && <div className="browser-actions">
        <button type="button" className="browser-action" disabled={working || busy} onClick={() => { void act(() => window.najdSkills!.update(skill.id)) }}>{ar ? 'تحديث من المصدر' : 'Update from source'}</button>
        <button type="button" className="browser-action" disabled={working || busy} onClick={() => { if (window.confirm((ar ? 'إزالة المهارة: ' : 'Remove skill: ') + skill.name + '?')) void act(() => window.najdSkills!.remove(skill.id)) }}>{ar ? 'إزالة' : 'Remove'}</button>
      </div>}
      <details><summary>{ar ? 'المصدر والتوافق' : 'Source and compatibility'}</summary>
        <p>{skill.source}</p>
        <p>{ar ? 'تعليمات فقط؛ تشغيل الأدوات المطلوبة غير مفعّل بهذا الزر.' : 'Guidance only; this toggle does not enable executable dependencies.'}</p>
        <p dir="auto">{skill.license} · {skill.platforms?.join(', ') || (ar ? 'منصات غير محددة' : 'Platforms unspecified')}</p>
        <code dir="ltr">{skill.sourceRevision}<br />{skill.relativePath}<br />SHA-256: {skill.digest}</code>
      </details>
    </article>)}
    <p>{ar ? `عرض ${Math.min(30, matching.length)} من ${matching.length} — استخدم البحث للتحديد.` : `Showing ${Math.min(30, matching.length)} of ${matching.length} — use search to narrow results.`}</p>
  </section>
}
