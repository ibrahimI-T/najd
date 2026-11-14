<script setup lang="ts">
// The NAJD workstation shell in Vue (R-079): rail, routes, conversation and composer, notices and the right workbench.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Download, Gauge, Menu as MenuIcon, PanelRight } from 'lucide-vue-next'
import AppRail from './components/AppRail.vue'
import ComposerBox from './components/ComposerBox.vue'
import ThreadView from './components/ThreadView.vue'
import RouteView from './components/RouteView.vue'
import WorkbenchPanel from './components/WorkbenchPanel.vue'
import NoticesBar from './components/NoticesBar.vue'
import SplitHandle from './components/SplitHandle.vue'
import ToastStack from './components/ToastStack.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { RAIL, WORKBENCH } from '../workstation/prefs'
import { usePrefs } from './composables/usePrefs'
import { cleanError } from './composables/useLoad'
import { useProviders } from './composables/useProviders'
import { useConversation } from './composables/useConversation'
import { useMenuPlacement } from './composables/useMenuPlacement'
import { closeTab, emptyWorkbench, openTab, retitle, type WorkbenchTab } from '../workstation/workbenchState'
import type { BrowserTab, Route, SettingsRoute } from '../workstation/types'

const { prefs, s, change } = usePrefs()
useMenuPlacement()
const providers = useProviders()
const route = ref<Route>('home')
const chat = useConversation(providers, () => prefs.language, () => { route.value = 'home' })
const settingsRoute = ref<SettingsRoute>('appearance')
const shownProject = ref<string | null>(null)
const focus = ref(0), taskSeed = ref<string | null>(null)
const workbench = ref(emptyWorkbench)
const browserTabs = ref<BrowserTab[]>([])
// Below 760 px the rail becomes a drawer and the workbench covers the conversation, as in the reference app on a narrow window.
const narrowQuery = matchMedia('(max-width: 760px)'), narrow = ref(narrowQuery.matches), railOpen = ref(false)
const onNarrow = (event: MediaQueryListEvent) => { narrow.value = event.matches }
const collapsed = computed(() => narrow.value ? !railOpen.value : prefs.railCollapsed)
function toggleRail() { if (narrow.value) railOpen.value = !railOpen.value; else change({ railCollapsed: !prefs.railCollapsed }) }
const home = computed(() => route.value === 'home' && !chat.activeSessionId.value && chat.messages.value.length === 0)
const plan = computed(() => { const current = providers.current.value; return current ? (current.kind === 'local' ? 'Local' : current.kind === 'subscription' ? 'Plus' : 'API') : '' })
const noModel = computed(() => providers.catalog.value.length > 0 && !providers.catalog.value.some(item => item.configured && item.kind !== 'local') && !(providers.models[providers.provider.value]?.length))

function go(next: Route) { route.value = next; if (narrow.value) railOpen.value = false }
function startTask() { chat.newTask(); go('home'); focus.value++ }
function openChat(id: string) { if (!id) { go('task-center'); return } void chat.openSession(id).then(opened => { if (opened) go('home') }) }
function addTab(tab: WorkbenchTab) { workbench.value = openTab(workbench.value, tab) }
function openBrowser(url: string) { void window.najdWorkstation?.tabOpen(url).then(tab => addTab({ id: 'browser:' + tab.id, kind: 'browser', title: tab.title || url, browserId: tab.id })).catch(() => { chat.errorCode.value = 'ERROR' }) }
function closeWorkbenchTab(id: string) { if (id === 'details') usageClosed.value = true; const tab = workbench.value.tabs.find(item => item.id === id); if (tab?.kind === 'browser') void window.najdWorkstation?.tabClose(tab.browserId); workbench.value = closeTab(workbench.value, id) }
function openPage(section: string) {
  const map: Record<string, SettingsRoute> = { models: 'models', accounts: 'account-security', memory: 'conversation-memory', knowledge: 'knowledge', permissions: 'permissions-control', connections: 'mcp', browser: 'permissions-control', tools: 'diagnostics', general: 'general' }
  if (section === 'skills' || section === 'plugins') { go('skills-plugins'); return }
  settingsRoute.value = map[section] || 'general'; go('settings')
}
function importFiles() { void window.najdLibrary?.import().then(added => { chat.attachments.value = [...new Map([...chat.attachments.value, ...added].map(item => [item.id, item])).values()].slice(0, 20); go('home'); focus.value++ }).catch(() => { chat.errorCode.value = 'ATTACHMENT_READ_FAILED' }) }
// The main process writes the file only if it does not exist yet (EXPORT_EXISTS otherwise); the outcome is said in the conversation.
function exportChat() { const id = chat.activeSessionId.value; if (id) void window.najdSessions?.export(id).then(result => { if (result?.saved) chat.errorCode.value = result.format === 'pdf' ? 'EXPORTED_PDF' : result.format === 'markdown' ? 'EXPORTED_MD' : 'EXPORTED' }).catch(reason => { const code = cleanError(reason); chat.errorCode.value = code === 'EXPORT_EXISTS' ? code : 'EXPORT_FAILED' }) }
// Tokens of the open conversation in the header; the button opens what it used (tokens, skills, tools) on the right (owner request
// 2026-11-08). After a request finishes the panel opens by itself on a wide window, until the owner closes it once in this run.
const usageTotal = ref<number | null>(null), usageRuns = ref(0), usageClosed = ref(false)
const usageTab = () => ({ id: 'details', kind: 'details' as const, title: s('الاستهلاك والتفاصيل', 'Usage and details') })
const usageShown = computed(() => workbench.value.open && workbench.value.active === 'details')
function toggleUsage() { if (usageShown.value) { workbench.value = { ...workbench.value, open: false }; usageClosed.value = true } else addTab(usageTab()) }
async function refreshUsage(finished: boolean) {
  const id = chat.activeSessionId.value
  if (!id) { usageTotal.value = null; usageRuns.value = 0; return }
  // total stays null when the provider reported no counts: shown as "—", never as 0.
  try { const totals = (await window.najdAgent?.context(id))?.totals; usageRuns.value = totals?.runs || 0; usageTotal.value = totals?.total ?? null } catch { usageTotal.value = null; usageRuns.value = 0 }
  if (finished && usageRuns.value > 0 && !usageClosed.value && !narrow.value && window.innerWidth >= 1100 && !workbench.value.open) addTab(usageTab())
}
watch(() => chat.activeSessionId.value, () => void refreshUsage(false), { immediate: true })
watch(() => chat.currentActivity.value?.finishedAt, (value, before) => void refreshUsage(!!value && value !== before))
const tokens = (value: number) => value >= 1000 ? (value / 1000).toFixed(value >= 100000 ? 0 : 1) + 'k' : String(value)
// A request started from another page (Skills, Plugins, Apps) begins a new task instead of joining the open conversation (live test 2026-11-09).
function prompt(text: string) { if (route.value !== 'home') chat.newTask(); chat.draft.value = text; go('home'); focus.value++ }
function keys(event: KeyboardEvent) {
  if (!event.ctrlKey) return
  // The physical key (event.code), not the character: with the Arabic layout Ctrl+N gives "ى" and the shortcuts did nothing (live test 2026-11-09).
  if (event.code === 'KeyN' || event.code === 'KeyK') { event.preventDefault(); startTask() }
  if (event.code === 'KeyB') { event.preventDefault(); toggleRail() }
  if (event.code === 'Comma') { event.preventDefault(); go('settings') }
}
let offTabs: (() => void) | undefined
onMounted(() => {
  window.addEventListener('keydown', keys)
  narrowQuery.addEventListener('change', onNarrow)
  offTabs = window.najdWorkstation?.onTabs(list => {
    browserTabs.value = list
    workbench.value = list.reduce((next, tab) => next.tabs.some(item => item.id === 'browser:' + tab.id) ? retitle(next, 'browser:' + tab.id, tab.title || tab.url) : openTab(next, { id: 'browser:' + tab.id, kind: 'browser', title: tab.title || tab.url, browserId: tab.id }), workbench.value)
  })
})
onBeforeUnmount(() => { window.removeEventListener('keydown', keys); narrowQuery.removeEventListener('change', onNarrow); offTabs?.() })
</script>

<template>
  <div class="ws" data-shell="workstation" :data-mode="prefs.mode" data-renderer="vue">
    <button v-if="narrow && railOpen" type="button" class="ws-dim" :aria-label="s('إغلاق القائمة', 'Close the menu')" @click="railOpen = false" />
    <AppRail :route="route" :sessions="chat.sessions.value" :projects="chat.projects.value" :active-session-id="chat.activeSessionId.value" :locked="chat.locked.value || !chat.historyReady.value" :plan="plan" :collapsed="collapsed" @toggle="toggleRail" @renamed="chat.refreshSessions()"
      @go="go" @new-task="startTask" @open-chat="openChat" @delete-chat="id => chat.deleteSession(id)" @open-project="id => { shownProject = id; go('project') }" @new-project="go('project'); shownProject = null" @settings="value => { settingsRoute = value; go('settings') }" @apps="addTab({ id: 'apps', kind: 'apps', title: s('التطبيقات', 'Apps') })" />
    <SplitHandle v-if="!collapsed && !narrow" :label="s('عرض الشريط', 'Rail width')" :value="prefs.railWidth" :min="RAIL.min" :max="RAIL.max" side="left" @change="value => change({ railWidth: value })" />
    <main class="ws-main" :dir="prefs.language === 'ar' ? 'rtl' : 'ltr'" :data-route="route" :hidden="workbench.open && workbench.full">
      <header class="ws-bar"><button v-if="narrow" type="button" class="w-icon" :aria-label="s('القائمة', 'Menu')" @click="railOpen = true"><MenuIcon :size="16" /></button><span class="w-grow" />
        <button v-if="route === 'home' && chat.activeSessionId.value" type="button" class="w-icon" :aria-label="s('تصدير المحادثة', 'Export the conversation')" :disabled="chat.locked.value" @click="exportChat"><Download :size="16" /></button>
        <button v-if="route === 'home' && chat.activeSessionId.value" type="button" class="ws-usage" :aria-pressed="usageShown" data-usage-toggle :title="s('ما استخدمته المحادثة: التوكنات والمهارات والأدوات', 'What the conversation used: tokens, skills and tools')" @click="toggleUsage"><Gauge :size="14" /><span dir="ltr">{{ usageTotal === null ? '—' : tokens(usageTotal) }}</span><span>{{ s('توكن', 'tokens') }}</span></button>
        <button type="button" class="w-icon" :aria-label="s('مساحة العمل', 'Workbench')" :aria-pressed="workbench.open" data-workbench-toggle @click="workbench = { ...workbench, open: !workbench.open }"><PanelRight :size="16" /></button></header>
      <NoticesBar :no-model="noModel && !(route === 'settings' && settingsRoute === 'models')" @models="openPage('models')" @updates="openPage('general')" />
      <div v-if="route === 'home'" :class="['ws-chat', { home }]">
        <div v-if="home" class="ws-hero"><h1 class="ws-wordmark" dir="ltr">NAJD<sup v-if="prefs.mode === 'work'">WORK</sup></h1></div>
        <ThreadView v-else :chat="chat" :providers="providers" @open="item => addTab({ id: 'canvas:' + item.title, kind: 'canvas', title: item.title, item: { ...item, view: 'preview' } })" @edit="text => { chat.draft.value = text; focus++ }" />
        <ComposerBox :chat="chat" :providers="providers" :home="home" :focus-signal="focus" @settings="openPage" @hub="go('skills-plugins')" @schedule="text => { taskSeed = text; go('task-center') }" />
      </div>
      <RouteView v-else :route="route" :chat="chat" :providers="providers" :settings-route="settingsRoute" :project-id="shownProject" :task-seed="taskSeed"
        @settings-route="value => settingsRoute = value" @open-chat="openChat" @prompt="prompt" @go="go" @open-tab="addTab" @project="id => { shownProject = id }" />
    </main>
    <SplitHandle v-if="workbench.open && !workbench.full && !narrow" :label="s('عرض مساحة العمل', 'Workbench width')" :value="prefs.workbenchWidth" :min="WORKBENCH.min" :max="WORKBENCH.max" side="right" @change="value => change({ workbenchWidth: value })" />
    <div v-if="workbench.open" class="ws-side" :data-full="workbench.full || narrow" :style="workbench.full || narrow ? undefined : { width: prefs.workbenchWidth + 'px' }">
      <WorkbenchPanel :state="workbench" :tabs="browserTabs" :conversation-id="chat.activeSessionId.value" :activity="chat.currentActivity.value" :projects="chat.projects.value"
        @select="id => workbench = { ...workbench, active: id }" @close="closeWorkbenchTab" @full="workbench = { ...workbench, full: !workbench.full }" @open="addTab" @browser="openBrowser" @dashboard="go('dashboard')" @prompt="prompt"
        @files="importFiles" @memory="openPage('memory')" />
    </div>
    <ToastStack />
    <ConfirmDialog />
  </div>
</template>
