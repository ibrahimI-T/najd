import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, WandSparkles } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading, InfoNote, StatusPill } from './ui'

export function capabilityInput(id: NajdCapabilityId, path: string, query: string) {
  return id === 'najd-list-apps' ? {} : id === 'najd-read-document' ? { path: path.trim() } : { path: path.trim(), query: query.trim() }
}

export function capabilityError(error: unknown, t: Copy) {
  return error instanceof Error && error.message.includes('CAPABILITY_STORE_UNAVAILABLE') ? t.capabilities.storeError : t.capabilities.error
}

type Run = (id: NajdCapabilityId, input: { path?: string; query?: string }) => Promise<void>
type Action = (id: NajdCapabilityId, action: 'install' | 'enable' | 'disable' | 'update' | 'remove') => Promise<void>

export function CapabilityCard({ skill, t, locked, onAction, onRun }: {
  skill: NajdCapability; t: Copy; locked: boolean; onAction: Action; onRun: Run
}) {
  const [path, setPath] = useState(''), [query, setQuery] = useState('')
  const c = t.capabilities
  const action = (name: Parameters<Action>[1]) => <button type="button" className="browser-action" data-cap-action={name}
    disabled={locked} onClick={() => { void onAction(skill.id, name) }}>{c[name]}</button>
  return <div className="browser-card capability-card" data-capability={skill.id}>
    <CardHeading icon={WandSparkles} title={c.names[skill.id]} hint={c.descriptions[skill.id]} />
    <div className="browser-actions"><StatusPill ready={skill.enabled && !skill.updateRequired}>
      {skill.updateRequired ? c.updateRequired : skill.enabled ? c.enabled : skill.installed ? c.disabled : c.notInstalled}
    </StatusPill><span className="capability-permission">{c.permission}: <bdi>{skill.permission}</bdi></span></div>
    <details className="capability-details"><summary>{c.details}</summary><p><bdi>{skill.source}</bdi> · {c.version}: <bdi>{skill.version}</bdi></p><code dir="ltr">SHA-256: {skill.digest}</code></details>
    <div className="browser-actions">
      {!skill.installed ? action('install') : <>{skill.updateRequired ? action('update') : action(skill.enabled ? 'disable' : 'enable')}{action('remove')}</>}
    </div>
    <form className="capability-form" onSubmit={event => { event.preventDefault(); if (skill.enabled && !skill.updateRequired && !locked) void onRun(skill.id, capabilityInput(skill.id, path, query)) }}>
      {skill.id !== 'najd-list-apps' && <label>{c.path}<input dir="ltr" value={path} required maxLength={1024} disabled={locked} onChange={event => setPath(event.target.value)} /></label>}
      {skill.id === 'najd-find-documents' && <label>{c.query}<input value={query} required maxLength={80} disabled={locked} onChange={event => setQuery(event.target.value)} /></label>}
      <button className="browser-action" data-cap-action="run" disabled={locked || !skill.enabled || skill.updateRequired}>{c.run}</button>
    </form>
  </div>
}

export function CapabilitySettings({ t, busy, onRun }: { t: Copy; busy: boolean; onRun: Run }) {
  const [skills, setSkills] = useState<NajdCapability[] | null>(null)
  const [error, setError] = useState<string | null>(null), [working, setWorking] = useState(false)
  const [saved, setSaved] = useState(false), [sources, setSources] = useState<NajdSkillSource[] | null>(null)
  const [sourceError, setSourceError] = useState(false)
  const lock = useRef(false), mounted = useRef(false)
  const c = t.capabilities
  useEffect(() => {
    mounted.current = true
    void window.najdCapabilities?.list().then(value => { if (mounted.current) setSkills(value) })
      .catch(reason => { if (mounted.current) setError(capabilityError(reason, t)) })
    return () => { mounted.current = false }
  }, [t])
  async function perform(work: () => Promise<unknown>, recordChange = false) {
    if (lock.current || busy || !window.najdCapabilities) return
    lock.current = true; setWorking(true); setError(null); setSaved(false)
    try {
      await work()
      const value = await window.najdCapabilities.list()
      if (mounted.current) { setSkills(value); setSaved(recordChange) }
    } catch (reason) { if (mounted.current) setError(capabilityError(reason, t)) }
    finally { lock.current = false; if (mounted.current) setWorking(false) }
  }
  const onAction: Action = async (id, action) => perform(async () => {
    const api = window.najdCapabilities!
    if (action === 'enable' || action === 'disable') await api.setEnabled(id, action === 'enable')
    else await api[action](id)
  }, true)
  async function inspect() {
    await perform(async () => {
      setSourceError(false)
      try { const value = await window.najdCapabilities!.discoverSources(); if (mounted.current) setSources(value) }
      catch { if (mounted.current) setSourceError(true) }
    })
  }
  if (!window.najdCapabilities) return <p className="model-note">{c.desktop}</p>
  return <div className="browser-panel capability-panel" aria-busy={working}>
    <InfoNote icon={ShieldCheck} title={c.builtIn}><p>{c.consent}</p></InfoNote>
    {error && <p className="browser-error" role="alert">{error}</p>}
    {saved && <p className="capability-feedback" role="status">{c.saved}</p>}
    {!skills && !error && <p role="status">{c.loading}</p>}
    <button type="button" className="browser-action" data-cap-refresh disabled={working || busy} onClick={() => { void perform(async () => {}) }}>{skills ? c.refresh : c.retry}</button>
    {skills?.map(skill => <CapabilityCard key={skill.id} skill={skill} t={t} locked={working || busy} onAction={onAction}
      onRun={(id, input) => perform(() => onRun(id, input))} />)}
    <div className="browser-card capability-sources"><h3>{c.sources}</h3><p>{c.readOnly}</p>
      <button className="browser-action" type="button" data-cap-sources disabled={working || busy} onClick={() => { void inspect() }}>{c.inspect}</button>
      {sourceError && <p className="browser-error" role="alert">{c.sourceError}</p>}
      {sources?.map(source => <details className="capability-details" key={source.source} data-skill-source={source.source}>
        <summary><bdi>{source.source}</bdi> · {source.skills.length}</summary>
        <code dir="ltr">{source.sourceRevision}</code>{source.limited && <p>{c.limited}</p>}
        {source.skills.map(skill => <details className="capability-details" key={skill.relativePath}>
          <summary><bdi>{skill.name}</bdi> · {skill.compatibility === 'platform-mismatch' ? c.mismatch : skill.compatibility === 'unsupported-format' ? c.unsupported : c.review}</summary>
          {skill.description && <p dir="auto">{skill.description}</p>}
          <p>{c.author}: <bdi>{skill.declaredAuthor || c.unknown}</bdi> · {c.license}: <bdi>{skill.declaredLicense || c.unknown}</bdi> · {c.version}: <bdi>{skill.declaredVersion || c.unknown}</bdi></p>
          <p><bdi>{skill.format}</bdi> · <bdi>{skill.platforms?.join(', ') || c.unknown}</bdi></p>
          <code dir="ltr">{skill.relativePath}<br />SHA-256: {skill.digest}</code>
        </details>)}
      </details>)}
    </div>
  </div>
}
