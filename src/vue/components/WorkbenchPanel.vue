<script setup lang="ts">
// The right workbench (reference screenshots 4 and 8): tabs, Start here, Apps, the built-in browser, code and pages, session details and
// dashboards. Pages and generated code run in an opaque-origin sandbox with no network; browser tabs are main-process views placed here.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { AppWindow, ArrowLeft, ArrowRight, Globe, LayoutDashboard, Maximize2, Minimize2, Paperclip, Plus, RotateCw, X } from 'lucide-vue-next'
import SessionPanel from './SessionPanel.vue'
import DashboardView from './DashboardView.vue'
import { usePrefs } from '../composables/usePrefs'
import { APPS } from '../../workstation/apps'
import type { BrowserTab } from '../../workstation/types'
import type { WorkbenchState, WorkbenchTab } from '../../workstation/workbenchState'

const props = defineProps<{ state: WorkbenchState; tabs: BrowserTab[]; conversationId: string | null; activity?: NajdTaskActivity; projects: NajdProject[] }>()
const emit = defineEmits<{ select: [id: string]; close: [id: string]; full: []; open: [tab: WorkbenchTab]; browser: [url: string]; dashboard: []; prompt: [text: string]; files: []; memory: [] }>()
const { s, prefs } = usePrefs()
const ar = computed(() => prefs.language === 'ar')
const active = computed(() => props.state.tabs.find(tab => tab.id === props.state.active))
const menu = ref(false), address = ref(''), webTools = ref<{ name: string }[] | null>(null)
const view = ref<HTMLElement | null>(null)
const info = computed(() => active.value?.kind === 'browser' ? props.tabs.find(item => item.id === (active.value as Extract<WorkbenchTab, { kind: 'browser' }>).browserId) : undefined)
watch(info, value => { address.value = value?.url || ''; webTools.value = null }, { immediate: true })
// Fixed tabs are named in the language shown now, not the one that was on when they were opened (a tab opened in Arabic said "التطبيقات" after switching to English).
const titleOf = (tab: WorkbenchTab) => tab.kind === 'apps' ? s('التطبيقات', 'Apps') : tab.kind === 'details' ? s('تفاصيل الجلسة', 'Session details') : tab.title
const hostOf = (origin: string) => { try { return new URL(origin).host } catch { return origin } }
const openApp = (app: typeof APPS[number]) => { if (app.origin) emit('browser', app.origin); else if (app.html) emit('open', { id: 'app:' + app.id, kind: 'app', title: app.name, html: app.html }); else if (app.prompt) emit('prompt', app.prompt[ar.value ? 0 : 1]); else emit('dashboard') }
const frame = (source: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"><style>html,body{margin:0;padding:12px;font-family:system-ui,'Segoe UI',sans-serif;color:#eee;background:#181817}</style></head><body>${source}</body></html>`
const canvasHtml = computed(() => { const tab = active.value; if (tab?.kind !== 'canvas') return null; const lang = tab.item.language.toLowerCase(); return lang === 'html' || lang === 'artifact' || lang === 'svg' ? frame(tab.item.source) : null })

// The browser view is a native view the main process places over this element; it hides whenever this tab is not shown.
let observer: ResizeObserver | null = null
function place() {
  const tab = active.value, element = view.value
  if (tab?.kind !== 'browser' || !element) { void window.najdWorkstation?.tabShow(null, null); return }
  const box = element.getBoundingClientRect()
  void window.najdWorkstation?.tabShow(tab.browserId, { x: box.x, y: box.y, width: box.width, height: box.height })
}
watch(active, async () => { observer?.disconnect(); await nextTick(); if (view.value) { observer = new ResizeObserver(place); observer.observe(view.value) } place() }, { immediate: true })
onBeforeUnmount(() => { observer?.disconnect(); void window.najdWorkstation?.tabShow(null, null) })
const browserId = () => (active.value as Extract<WorkbenchTab, { kind: 'browser' }>).browserId
const api = () => window.najdWorkstation!
// Plain text, Markdown and tables (file previews, Office text) read in the UI font: code fonts break Arabic letter joining (live check 2026-11-10).
const PROSE = new Set(['text', 'markdown', 'csv'])
</script>

<template>
  <aside class="wb" :aria-label="s('مساحة العمل', 'Workbench')" data-workbench :dir="ar ? 'rtl' : 'ltr'">
    <div class="wb-tabs" role="tablist">
      <div v-for="tab in state.tabs" :key="tab.id" :class="['wb-tab', { on: tab.id === state.active }]"><button type="button" role="tab" :aria-selected="tab.id === state.active" dir="auto" @click="emit('select', tab.id)">{{ titleOf(tab) }}</button>
        <button type="button" class="w-icon" :aria-label="s('إغلاق ', 'Close ') + titleOf(tab)" @click="emit('close', tab.id)"><X :size="12" /></button></div>
      <div class="w-menu-box"><button type="button" class="w-icon" :aria-label="s('تبويب جديد', 'New tab')" :aria-expanded="menu" data-workbench-new @click="menu = !menu"><Plus :size="16" /></button>
        <div v-if="menu" class="w-menu end" role="menu">
          <button type="button" role="menuitem" class="w-menu-item" @click="menu = false; emit('open', { id: 'apps', kind: 'apps', title: s('التطبيقات', 'Apps') })"><AppWindow :size="15" /><span>{{ s('التطبيقات', 'Apps') }}</span></button>
          <button type="button" role="menuitem" class="w-menu-item" @click="menu = false; emit('browser', 'https://duckduckgo.com')"><Globe :size="15" /><span>{{ s('المتصفح', 'Browser') }}</span></button>
          <button type="button" role="menuitem" class="w-menu-item" @click="menu = false; emit('open', { id: 'details', kind: 'details', title: s('تفاصيل الجلسة', 'Session details') })"><span>{{ s('تفاصيل الجلسة', 'Session details') }}</span></button></div></div>
      <span class="w-grow" />
      <button type="button" class="w-icon" :aria-label="state.full ? s('عرض جانبي', 'Side view') : s('عرض كامل', 'Full width')" @click="emit('full')"><component :is="state.full ? Minimize2 : Maximize2" :size="16" /></button>
    </div>
    <div class="wb-body" role="tabpanel">
      <div v-if="!active" class="wb-start" data-start-here><small>{{ s('ابدأ من هنا', 'Start here') }}</small>
        <button type="button" @click="emit('browser', 'https://duckduckgo.com')"><Globe :size="16" />{{ s('المتصفح', 'Browser') }}</button>
        <button type="button" @click="emit('files')"><Paperclip :size="16" />{{ s('ملف', 'File') }}</button>
        <button type="button" @click="emit('dashboard')"><LayoutDashboard :size="16" />{{ s('لوحة التحكم', 'Dashboard') }}</button>
        <button type="button" @click="emit('open', { id: 'apps', kind: 'apps', title: s('التطبيقات', 'Apps') })"><AppWindow :size="16" />{{ s('التطبيقات', 'Apps') }} <em class="n-beta">{{ s('تجريبي', 'Beta') }}</em></button>
        <small>{{ s('تطبيقات مقترحة', 'Recommended apps') }}</small>
        <button v-for="app in APPS.slice(0, 8)" :key="app.id" type="button" class="wb-rec" @click="openApp(app)"><strong dir="ltr">{{ app.name }}</strong><span>{{ ar ? app.ar : app.en }}</span></button>
      </div>
      <div v-else-if="active.kind === 'apps'" class="wb-apps" data-apps><button v-for="app in APPS" :key="app.id" type="button" class="wb-app" :data-app="app.id" @click="openApp(app)"><strong dir="ltr">{{ app.name }}</strong><small>{{ ar ? app.ar : app.en }}</small><small class="wb-origin" dir="ltr">{{ app.origin ? hostOf(app.origin) : app.html ? s('معزول', 'Isolated') : app.prompt ? s('مهمة', 'Task') : s('محلي', 'Local') }}</small></button></div>
      <iframe v-else-if="active.kind === 'app'" class="artifact-bare" :title="active.title" sandbox="allow-scripts" referrerpolicy="no-referrer" :srcdoc="frame(active.html)" />
      <div v-else-if="active.kind === 'browser'" class="b-pane">
        <form class="b-bar" @submit.prevent="api().tabNavigate(browserId(), address)">
          <button type="button" class="w-icon" :aria-label="s('رجوع', 'Back')" :disabled="!info?.canGoBack" @click="api().tabBack(browserId())"><ArrowLeft :size="16" /></button>
          <button type="button" class="w-icon" :aria-label="s('تقدم', 'Forward')" :disabled="!info?.canGoForward" @click="api().tabForward(browserId())"><ArrowRight :size="16" /></button>
          <button type="button" class="w-icon" :aria-label="s('تحديث', 'Reload')" @click="api().tabReload(browserId())"><RotateCw :size="16" /></button>
          <input v-model="address" dir="ltr" :aria-label="s('العنوان', 'Address')" data-browser="address" />
          <button type="button" class="w-btn ghost" @click="api().tabWebMcp(browserId()).then(value => webTools = value).catch(() => webTools = [])">WebMCP</button>
        </form>
        <div v-if="info?.error" class="w-banner error">{{ info.error }}</div>
        <div v-if="webTools" class="w-banner"><span>{{ webTools.length ? webTools.map(tool => tool.name).join(', ') : s('هذه الصفحة لا تعلن أدوات.', 'This page declares no tools.') }}</span></div>
        <div ref="view" class="b-view" data-browser="view" />
      </div>
      <div v-else-if="active.kind === 'canvas'" class="canvas-panel"><header class="canvas-head"><div class="canvas-title"><strong dir="auto">{{ active.item.title }}</strong><span dir="ltr">{{ active.item.language }}</span></div></header>
        <iframe v-if="canvasHtml" :title="active.item.title" sandbox="allow-scripts" referrerpolicy="no-referrer" :srcdoc="canvasHtml" />
        <pre v-else :class="{ prose: PROSE.has(active.item.language.toLowerCase()) }" :dir="PROSE.has(active.item.language.toLowerCase()) ? 'auto' : 'ltr'"><code>{{ active.item.source }}</code></pre></div>
      <SessionPanel v-else-if="active.kind === 'details'" :conversation-id="conversationId" :activity="activity" :project="projects.find(item => !!conversationId && item.chats.includes(conversationId)) || null" @memory="emit('memory')" />
      <DashboardView v-else-if="active.kind === 'dashboard'" :document-id="active.documentId" :projects="projects" in-workbench />
    </div>
  </aside>
</template>
