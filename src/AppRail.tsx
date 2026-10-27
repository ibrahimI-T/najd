import { Blocks, Brain, CircleHelp, Library, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plug, Plus, Settings2, WandSparkles } from 'lucide-react'
import type { ComponentType } from 'react'
import najdMedallion from './assets/najd-medallion.jpg'
import type { Copy } from './copy'

type RailSection = 'skills' | 'plugins' | 'connections' | 'memory' | 'knowledge'

// Slim navigation rail: every entry opens a real destination; nothing here is decorative
// except the medallion.
export function AppRail({ t, language, settingsOpen, section, sidebarOpen, busy, onChat, onNewChat, onSettings, onToggleSidebar }: {
  t: Copy; language: 'ar' | 'en'; settingsOpen: boolean; section: string; sidebarOpen: boolean; busy: boolean
  onChat: () => void; onNewChat: () => void; onSettings: (section: 'general' | RailSection) => void; onToggleSidebar: () => void
}) {
  const ar = language === 'ar'
  const item = (key: string, label: string, Icon: ComponentType<{ size?: number; strokeWidth?: number }>, active: boolean, onClick: () => void, extra = '') =>
    <button key={key} type="button" className={'rail-item ' + extra + (active ? ' active' : '')} aria-label={label} title={label}
      aria-current={active ? 'page' : undefined} onClick={onClick}><Icon size={19} strokeWidth={1.7} /><span>{label}</span></button>
  const inSettings = (id: string) => settingsOpen && section === id
  return <nav className="app-rail" aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
    <img className="rail-logo" src={najdMedallion} alt="NAJD AGENT" width={40} height={40} />
    <button type="button" className="rail-item rail-toggle" aria-label={sidebarOpen ? t.collapseSidebar : t.expandSidebar}
      title={sidebarOpen ? t.collapseSidebar : t.expandSidebar} aria-expanded={sidebarOpen} onClick={onToggleSidebar}>
      {sidebarOpen ? <PanelLeftClose size={18} strokeWidth={1.7} /> : <PanelLeftOpen size={18} strokeWidth={1.7} />}</button>
    <button type="button" className="rail-item rail-new" aria-label={t.newChat} title={t.newChat} disabled={busy} onClick={onNewChat}><Plus size={19} strokeWidth={1.8} /></button>
    <div className="rail-group">
      {item('chat', ar ? 'المحادثة' : 'Chat', MessageSquareText, !settingsOpen, onChat)}
      {item('skills', ar ? 'المهارات' : 'Skills', WandSparkles, inSettings('skills'), () => onSettings('skills'))}
      {item('plugins', ar ? 'الإضافات' : 'Plugins', Blocks, inSettings('plugins'), () => onSettings('plugins'))}
      {item('connections', ar ? 'الاتصالات وMCP' : 'Connections and MCP', Plug, inSettings('connections'), () => onSettings('connections'))}
      {item('memory', ar ? 'الذاكرة' : 'Memory', Brain, inSettings('memory'), () => onSettings('memory'))}
      {item('knowledge', ar ? 'قواعد المعرفة' : 'Knowledge bases', Library, inSettings('knowledge'), () => onSettings('knowledge'))}
    </div>
    <div className="rail-spacer" />
    {item('settings', t.settings, Settings2, settingsOpen && !['skills', 'plugins', 'connections', 'memory', 'knowledge'].includes(section), () => onSettings('general'), 'sidebar-link rail-settings')}
    <a className="rail-item sidebar-link" aria-label={t.help} title={t.help} href="https://github.com/ibrahimI-T/najd#readme" target="_blank" rel="noreferrer">
      <CircleHelp size={19} strokeWidth={1.7} /><span>{t.help}</span></a>
  </nav>
}
