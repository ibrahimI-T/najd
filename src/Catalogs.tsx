import { SKILL_DESCRIPTIONS_AR } from './skillDescriptionsAr'
import { useCallback, useEffect, useState } from 'react'
import { Globe2, Monitor, Package, Plug, WandSparkles } from 'lucide-react'
import type { Copy } from './copy'
import { Marketplace, type MarketItem } from './Marketplace'

type Language = 'ar' | 'en'
export type CatalogView = { skills: NajdInstructionSkill[]; capabilities: NajdCapability[]; pack: NajdPackStatus | null; servers: NajdMcpServer[]; connectors: NajdConnector[]; memories: NajdMemoryNote[] }

// One read of everything the catalogs and the right panel show; every source is optional and fails quietly.
export function useCatalogs(refreshKey: unknown = null) {
  const [view, setView] = useState<CatalogView>({ skills: [], capabilities: [], pack: null, servers: [], connectors: [], memories: [] })
  const reload = useCallback(async () => {
    const [skills, capabilities, pack, servers, connectors, memories] = await Promise.all([
      window.najdSkills?.list().catch(() => []) ?? [], window.najdCapabilities?.list().catch(() => []) ?? [], window.najdPack?.status().catch(() => null) ?? null,
      window.najdMcpServers?.list().catch(() => []) ?? [], window.najdMcp?.list().catch(() => []) ?? [], window.najdMemory?.list().catch(() => []) ?? []])
    setView({ skills, capabilities, pack, servers, connectors, memories })
  }, [])
  useEffect(() => { void reload() }, [reload, refreshKey])
  return { view, reload }
}

const switchControl = (on: boolean, disabled: boolean, label: string, onToggle: () => void) =>
  <button type="button" role="switch" className="market-switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle} />

export function skillItems(view: CatalogView, language: Language, busy: boolean, toggle: (skill: NajdInstructionSkill) => void): MarketItem[] {
  const ar = language === 'ar'
  // Skills written for macOS apps are not shown on Windows (owner live test 2026-10-19).
  const mac = (skill: NajdInstructionSkill) => skill.compatibility === 'platform-mismatch' || (Array.isArray(skill.platforms) && !skill.platforms.includes('windows')) ||
    /(macos|mac os|apple notes|apple reminders|imessage|applescript|find ?my|airtags?|icloud|homebrew|xcode)/i.test(`${skill.name} ${skill.description}`) || /^apple-|^imsg|^bear-notes$|^peekaboo$/i.test(skill.name)
  return view.skills.filter(skill => !mac(skill)).map(skill => ({ id: skill.id, name: skill.name, description: ar ? SKILL_DESCRIPTIONS_AR[skill.name] || skill.description : skill.description, installed: skill.enabled || !!skill.builtIn,
    verified: !!skill.builtIn || !skill.external, icon: <WandSparkles size={24} strokeWidth={1.6} />,
    status: skill.builtIn ? (ar ? 'دليل نجد، مفعّل دائمًا' : 'NAJD guide, always on') : skill.enabled ? (ar ? 'مفعّلة' : 'On') : (ar ? 'غير مفعّلة' : 'Off'),
    control: skill.builtIn ? undefined : switchControl(skill.enabled, busy, (ar ? 'تفعيل ' : 'Turn on ') + skill.name, () => toggle(skill)) }))
}

export function pluginItems(view: CatalogView, t: Copy, language: Language): MarketItem[] {
  const ar = language === 'ar', c = t.capabilities
  const pack = view.pack
  return [
    ...(pack ? [{ id: 'office-pack', name: t.pack.title, description: ar ? 'إنشاء Word وExcel وPowerPoint وصور احترافية بدون الحاجة لبرامج Office.' : 'Professional Word, Excel, PowerPoint and images without needing Microsoft Office.',
      installed: pack.state === 'ready', verified: true, icon: <Package size={24} strokeWidth={1.6} />, status: pack.installing ? t.pack.phases[pack.installing] : t.pack.states[pack.state] }] : []),
    ...view.capabilities.map(skill => ({ id: skill.id, name: c.names[skill.id], description: c.descriptions[skill.id], installed: skill.installed, verified: true,
      status: skill.updateRequired ? c.updateRequired : skill.enabled ? c.enabled : skill.installed ? c.disabled : c.notInstalled, statusOn: skill.enabled && !skill.updateRequired }))]
}

export function connectionItems(view: CatalogView, language: Language, browserConnected: boolean): MarketItem[] {
  const ar = language === 'ar'
  const state = (on: boolean) => on ? (ar ? 'متصل' : 'Connected') : (ar ? 'غير متصل' : 'Not connected')
  return [
    { id: 'browser', name: ar ? 'متصفح نجد' : 'NAJD browser', description: ar ? 'إضافة المتصفح: يتصفح نجد في تبويبه الخاص بموافقتك.' : 'The browser extension: NAJD browses in its own tab with your approval.',
      installed: true, verified: true, icon: <Globe2 size={24} strokeWidth={1.6} />, status: state(browserConnected), statusOn: browserConnected },
    ...view.connectors.map(connector => ({ id: connector.id, name: ar ? 'التحكم بسطح المكتب' : 'Desktop control', description: ar ? 'رفيق Windows المحلي لتشغيل البرامج والتحكم بالنوافذ بموافقتك.' : 'The local Windows companion runs programs and controls windows with your approval.',
      installed: true, verified: true, icon: <Monitor size={24} strokeWidth={1.6} />, status: state(connector.state === 'connected'), statusOn: connector.state === 'connected' })),
    ...view.servers.map(server => ({ id: 'mcp:' + server.id, name: server.name, description: server.tools.length ? server.tools.slice(0, 4).map(tool => tool.title || tool.name).join('، ') : (server.serverInfo?.name || server.commandLine),
      installed: true, icon: <Plug size={24} strokeWidth={1.6} />, status: server.state === 'connected' ? `${state(true)} · ${server.tools.length} ${ar ? 'أداة' : 'tools'}` : state(false), statusOn: server.state === 'connected' }))]
}

export function SkillsCatalog({ language, busy, installedOnly }: { language: Language; busy: boolean; installedOnly: boolean }) {
  const { view, reload } = useCatalogs()
  const ar = language === 'ar'
  const toggle = async (skill: NajdInstructionSkill) => { try { await window.najdSkills?.setEnabled(skill.id, !skill.enabled) } finally { await reload() } }
  return <Marketplace id="skills" language={language} title={ar ? 'المهارات' : 'Skills'} initialInstalled={installedOnly} items={skillItems(view, language, busy, skill => { void toggle(skill) })} />
}

export function PluginsCatalog({ language, t, installedOnly }: { language: Language; t: Copy; installedOnly: boolean }) {
  const { view } = useCatalogs()
  return <Marketplace id="plugins" language={language} title={language === 'ar' ? 'الإضافات' : 'Plugins'} initialInstalled={installedOnly} items={pluginItems(view, t, language)} />
}

export function ConnectionsCatalog({ language, browserConnected, installedOnly }: { language: Language; browserConnected: boolean; installedOnly: boolean }) {
  const { view } = useCatalogs()
  return <Marketplace id="connections" language={language} title={language === 'ar' ? 'الاتصالات وخوادم MCP' : 'Connections and MCP servers'} initialInstalled={installedOnly}
    items={connectionItems(view, language, browserConnected)} />
}
