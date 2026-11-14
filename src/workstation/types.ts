// Typed domain contracts of the NAJD workstation (spec sections 3, 4.6, 7). Renderer mirror of electron/workstation: catalog visibility,
// installation and readiness are separate, and remote metadata describes a package but never grants a permission.

export type Lang = 'ar' | 'en'
export type ShellMode = 'work' | 'chat'
export type Route = 'profile' | 'home' | 'dashboard' | 'skills-plugins' | 'task-center' | 'remote-control' | 'project' | 'settings'
export const ROUTES: readonly Route[] = ['home', 'dashboard', 'skills-plugins', 'task-center', 'remote-control', 'project', 'settings']

export type SettingsRoute =
  | 'account-security' | 'notifications' | 'appearance' | 'shortcuts' | 'feature-management' | 'quick-summon'
  | 'startup-launch' | 'permissions-control' | 'archived-tasks' | 'desktop-pet' | 'general' | 'subscription'
  | 'conversation-memory' | 'chat-settings' | 'common-prompts' | 'models' | 'mcp' | 'channels' | 'knowledge' | 'library' | 'diagnostics'

export type CapabilityState = 'AVAILABLE' | 'NOT_INSTALLED' | 'INSTALLING' | 'NOT_READY' | 'DISABLED' | 'UPDATE_AVAILABLE' | 'QUARANTINED' | 'ERROR'
export type CatalogLayer = 'builtin' | 'managed' | 'gateway' | 'marketplace'
export type CapabilityKind = 'skill' | 'plugin'
export interface PermissionDeclaration { id: string; scope: string; reason: string }

export interface CatalogEntry {
  id: string; version: string; latestVersion: string | null; kind: CapabilityKind; layer: CatalogLayer
  displayName: string; description?: string; i18n?: { ar?: { displayName?: string; description?: string } }
  publisher: { name: string }; downloads?: number; categories: string[]; permissions: PermissionDeclaration[]
  state: CapabilityState; reason: string | null; installable: boolean; metadataOnly?: boolean; prominent?: boolean
  packageInstalled?: boolean; manageable?: boolean; canRollback?: boolean; localImportable?: boolean; mcpServers?: { name: string; url?: string; kind?: 'stdio'; command?: string; args?: string[]; envNames?: string[] }[]
  packageUrl?: string; sha256?: string; packageFormat?: 'najd-package' | 'compatible-plugin'; source?: string; needs?: string[]
}
export interface CatalogView { state: 'online' | 'offline' | 'no-source'; syncedAt: string | null; pagesRead: number; failed: string[]; sources: string[]; removableSources?: string[]; entries: CatalogEntry[] }

export interface PackagePlan {
  planId: string; id: string; version: string; currentVersion: string | null; displayName: string; description: string; publisher: { name: string; url?: string }
  permissions: PermissionDeclaration[]; dependencies: { id: string; kind: string; version?: string; satisfied: boolean | null }[]; executables: string[]
  license: { spdx?: string; noticePath?: string }; archiveSha256: string; source: string
}
export interface InstalledPackage { id: string; version: string; previousVersion: string | null; enabled: boolean; kind: CapabilityKind; displayName: string }
export interface LocalPackageCandidate { id: string; version: string; displayName: string; description: string; publisher: { name: string }; license: { spdx: string }; categories: string[]; skills: string[] }
export interface LocalImportPlan { planId: string; count: number; packages: PackagePlan[] }
export interface LocalImportResult { installed: InstalledPackage[]; failed: { id: string; code: string }[] }

export type Schedule = { kind: 'once'; at: string } | { kind: 'interval'; minutes: number } | { kind: 'cron'; cron: string; timezone: string }
export interface AutomationRun { id: string; state: string; trigger: 'schedule' | 'manual'; late: boolean; startedAt: string; finishedAt?: string; output?: string; code?: string; conversationId?: string }
export interface Automation { id: string; title: string; prompt: string; schedule: Schedule; status: 'active' | 'paused' | 'archived' | 'completed'; nextRunAt: string | null; lastRunAt: string | null; delivery: 'conversation' | 'notification'; provider: string | null; model: string | null; runs: AutomationRun[] }

export interface RemoteDevice { id: string; name: string; scopes: string[]; pairedAt: string; lastSeenAt: string }
export interface RemoteStatus { enabled: boolean; lan: boolean; keepAwake: boolean; port: number | null; address: string | null; devices: RemoteDevice[]; audit: { at: string; action: string; device: string | null }[]; pairing: { code: string; expiresAt: string } | null }

export interface BrowserTab { id: string; url: string; title: string; favicon: string | null; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }

export interface WorkstationDocument { id: string; kind: 'dashboard' | 'canvas'; title: string; template?: string; projectId?: string | null; widgets: Widget[]; updatedAt: string }
export type Widget = { id: string; type: 'metric' | 'note' | 'list' | 'chart'; title: string; value: string; column: 1 | 2 | 3 }

export const PLUGIN_CATEGORIES = ['installed', 'featured', 'finance', 'productivity', 'creativity-design', '3d', 'developer-tools', 'research', 'legal', 'personal'] as const
export const SKILL_CATEGORIES = ['installed', 'featured', 'productivity', 'finance', 'academic', 'marketing', 'engineering', 'creative'] as const

export interface SystemStatus { quickSummon: boolean; accelerator: string; notifyFinished: boolean; pet: boolean; launchAtLogin: boolean; packaged: boolean; shortcutActive: boolean; pointerMode?: 'follow' | 'fast' | 'off'; stopShortcut?: string | null }

export interface WorkstationApi {
  catalog(): Promise<CatalogView>; sync(): Promise<CatalogView>
  addSource(url: string): Promise<string[]>; removeSource(url: string): Promise<string[]>
  setBuiltinEnabled(id: string, enabled: boolean): Promise<CatalogView>
  planFile(): Promise<PackagePlan | null>; planUrl(url: string, digest: string, format?: CatalogEntry['packageFormat']): Promise<PackagePlan>; install(planId: string): Promise<InstalledPackage>
  localPackages(): Promise<LocalPackageCandidate[]>; planLocal(ids?: string[]): Promise<LocalImportPlan>; installLocal(planId: string): Promise<LocalImportResult>
  setPackageEnabled(id: string, enabled: boolean): Promise<InstalledPackage>; rollback(id: string): Promise<InstalledPackage>; removePackage(id: string): Promise<boolean>; openSkillsFolder(): Promise<string>; skillGuide(id: string): Promise<{ id: string; text: string; source: 'builtin' | 'package' }>; skillEditable(id: string): Promise<{ id: string; name: string; version: string; description: string; steps: string }>; skillEdit(id: string, description: string, steps: string): Promise<{ id: string; version: string }>
  connectPackageMcp(id: string, name: string, token?: string): Promise<{ state?: string; error?: string | null; status?: string }>
  tasks(): Promise<Automation[]>; taskCreate(input: { title: string; prompt: string; schedule: Schedule; delivery?: string; provider?: string | null; model?: string | null }): Promise<Automation>
  taskUpdate(id: string, patch: Partial<Pick<Automation, 'title' | 'prompt' | 'schedule'>>): Promise<Automation>; taskStatus(id: string, status: 'active' | 'paused' | 'archived'): Promise<Automation>; taskRemove(id: string): Promise<boolean>; taskRun(id: string): Promise<AutomationRun>
  remote(): Promise<RemoteStatus>; remoteConfigure(patch: Partial<Pick<RemoteStatus, 'enabled' | 'lan' | 'keepAwake'>>): Promise<RemoteStatus>; remotePair(scopes: string[]): Promise<RemoteStatus>; remoteRevoke(id: string): Promise<RemoteStatus>
  tabs(): Promise<BrowserTab[]>; tabOpen(url: string): Promise<BrowserTab>; tabClose(id: string): Promise<BrowserTab[]>; tabNavigate(id: string, url: string): Promise<BrowserTab>; tabBack(id: string): Promise<BrowserTab>; tabForward(id: string): Promise<BrowserTab>; tabReload(id: string): Promise<BrowserTab>
  tabShow(id: string | null, area: { x: number; y: number; width: number; height: number } | null): Promise<void>; tabRead(id: string): Promise<BrowserTab & { text: string }>; tabWebMcp(id: string): Promise<{ name: string; description: string }[]>
  system(): Promise<SystemStatus>; systemSet(patch: Partial<SystemStatus>): Promise<SystemStatus>
  documents(kind: 'dashboard' | 'canvas'): Promise<WorkstationDocument[]>; documentSave(document: Omit<WorkstationDocument, 'updatedAt'>): Promise<WorkstationDocument>; documentRemove(id: string): Promise<boolean>
  onChanged(listener: (kind: string) => void): () => void; onTabs(listener: (tabs: BrowserTab[]) => void): () => void
  onRemote(listener: (event: { kind: 'instruct' | 'resume'; text?: string; device: string }) => void): () => void
}
declare global { interface Window { najdWorkstation?: WorkstationApi } }
