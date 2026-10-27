import { useCallback, useEffect, useState } from 'react'
import { Blocks } from 'lucide-react'
import { CardHeading } from './ui'

const TEXT = {
  ar: {
    title: 'إضافة إضافات من الخارج', hint: 'ثبّت إضافة من متجر الإضافات أو من رابط GitHub. تحتوي الإضافة عادة على مهارات وأوامر وخوادم MCP. يعرض نجد محتواها أولًا، ثم تُفعَّل مهاراتها وتظهر أوامرها في قائمة «/». لا يُنفَّذ أي شيء منها عند التثبيت، وخوادم MCP لا تُضاف إلا بعد تأكيدك.',
    link: 'رابط الإضافة على GitHub', linkHint: 'مثال: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup', preview: 'معاينة', install: 'تثبيت',
    search: 'ابحث في متجر الإضافات', searchGo: 'بحث', market: 'المتجر', addMarket: 'إضافة متجر (owner/repo)', addMarketGo: 'إضافة', noResults: 'لا توجد نتائج.', notInstallable: 'مصدرها غير مدعوم (ليس GitHub).',
    plan: 'ستضيف هذه الإضافة:', skills: 'مهارات (إرشادات تُفعَّل)', commands: 'أوامر في قائمة «/»', servers: 'خوادم MCP مقترحة (لا تُضاف تلقائيًا)', unsupported: 'أجزاء غير مدعومة (لا تُنفَّذ)',
    installed: 'الإضافات المثبتة', none: 'لا توجد إضافات مثبتة من الخارج بعد.', remove: 'إزالة', removeConfirm: 'إزالة هذه الإضافة ومهاراتها وأوامرها؟', addServer: 'إضافة إلى الاتصالات', serverNeedsEnv: 'يحتاج متغيرات (أضفه من صفحة الاتصالات):',
    serverAdded: 'عُرض الأمر للتأكيد. إن وافقت أُضيف الخادم؛ اضغط «اتصال» في صفحة الاتصالات لتشغيله.', failed: 'تعذّرت العملية. تحقق من الرابط والاتصال.', done: 'تم التثبيت.'
  },
  en: {
    title: 'Add plugins from outside', hint: 'Install a plugin from a plugin marketplace or a GitHub link. A plugin usually bundles skills, commands and MCP servers. NAJD shows what it contains first; its skills are then enabled and its commands appear in the "/" menu. Nothing in it runs on install, and MCP servers are added only after you confirm.',
    link: 'Plugin address on GitHub', linkHint: 'Example: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup', preview: 'Preview', install: 'Install',
    search: 'Search the marketplace', searchGo: 'Search', market: 'Marketplace', addMarket: 'Add a marketplace (owner/repo)', addMarketGo: 'Add', noResults: 'No results.', notInstallable: 'Its source is not supported (not GitHub).',
    plan: 'This plugin adds:', skills: 'skills (guidance, enabled)', commands: 'commands in the "/" menu', servers: 'proposed MCP servers (never added automatically)', unsupported: 'unsupported parts (not run)',
    installed: 'Installed plugins', none: 'No plugins from outside are installed yet.', remove: 'Remove', removeConfirm: 'Remove this plugin with its skills and commands?', addServer: 'Add to Connections', serverNeedsEnv: 'Needs variables (add it on the Connections page):',
    serverAdded: 'The command is shown for confirmation. If you approve, the server is added; press Connect on the Connections page to start it.', failed: 'The operation failed. Check the address and your connection.', done: 'Installed.'
  }
}

export function PluginInstaller({ language, onOpenPage }: { language: 'ar' | 'en'; onOpenPage?(page: 'connections'): void }) {
  const t = TEXT[language]
  const [installed, setInstalled] = useState<NajdPluginInfo[]>([])
  const [url, setUrl] = useState(''), [plan, setPlan] = useState<NajdPluginPlan | null>(null)
  const [query, setQuery] = useState(''), [results, setResults] = useState<NajdPluginListing[] | null>(null), [market, setMarket] = useState('')
  const [markets, setMarkets] = useState<{ id: string; name: string; repo: string }[]>([]), [newMarket, setNewMarket] = useState('')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [failed, setFailed] = useState(false)
  const api = window.najdPlugins
  const reload = useCallback(async () => { if (!api) return; try { setInstalled(await api.list()); setMarkets(await api.markets()) } catch { /* shown on action */ } }, [api])
  useEffect(() => { void reload() }, [reload])
  if (!api) return null
  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setFailed(false); setMessage(null)
    try { await work() } catch { setFailed(true) } finally { setBusy(false) }
  }
  const look = (address: string) => run(async () => { setPlan(await api.preview(address)); setUrl(address) })
  const add = (address: string, digest?: string) => run(async () => { await api.install(address, digest); setPlan(null); setUrl(''); setMessage(t.done); await reload() })
  return <div className="browser-card plugin-installer" data-plugin-installer aria-busy={busy}>
    <CardHeading icon={Blocks} title={t.title} hint={t.hint} />
    <label className="model-choice"><span>{t.link}</span><input dir="ltr" value={url} spellCheck={false} autoComplete="off" placeholder="https://github.com/…" data-plugin="url" disabled={busy}
      onChange={event => { setUrl(event.target.value); setPlan(null) }} /></label>
    <small className="model-note" dir="ltr">{t.linkHint}</small>
    <div className="model-actions"><button type="button" className="model-refresh" data-plugin="preview" disabled={busy || !url.trim()} onClick={() => { void look(url.trim()) }}>{t.preview}</button></div>
    {plan && <div className="plugin-plan" data-plugin-plan>
      <strong>{plan.name}</strong>{plan.version && <span dir="ltr"> v{plan.version}</span>}{plan.author && <span> · {plan.author}</span>}
      <p dir="auto">{plan.description}</p>
      <p>{t.plan}</p>
      <ul>
        <li>{plan.skillCount} {t.skills}</li>
        <li>{plan.commands.length} {t.commands}{plan.commands.length > 0 && <small dir="ltr"> ({plan.commands.map(command => '/' + plan.id + '-' + command.command).join(', ')})</small>}</li>
        <li>{plan.servers.length} {t.servers}{plan.servers.map(server => <small key={server.name} dir="ltr"> · {server.name}: {server.kind === 'stdio' ? [server.command, ...(server.args || [])].join(' ') : server.url}</small>)}</li>
        {plan.unsupported.length > 0 && <li>{t.unsupported}: {plan.unsupported.join(', ')}</li>}
      </ul>
      <div className="model-actions"><button type="button" className="model-refresh" data-plugin="install" disabled={busy} onClick={() => { void add(plan.sourceUrl, plan.digest) }}>{t.install}</button></div>
    </div>}
    <h4>{t.search}</h4>
    <div className="plugin-search">
      {markets.length > 1 && <select aria-label={t.market} value={market} disabled={busy} onChange={event => setMarket(event.target.value)}><option value="">{t.market}: *</option>{markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <input value={query} placeholder={t.search} aria-label={t.search} data-plugin="query" disabled={busy} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void run(async () => setResults(await api.search(query, market || undefined))) }} />
      <button type="button" className="model-refresh" data-plugin="search" disabled={busy} onClick={() => { void run(async () => setResults(await api.search(query, market || undefined))) }}>{t.searchGo}</button>
    </div>
    {results && (results.length ? <ul className="plugin-results">{results.slice(0, 30).map(item => <li key={item.market + item.name}>
      <div><strong dir="ltr">{item.name}</strong>{item.category && <small> · {item.category}</small>}<p dir="auto">{item.description}</p></div>
      {item.sourceUrl ? <button type="button" className="model-refresh" data-plugin-pick={item.name} disabled={busy} onClick={() => { void look(item.sourceUrl!) }}>{t.preview}</button> : <small>{t.notInstallable}</small>}
    </li>)}</ul> : <p className="model-note" role="status">{t.noResults}</p>)}
    <div className="plugin-search"><input dir="ltr" value={newMarket} placeholder={t.addMarket} aria-label={t.addMarket} disabled={busy} onChange={event => setNewMarket(event.target.value)} />
      <button type="button" className="model-refresh" disabled={busy || !newMarket.trim()} onClick={() => { void run(async () => { await api.addMarket(newMarket.trim()); setNewMarket(''); await reload() }) }}>{t.addMarketGo}</button></div>
    <h4>{t.installed}</h4>
    {installed.length === 0 ? <p className="model-note">{t.none}</p> : <ul className="plugin-installed">{installed.map(item => <li key={item.id} data-plugin-installed={item.id}>
      <div><strong>{item.name}</strong>{item.version && <small dir="ltr"> v{item.version}</small>}<p dir="auto">{item.description}</p>
        <small>{item.skills} {t.skills} · {item.commands} {t.commands}</small>
        {item.servers.map(server => <div key={server.name} className="plugin-server"><small dir="ltr">{server.name}: {server.kind === 'stdio' ? [server.command, ...(server.args || [])].join(' ') : server.url}</small>
          {server.envNames && server.envNames.length > 0 ? <small> {t.serverNeedsEnv} <bdi dir="ltr">{server.envNames.join(', ')}</bdi> <button type="button" className="browser-action" onClick={() => onOpenPage?.('connections')}>{t.addServer}</button></small>
            : <button type="button" className="browser-action" disabled={busy || !window.najdMcpServers} onClick={() => {
              void run(async () => {
                const args = server.kind === 'stdio' ? server.args || [] : ['-y', 'mcp-remote@0.15.2', server.url || '']
                await window.najdMcpServers!.add({ name: server.name.slice(0, 40), command: server.kind === 'stdio' ? server.command || '' : 'npx', args, cwd: '', env: {} })
                setMessage(t.serverAdded); onOpenPage?.('connections')
              })
            }}>{t.addServer}</button>}</div>)}
      </div>
      <button type="button" className="model-refresh" disabled={busy} onClick={() => { if (window.confirm(t.removeConfirm)) void run(async () => { await api.remove(item.id); await reload() }) }}>{t.remove}</button>
    </li>)}</ul>}
    {message && <p className="model-note" role="status">{message}</p>}
    {failed && <p className="model-error" role="alert">{t.failed}</p>}
  </div>
}
