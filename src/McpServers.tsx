import { useEffect, useRef, useState } from 'react'
import { Server, Plus, Trash2 } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading, InfoNote, StatusPill } from './ui'
import { visibleInterval } from './useVisibleInterval'

// Well-known reference MCP servers. "<…>" marks a value the user must fill in before adding.
export const PRESETS = [
  { id: 'filesystem', name: 'Files', program: 'npx' as const, args: ['-y', '@modelcontextprotocol/server-filesystem', '<folder>'] },
  { id: 'fetch', name: 'Fetch', program: 'uvx' as const, args: ['mcp-server-fetch'] },
  { id: 'memory', name: 'Memory graph', program: 'npx' as const, args: ['-y', '@modelcontextprotocol/server-memory'] },
  { id: 'thinking', name: 'Sequential thinking', program: 'npx' as const, args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
  { id: 'git', name: 'Git', program: 'uvx' as const, args: ['mcp-server-git', '--repository', '<folder>'] },
  { id: 'time', name: 'Time', program: 'uvx' as const, args: ['mcp-server-time'] },
  // REA (github.com/morluto/rea, MIT): reverse engineering of apps and binaries. Pinned to a version; it can run the targets it analyses with the owner's permissions.
  { id: 'rea', name: 'REA (reverse engineering)', program: 'npx' as const, args: ['-y', 'rea-agents@6.7.0', '--mcp'] },
  // Trail-Code (github.com/trailhq/Trail-Code, MIT): a local code map for the model (find code, file API, call traces) so it reads less. Pinned; the preset runs only its MCP server and never `trail init`, which edits user-level agent settings.
  { id: 'trail', name: 'Trail-Code (code map)', program: 'npx' as const, args: ['-y', '@trailhq/trail-code@0.23.1', 'mcp'] },
  // Services you sign in to (Canva, Figma, Notion, Linear...): mcp-remote (npm, pinned) bridges any remote MCP address and opens the sign-in page in your
  // own browser, so NAJD never sees the password. Canva's address is from canva.dev/docs/mcp. For another service replace the address.
  { id: 'canva', name: 'Canva (sign in)', program: 'npx' as const, args: ['-y', 'mcp-remote@0.15.2', 'https://mcp.canva.com/mcp'] },
  { id: 'remote', name: 'Another service (sign in)', program: 'npx' as const, args: ['-y', 'mcp-remote@0.15.2', '<https-address>'] },
  // Image and video models from a Replicate account (official server, Apache-2.0). Every run is billed to that account by Replicate.
  { id: 'replicate', name: 'Replicate (images and video)', program: 'npx' as const, args: ['-y', 'replicate-mcp@0.9.0'], env: 'REPLICATE_API_TOKEN=<your-token>' },
  // fal.ai hosts 1,000+ image, video and audio models behind one key; its official server is remote (mcp.fal.ai/mcp) and takes the key as a bearer header.
  // The key lives in the encrypted environment, never in the arguments (mcp-remote expands ${AUTH_HEADER} itself).
  { id: 'fal', name: 'fal (images, video, audio)', program: 'npx' as const, args: ['-y', 'mcp-remote@0.15.2', 'https://mcp.fal.ai/mcp', '--header', 'Authorization:${AUTH_HEADER}'], env: 'AUTH_HEADER=Bearer <your-fal-key>' },
  // ElevenLabs (official, MIT): speech, voices and audio. Billed to your ElevenLabs account.
  { id: 'elevenlabs', name: 'ElevenLabs (voice and audio)', program: 'uvx' as const, args: ['elevenlabs-mcp==0.12.2'], env: 'ELEVENLABS_API_KEY=<your-key>' },
  // Any other hosted service that takes an API key as a bearer token (Stability, Runway, Luma... when they publish a remote address).
  { id: 'remote-key', name: 'Another service (API key)', program: 'npx' as const, args: ['-y', 'mcp-remote@0.15.2', '<https-address>', '--header', 'Authorization:${AUTH_HEADER}'], env: 'AUTH_HEADER=Bearer <your-key>' }
]
export const hasPlaceholder = (text: string) => /<[^>]+>/.test(text)
const lines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
// KEY=VALUE lines; the value may contain "=".
function parseEnv(text: string) {
  const env: Record<string, string> = {}
  for (const line of lines(text)) { const at = line.indexOf('='); if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1) }
  return env
}

export function McpServers({ t, busy }: { t: Copy; busy: boolean }) {
  const c = t.capabilities, s = c.servers
  const [items, setItems] = useState<NajdMcpServer[] | null>(null)
  const [adding, setAdding] = useState(false), [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', command: '', args: '', cwd: '', env: '' })
  const lock = useRef(false)
  const api = window.najdMcpServers
  const [programs, setPrograms] = useState<{ npx: boolean; uvx: boolean } | null>(null)
  useEffect(() => { if (adding) void api?.programs?.().then(setPrograms).catch(() => setPrograms(null)) }, [adding, api])
  useEffect(() => {
    let alive = true
    const refresh = async () => { try { const value = await api?.list(); if (alive && value) setItems(value) } catch {} }
    void refresh()
    const stopPolling = visibleInterval(() => { if (!lock.current) void refresh() }, 2000)
    return () => { alive = false; stopPolling() }
  }, [api])
  if (!api) return null
  const errorText = (code?: string | null) => (code && (s.errors as Record<string, string>)[code]) || c.error
  async function act(work: () => Promise<unknown>) {
    if (lock.current || busy) return
    lock.current = true; setWorking(true); setMessage(null)
    try { await work(); setItems(await api!.list()) }
    catch (error) { setMessage(errorText(String((error as Error)?.message || '').replace(/^.*?([A-Z_]{4,}).*$/, '$1'))) }
    finally { lock.current = false; setWorking(false) }
  }
  const placeholder = hasPlaceholder(form.args) || hasPlaceholder(form.env)
  const save = () => act(async () => {
    if (placeholder) throw new Error('PLACEHOLDER')
    const result = await api.add({ name: form.name, command: form.command, args: lines(form.args), cwd: form.cwd, env: parseEnv(form.env) })
    // Secret values leave the renderer state as soon as main has them.
    setForm(current => ({ ...current, env: '' }))
    if (result.status === 'added') { setAdding(false); setForm({ name: '', command: '', args: '', cwd: '', env: '' }); setMessage(s.added) } else setMessage(s.cancelled)
  })
  const field = (key: keyof typeof form, label: string, extra: Record<string, unknown> = {}) =>
    <label className="model-choice"><span>{label}</span><input dir="ltr" value={form[key]} spellCheck={false} autoComplete="off" data-mcp-field={key}
      onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} {...extra} /></label>
  const area = (key: keyof typeof form, label: string, hint?: string) =>
    <label className="model-choice"><span>{label}</span><textarea dir="ltr" rows={3} value={form[key]} spellCheck={false} autoComplete="off" data-mcp-field={key}
      onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} />{hint && <small>{hint}</small>}</label>

  return <div className="browser-panel mcp-servers" aria-busy={working}>
    <InfoNote icon={Server} title={s.title}><p>{s.help}</p></InfoNote>
    {message && <p role="status" className="model-note" data-mcp-message>{message}</p>}
    {items?.length === 0 && !adding && <p className="model-note">{s.none}</p>}
    {items?.map(item => <div className="browser-card" key={item.id} data-mcp-server={item.id}>
      <CardHeading icon={Server} title={item.name} hint={item.serverInfo ? item.serverInfo.name + ' ' + item.serverInfo.version : undefined} />
      <code dir="ltr" className="mcp-command">{item.commandLine}</code>
      <div className="browser-actions">
        <StatusPill ready={item.state === 'connected'}><span role="status" data-mcp-server-state={item.state}>
          {c.states[item.state]}{item.state === 'connected' ? ' · ' + item.tools.length + ' ' + s.tools : ''}{item.state === 'failed' && item.error ? ' · ' + errorText(item.error) : ''}</span></StatusPill>
        <button className="browser-action" type="button" disabled={working || busy || item.state === 'connecting'} data-mcp-server-action={item.state === 'connected' ? 'disconnect' : 'connect'}
          onClick={() => { void act(() => item.state === 'connected' ? api.disconnect(item.id) : api.connect(item.id)) }}>{item.state === 'connected' ? c.disconnect : c.connect}</button>
        <button className="browser-action" type="button" disabled={working || busy} data-mcp-server-action="remove"
          onClick={() => { if (window.confirm(s.removeConfirm)) void act(() => api.remove(item.id)) }}><Trash2 size={14} aria-hidden="true" /> {s.remove}</button>
      </div>
      {(item.tools.length > 0 || item.envNames.length > 0) && <details className="capability-details"><summary>{c.details}</summary>
        {item.envNames.length > 0 && <p>{s.secrets}: <bdi dir="ltr">{item.envNames.join(', ')}</bdi></p>}
        {item.tools.length > 0 && <ul>{item.tools.map(tool => <li key={tool.name}><bdi dir="ltr">{tool.name}</bdi>{tool.hints.readOnly ? ' · ' + s.readOnly : ''}{tool.description ? <small> — {tool.description}</small> : null}</li>)}</ul>}
      </details>}
    </div>)}
    {adding ? <div className="browser-card mcp-add">
      <div className="mcp-presets" role="group" aria-label={s.presets}><span>{s.presets}</span>
        {PRESETS.map(preset => <button key={preset.id} type="button" className="browser-action" data-mcp-preset={preset.id} disabled={working}
          onClick={() => setForm({ name: preset.name, command: preset.program, args: preset.args.join('\n'), cwd: '', env: ('env' in preset && preset.env) || '' })}>{preset.name}</button>)}</div>
      {programs && (form.command === 'npx' || form.command === 'uvx') && !programs[form.command] && <p className="model-note" role="status" data-mcp-missing={form.command}>{form.command === 'npx' ? s.needsNode : s.needsUv}</p>}
      {placeholder && <p className="model-note" role="status">{s.fillPlaceholder}</p>}
      {field('name', s.name, { dir: 'auto', maxLength: 40 })}
      <div className="mcp-command-row">
        {field('command', s.command, { placeholder: s.commandHint })}
        <button className="browser-action" type="button" disabled={working} onClick={() => { void api.pickCommand().then(file => { if (file) setForm(current => ({ ...current, command: file })) }) }}>{s.browse}</button>
        <button className="browser-action" type="button" disabled={working} onClick={() => setForm(current => ({ ...current, command: 'najd-node' }))}>{s.bundled}</button>
      </div>
      {area('args', s.args)}
      {field('cwd', s.cwd)}
      {area('env', s.env, s.envHint)}
      <div className="browser-actions">
        <button className="browser-action primary" type="button" disabled={working || busy || !form.name.trim() || !form.command.trim()} data-mcp-server-action="save" onClick={() => { void save() }}>{s.save}</button>
        <button className="browser-action" type="button" disabled={working} onClick={() => { setAdding(false); setForm({ name: '', command: '', args: '', cwd: '', env: '' }) }}>{s.cancel}</button>
      </div>
    </div> : <button className="browser-action" type="button" disabled={working || busy} data-mcp-server-action="add" onClick={() => { setAdding(true); setMessage(null) }}><Plus size={14} aria-hidden="true" /> {s.add}</button>}
  </div>
}
