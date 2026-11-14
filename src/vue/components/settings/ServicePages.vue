<script setup lang="ts">
// Settings pages backed by one main-process service each: memory notes, personality, MCP servers, Telegram, knowledge bases, updates,
// diagnostics and the system switches. One file keeps the small pages together; `page` picks which one shows.
import { computed, onMounted, reactive, ref } from 'vue'
import { Pencil, Trash2 } from 'lucide-vue-next'
import { usePrefs } from '../../composables/usePrefs'
import { useLoad } from '../../composables/useLoad'
import LearnedMemory from './LearnedMemory.vue'
import RecallControl from './RecallControl.vue'
import { TOOL_DESCRIPTIONS_AR } from '../../../workstation/toolDescriptionsAr'
import { plain } from '../../lib/plain'
import { MCP_PRESETS, presetForm, type McpPreset } from '../../../workstation/mcpPresets'
import type { SystemStatus } from '../../../workstation/types'

const props = defineProps<{ page: 'memory' | 'chat' | 'mcp' | 'channels' | 'knowledge' | 'general' | 'diagnostics' | 'notifications' | 'quick-summon' | 'startup-launch' | 'desktop-pet' }>()
const { s, prefs, change } = usePrefs()
const host = window
const empty = () => Promise.resolve(null)
const memory = useLoad(props.page === 'memory' ? window.najdMemory?.list : empty), note = reactive({ id: '', title: '', text: '' })
const personality = useLoad(props.page === 'chat' ? window.najdPersonality?.get : empty), draft = ref<NajdPersonality | null>(null)
const mcp = useLoad(props.page === 'mcp' ? window.najdMcpServers?.list : empty), server = reactive({ name: '', command: '', args: '' }), token = ref('')
const channels = useLoad(props.page === 'channels' ? window.najdChannels?.status : empty), botToken = ref(''), pair = ref<string | null>(null)
const knowledge = useLoad(props.page === 'knowledge' ? window.najdKnowledge?.list : empty), baseName = ref('')
const updates = useLoad(props.page === 'general' ? window.najdUpdates?.status : empty)
const gateway = useLoad(props.page === 'diagnostics' ? window.najdGateway?.status : empty), notices = useLoad(props.page === 'diagnostics' ? window.najdAbout?.notices : empty), licenses = ref(false), tools = ref<NajdAgentTool[]>([])
const system = useLoad(['notifications', 'quick-summon', 'startup-launch', 'desktop-pet'].includes(props.page) ? window.najdWorkstation?.system : empty)
onMounted(() => { if (props.page === 'mcp') void checkPrograms(); if (props.page === 'diagnostics') void window.najdAgent?.tools?.().then(list => { tools.value = list }).catch(() => {}) })
const ar = () => prefs.language === 'ar'
// A note is corrected in the same form it was added with: Edit loads it, Save writes it back under its id (the service already updates by id).
function editNote(item: NajdMemoryNote) { Object.assign(note, { id: item.id, title: item.title, text: item.text }) }
function cancelNote() { Object.assign(note, { id: '', title: '', text: '' }) }
function saveNote() {
  const editing = !!note.id, input = { ...(note.id ? { id: note.id } : {}), title: note.title, text: note.text }
  cancelNote()
  void memory.run(() => host.najdMemory!.save(input), editing ? s('حُدّثت الملاحظة.', 'Note updated.') : s('حُفظت الملاحظة.', 'Note saved.'))
}
function savePersonality(current: NajdPersonality) { void personality.run(() => host.najdPersonality!.save(plain(current)), s('حُفظت إعدادات المحادثة.', 'Chat settings saved.')).then(() => { draft.value = null }) }
function addServer() {
  const input = { ...server }, secret = token.value
  void mcp.run(async () => {
    const args: string[] = input.args.trim().startsWith('[') ? JSON.parse(input.args) : input.args.split(/\s+/).filter(Boolean)
    token.value = ''
    const result = await host.najdMcpServers!.add({ name: input.name, command: input.command, ...(input.command.startsWith('https://') ? { url: input.command } : {}), args, cwd: '', env: secret ? { MCP_TOKEN: secret } : {} })
    if (result.status === 'added') { Object.assign(server, { name: '', command: '', args: '' }); if (result.server) await host.najdMcpServers!.connect(result.server.id) }
  })
}
// Popular servers (src/workstation/mcpPresets.ts): one click adds through the same path as the form, with NAJD's native confirmation.
// Prerequisites (original NAJD improvement, 2026-11-10): a local server needs Node.js (npx) or uv (uvx). NAJD checks which are on this
// computer and, when one is missing, the card offers its official install page instead of an Add that would fail with COMMAND_NOT_FOUND.
const programs = ref<{ npx: boolean; uvx: boolean } | null>(null)
const SETUP: Record<'npx' | 'uvx', { name: string; url: string }> = { npx: { name: 'Node.js', url: 'https://nodejs.org/en/download' }, uvx: { name: 'uv', url: 'https://docs.astral.sh/uv/getting-started/installation/' } }
const missing = (preset: McpPreset) => preset.needs !== 'https' && programs.value !== null && !programs.value[preset.needs] ? SETUP[preset.needs] : null
async function checkPrograms() { try { programs.value = await window.najdMcpServers?.programs?.() || null } catch { programs.value = null } }
function openSetup(url: string) { window.open(url, '_blank', 'noopener') }
const presetQuery = ref('')
const presets = computed(() => { const text = presetQuery.value.trim().toLowerCase(); return text ? MCP_PRESETS.filter(preset => [preset.name, preset.about[0], preset.about[1], preset.id, ...preset.args].some(value => value.toLowerCase().includes(text))) : MCP_PRESETS })
const knownPreset = (preset: McpPreset) => ((mcp.value.value as NajdMcpServer[] | null) || []).some(item => item.name === preset.name)
function usePreset(preset: McpPreset) {
  Object.assign(server, presetForm(preset))
  if (preset.token) { document.querySelector<HTMLInputElement>('[data-mcp-token]')?.focus(); return }
  addServer()
}
function saveBot() { const value = botToken.value; botToken.value = ''; void channels.run(() => host.najdChannels!.saveToken(value), s('حُفظ رمز البوت.', 'Bot token saved.')) }
// The result of adding files names what failed and why, instead of staying silent.
function addToBase(id: string) {
  void knowledge.run(() => host.najdKnowledge!.addFiles(id), (result: { added: number; failed: { name: string; error: string }[] } | null) => {
    if (!result) return null
    const failed = result.failed.map(item => `${item.name} (${item.error})`).join('، ')
    return result.added && !result.failed.length ? s(`أُضيف ${result.added} ملف.`, `Added ${result.added} file(s).`)
      : s(`أُضيف ${result.added} ملف. تعذر: ${failed}`, `Added ${result.added} file(s). Failed: ${failed}`)
  })
}
function createBase() { const value = baseName.value; baseName.value = ''; void knowledge.run(() => host.najdKnowledge!.create(value, ''), s('أُنشئت قاعدة المعرفة.', 'Knowledge base created.')) }
// What a finished update check found, in words (the button said nothing before; UI crawl 2026-11-09).
// The update state in words, progress while downloading, a way to stop it, the release notes, and the last start's recovery note (the service has
// always reported all of this; the page showed the raw state name and only Check, Download and Install). The recovery banner shows only after an
// unclean start: the service's recoveryNote also carries "no previous version" reasons on a healthy install.
const STATE: Record<NajdUpdateStatus['state'], [string, string]> = { disabled: ['معطّل', 'Disabled'], idle: ['جاهز', 'Idle'], checking: ['جارٍ الفحص', 'Checking'], current: ['محدّث', 'Up to date'], available: ['تحديث متاح', 'Update available'],
  manual: ['تحديث يدوي', 'Manual update'], downloading: ['جارٍ التنزيل', 'Downloading'], ready: ['جاهز للتثبيت', 'Ready to install'], installing: ['جارٍ التثبيت', 'Installing'], error: ['خطأ', 'Error'], cancelled: ['أُلغي', 'Cancelled'] }
const stability = ref<{ unstable: boolean; attempts: number; previousVersion: string | null; recoveryNote: string | null } | null>(null)
onMounted(() => { if (props.page === 'general') void window.najdUpdates?.stability().then(value => { stability.value = value }).catch(() => {}) })
const updateText = (result: NajdUpdateStatus | null) => !result ? null : result.state === 'current' ? s('لديك أحدث إصدار.', 'You have the latest version.') : result.state === 'available' || result.state === 'manual' ? s(`يتوفر إصدار ${result.version || 'جديد'}.`, `Version ${result.version || 'new'} is available.`) :
  result.state === 'disabled' ? s('التحديث التلقائي غير مفعل في هذا الإصدار.', 'Automatic updates are off in this build.') : result.state === 'error' ? s('تعذر فحص التحديثات: ', 'Could not check for updates: ') + (result.errorCode || '') : s('الحالة: ', 'State: ') + result.state
const setSystem = (patch: Partial<SystemStatus>) => { void system.run(() => host.najdWorkstation!.systemSet(patch), s('حُفظ.', 'Saved.')) }
</script>

<template>
  <template v-if="page === 'memory'"><section class="w-section"><header><div><h3>{{ s('الملاحظات', 'Notes') }}</h3></div><div class="w-row-end"><button type="button" class="w-btn" @click="memory.run(() => host.najdMemory!.import(), result => result?.imported ? s(`استُورد ${result.count} عنصر`, `Imported ${result.count} items`) : s('لم يُختر ملف.', 'No file was chosen.'))">{{ s('استيراد', 'Import') }}</button><button type="button" class="w-btn" @click="memory.run(() => host.najdMemory!.export(), result => result?.saved ? s('صُدّرت الذاكرة.', 'Memory exported.') : s('أُلغي التصدير.', 'Export cancelled.'))">{{ s('تصدير', 'Export') }}</button></div></header>
    <div v-if="memory.failure.value" class="w-banner error">{{ memory.failure.value }}</div>
    <div v-for="item in (memory.value.value as NajdMemoryNote[] | null) || []" :key="item.id" class="w-row"><div><strong>{{ item.title }}</strong><small>{{ item.text.slice(0, 160) }}</small></div><div class="w-row-end"><button type="button" class="w-icon" data-note-edit :aria-label="s('تعديل', 'Edit')" @click="editNote(item)"><Pencil :size="16" /></button><button type="button" class="w-icon" :aria-label="s('حذف', 'Delete')" @click="memory.run(() => host.najdMemory!.remove(item.id), s('حُذفت الملاحظة.', 'Note deleted.'))"><Trash2 :size="16" /></button></div></div>
    <div class="s-form"><label class="w-field"><span>{{ s('العنوان', 'Title') }}</span><input v-model="note.title" dir="auto" /></label><label class="w-field"><span>{{ s('النص', 'Text') }}</span><textarea v-model="note.text" rows="3" dir="auto" /></label>
      <div class="w-row-end"><button type="button" class="w-btn primary" :disabled="!note.title.trim() || !note.text.trim()" @click="saveNote">{{ s('حفظ', 'Save') }}</button><button v-if="note.id" type="button" class="w-btn" data-note-cancel @click="cancelNote">{{ s('إلغاء التعديل', 'Cancel editing') }}</button></div></div></section>
    <LearnedMemory /><RecallControl /></template>

  <template v-else-if="page === 'chat'">
    <div v-if="!(draft || personality.value.value)" class="w-skeleton"><i /><i /></div>
    <section v-else class="w-section"><header><div><h3>{{ s('الشخصية', 'Personality') }}</h3></div></header>
      <div v-if="personality.failure.value" class="w-banner error">{{ personality.failure.value }}</div>
      <template v-for="current in [(draft || personality.value.value) as NajdPersonality]" :key="'p'">
        <div class="w-row"><div><strong>{{ s('مفعلة', 'Enabled') }}</strong></div><button type="button" role="switch" :aria-label="s('مفعلة', 'Enabled')" :aria-checked="current.enabled" :class="['w-toggle', { on: current.enabled }]" @click="draft = { ...current, enabled: !current.enabled }"><i /></button></div>
        <label class="w-field"><span>{{ s('الاسم', 'Name') }}</span><input :value="current.name" dir="auto" @input="draft = { ...current, name: ($event.target as HTMLInputElement).value }" /></label>
        <label class="w-field"><span>{{ s('التعليمات', 'Instructions') }}</span><textarea :value="current.instructions" rows="6" dir="auto" @input="draft = { ...current, instructions: ($event.target as HTMLTextAreaElement).value }" /></label>
        <div class="s-inline"><button type="button" class="w-btn primary" @click="savePersonality(current)">{{ s('حفظ', 'Save') }}</button><button type="button" class="w-btn" @click="personality.run(() => host.najdPersonality!.reset(), s('استُعيدت الإعدادات الافتراضية.', 'Defaults restored.')).then(() => { draft = null })">{{ s('استعادة', 'Reset') }}</button></div>
      </template></section>
  </template>

  <section v-else-if="page === 'mcp'" class="w-section"><header><div><h3>{{ s('الخوادم', 'Servers') }}</h3></div></header>
    <div v-if="mcp.failure.value" class="w-banner error">{{ mcp.failure.value }}</div>
    <div v-for="item in (mcp.value.value as NajdMcpServer[] | null) || []" :key="item.id" class="w-row"><div><strong>{{ item.name }}</strong><small>{{ item.error || item.commandLine }}</small></div><div class="w-row-end">
      <span :class="['w-badge', item.state === 'connected' ? 'green' : item.state === 'failed' ? 'red' : '']">{{ item.state }}</span>
      <button v-if="item.remote && item.error === 'AUTH_REQUIRED'" type="button" class="w-btn primary" data-mcp-signin @click="mcp.run(() => host.najdMcpServers!.signIn(item.id), result => result?.state === 'connected' ? s('تم تسجيل الدخول والاتصال.', 'Signed in and connected.') : null)">{{ s('تسجيل الدخول', 'Sign in') }}</button>
      <button type="button" class="w-btn" @click="mcp.run(() => item.state === 'connected' ? host.najdMcpServers!.disconnect(item.id) : host.najdMcpServers!.connect(item.id))">{{ item.state === 'connected' ? s('فصل', 'Disconnect') : s('اتصال', 'Connect') }}</button>
      <button type="button" class="w-icon" :aria-label="s('إزالة', 'Remove')" @click="mcp.run(() => host.najdMcpServers!.remove(item.id))"><Trash2 :size="16" /></button></div></div>
    <div class="s-sub-row"><h4 class="s-sub">{{ s('خوادم مشهورة', 'Popular servers') }} <small>{{ MCP_PRESETS.length }}</small></h4><input v-model="presetQuery" type="search" class="s-preset-search" :placeholder="s('ابحث: تصميم، توثيق، مهام…', 'Search: design, docs, tasks…')" :aria-label="s('بحث في الخوادم المشهورة', 'Search popular servers')" /></div>
    <div class="s-presets" data-mcp-presets><article v-for="preset in presets" :key="preset.id" class="s-preset"><div><strong>{{ preset.name }}</strong><small>{{ ar() ? preset.about[0] : preset.about[1] }}</small>
      <em dir="ltr">{{ preset.needs === 'https' ? s('عن بُعد', 'Remote') : missing(preset) ? s('ينقصه ' + missing(preset)!.name + ' على جهازك', missing(preset)!.name + ' is missing on this computer') : programs ? s('على الجهاز · جاهز', 'Local · ready') : preset.needs === 'npx' ? s('على الجهاز · يحتاج Node.js', 'Local · needs Node.js') : s('على الجهاز · يحتاج Python uv', 'Local · needs Python uv') }}</em></div>
      <span v-if="missing(preset)" class="s-preset-setup" data-preset-missing><button type="button" class="w-btn primary" @click="openSetup(missing(preset)!.url)">{{ s('ثبّت ', 'Install ') + missing(preset)!.name }}</button><button type="button" class="w-btn ghost" :title="s('أعد الفحص بعد التثبيت', 'Check again after installing')" @click="checkPrograms">{{ s('أعد الفحص', 'Recheck') }}</button></span>
      <button v-else type="button" class="w-btn" :disabled="knownPreset(preset)" @click="usePreset(preset)">{{ knownPreset(preset) ? s('مضاف', 'Added') : preset.token ? s('تعبئة', 'Fill in') : s('إضافة', 'Add') }}</button></article></div>
    <div class="s-form"><label class="w-field"><span>{{ s('الاسم', 'Name') }}</span><input v-model="server.name" /></label><label class="w-field"><span>{{ s('الأمر', 'Command') }}</span><input v-model="server.command" dir="ltr" /></label><label class="w-field"><span>{{ s('المعاملات', 'Arguments') }}</span><input v-model="server.args" dir="ltr" /></label>
      <label class="w-field"><span>{{ s('رمز الوصول للخادم الخارجي (اختياري)', 'Remote server access token (optional)') }}</span><input v-model="token" type="password" autocomplete="off" data-mcp-token /></label>
      <p>{{ s('أدخل أمر خادم محلي أو عنوان HTTPS لخادم MCP. المعاملات المحلية بصيغة مصفوفة JSON عند احتوائها على مسافات.', 'Enter a local command or HTTPS MCP endpoint. Use a JSON array for local arguments containing spaces.') }}</p>
      <button type="button" class="w-btn primary" :disabled="!server.name || !server.command" @click="addServer">{{ s('إضافة واتصال', 'Add and connect') }}</button></div></section>

  <section v-else-if="page === 'channels'" class="w-section"><header><div><h3>Telegram</h3></div></header>
    <div v-if="channels.failure.value" class="w-banner error">{{ channels.failure.value }}</div>
    <template v-for="value in channels.value.value ? [channels.value.value as NajdChannelStatus] : []" :key="'c'">
      <div class="w-row"><div><strong>{{ s('الحالة', 'State') }}</strong><small>{{ value.botName || value.errorCode || '' }}</small></div><div class="w-row-end"><span :class="['w-badge', value.state === 'running' ? 'green' : value.state === 'error' ? 'red' : '']">{{ value.state }}</span>
        <button type="button" role="switch" :aria-checked="value.enabled" :aria-label="s('مفعلة', 'Enabled')" :disabled="!value.tokenSaved" :class="['w-toggle', { on: value.enabled }]" @click="channels.run(() => host.najdChannels!.configure({ enabled: !value.enabled }))"><i /></button></div></div>
      <div class="s-inline"><input v-model="botToken" type="password" autocomplete="off" :aria-label="s('رمز البوت', 'Bot token')" dir="ltr" /><button type="button" class="w-btn" :disabled="!botToken.trim()" @click="saveBot">{{ s('حفظ', 'Save') }}</button>
        <button v-if="value.tokenSaved" type="button" class="w-btn danger" @click="channels.run(() => host.najdChannels!.clearToken())">{{ s('مسح', 'Clear') }}</button></div>
      <div v-if="value.tokenSaved" class="w-row"><div><strong>{{ s('ربط محادثة', 'Pair a chat') }}</strong></div><div class="w-row-end"><code v-if="pair" dir="ltr">{{ pair }}</code><button type="button" class="w-btn" @click="host.najdChannels!.pair().then(item => { pair = item.code })">{{ s('إنشاء رمز', 'Create a code') }}</button></div></div>
      <div v-for="item in value.allowed" :key="item.chatId" class="w-row"><div><strong>{{ item.name }}</strong></div><button type="button" class="w-btn danger" @click="channels.run(() => host.najdChannels!.unpair(item.chatId))">{{ s('فك الربط', 'Unpair') }}</button></div>
    </template></section>

  <section v-else-if="page === 'knowledge'" class="w-section"><header><div><h3>{{ s('القواعد', 'Bases') }}</h3></div></header>
    <div v-if="knowledge.failure.value" class="w-banner error">{{ knowledge.failure.value }}</div>
    <template v-for="base in (knowledge.value.value as NajdKnowledgeBase[] | null) || []" :key="base.id">
      <div class="w-row" data-base><div><strong>{{ base.name }}</strong><small>{{ s(`${base.items.length} ملف`, `${base.items.length} files`) }}</small></div><div class="w-row-end">
        <button type="button" class="w-btn" data-base-add @click="addToBase(base.id)">{{ s('إضافة ملفات', 'Add files') }}</button><button type="button" class="w-icon" data-base-delete :aria-label="s('حذف القاعدة', 'Delete base')" @click="knowledge.run(() => host.najdKnowledge!.remove(base.id))"><Trash2 :size="16" /></button></div></div>
      <div v-for="item in base.items" :key="item.id" class="w-row s-base-file" data-base-file><div><span dir="auto">{{ item.name }}</span><small>{{ item.kind }} · {{ s(`${item.characters} حرف`, `${item.characters} characters`) }}</small></div>
        <button type="button" class="w-icon" data-base-file-remove :aria-label="s('إزالة الملف من القاعدة', 'Remove file from the base')" @click="knowledge.run(() => host.najdKnowledge!.removeItem(base.id, item.id), s('أُزيل الملف من القاعدة.', 'File removed from the base.'))"><Trash2 :size="14" /></button></div>
    </template>
    <div class="s-inline"><input v-model="baseName" :aria-label="s('الاسم', 'Name')" dir="auto" /><button type="button" class="w-btn primary" :disabled="!baseName.trim()" @click="createBase">{{ s('إنشاء', 'Create') }}</button></div></section>

  <template v-else-if="page === 'general'">
    <div v-if="updates.failure.value" class="w-banner error">{{ updates.failure.value }}</div>
    <section class="w-section"><header><div><h3>{{ s('اللغة', 'Language') }}</h3></div></header><div class="w-seg" role="radiogroup"><button v-for="option in [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] as const" :key="option.value" type="button" role="radio" :aria-checked="prefs.language === option.value" :class="{ on: prefs.language === option.value }" @click="change({ language: option.value })">{{ option.label }}</button></div></section>
    <section class="w-section"><header><div><h3>{{ s('التحديثات', 'Updates') }}</h3></div></header>
      <template v-for="value in [updates.value.value as NajdUpdateStatus | null]" :key="'u'">
        <div class="w-row"><div><strong>{{ s('الإصدار', 'Version') }}</strong><small v-if="value?.version">{{ s('متاح: ', 'Available: ') + value.version }}</small></div><div class="w-row-end"><code dir="ltr">{{ value?.currentVersion }}</code><span class="w-badge" data-update-state :data-state="value?.state">{{ value ? s(STATE[value.state][0], STATE[value.state][1]) : '' }}{{ value?.state === 'downloading' ? ' ' + value.percent + '%' : '' }}</span>
          <button v-if="value?.state === 'available'" type="button" class="w-btn" @click="updates.run(() => host.najdUpdates!.download(), s('بدأ التنزيل.', 'Download started.'))">{{ s('تنزيل', 'Download') }}</button>
          <button v-else-if="value?.state === 'downloading'" type="button" class="w-btn" data-update-cancel @click="updates.run(() => host.najdUpdates!.cancel(), s('أُلغي التنزيل.', 'Download cancelled.'))">{{ s('إلغاء', 'Cancel') }}</button>
          <button v-else-if="value?.state === 'manual'" type="button" class="w-btn primary" data-update-releases @click="host.najdUpdates!.openReleases()">{{ s('فتح صفحة الإصدارات', 'Open the releases page') }}</button>
          <button v-else-if="value?.state === 'ready'" type="button" class="w-btn primary" @click="updates.run(() => host.najdUpdates!.install())">{{ s('تثبيت', 'Install') }}</button>
          <button v-else type="button" class="w-btn" @click="updates.run(() => host.najdUpdates!.check(), updateText)">{{ s('فحص', 'Check') }}</button></div></div>
        <div v-if="value?.notes && ['available', 'manual', 'downloading', 'ready'].includes(value.state)" class="w-row" data-update-notes><div><strong>{{ s('ما الجديد', 'What is new') }}</strong><small dir="auto" style="white-space: pre-wrap">{{ value.notes.slice(0, 1200) }}</small></div></div>
        <div v-if="stability?.unstable" class="w-banner warn" data-update-recovery>{{ s(`آخر تشغيل لم يكتمل بسلام (${stability.attempts} محاولات).`, `The last start did not finish cleanly (${stability.attempts} attempts).`) }}<span v-if="stability?.previousVersion"> {{ s('الإصدار السابق المتاح للاستعادة: ', 'Previous version available for recovery: ') + stability.previousVersion }}</span></div>
      </template></section>
  </template>

  <template v-else-if="page === 'diagnostics'">
    <section class="w-section"><header><div><h3>{{ s('البوابة', 'Gateway') }}</h3></div></header>
      <template v-for="value in [gateway.value.value as NajdGatewayStatus | null]" :key="'g'">
        <div class="w-row"><div><strong>{{ value?.engine || 'openclaw' }}</strong><small>{{ value?.errorCode || '' }}</small></div><div class="w-row-end"><span :class="['w-badge', value?.state === 'healthy' ? 'green' : '']">{{ value?.state }}</span>
          <button type="button" class="w-btn" :disabled="gateway.busy.value" @click="gateway.run(() => value?.state === 'healthy' ? host.najdGateway!.stop() : host.najdGateway!.start(), value?.state === 'healthy' ? s('أُوقف المحرك.', 'Engine stopped.') : s('بدأ تشغيل المحرك.', 'Engine starting.'))">{{ value?.state === 'healthy' ? s('إيقاف', 'Stop') : s('تشغيل', 'Start') }}</button>
          <button v-if="value?.state === 'failed' || value?.state === 'degraded'" type="button" class="w-btn primary" data-gateway-repair :disabled="gateway.busy.value" @click="gateway.run(() => host.najdGateway!.repair(), s('أُصلح المحرك وبدأ تشغيله.', 'The engine was repaired and is starting.'))">{{ s('إصلاح', 'Repair') }}</button></div></div>
        <small v-if="value?.state === 'failed'" data-gateway-repair-hint>{{ s('تُعاد إلى المحرك ملفاته الأصلية من نسخة التثبيت (نحو دقيقة ونصف)، ثم يُشغَّل من جديد.', 'The engine gets its original files back from the installed copy (about a minute and a half), then starts again.') }}</small>
      </template></section>
    <section class="w-section"><header><div><h3>{{ s('التشخيص', 'Diagnostics') }}</h3></div></header><div class="w-row"><div><strong>{{ s('تصدير حزمة تشخيص', 'Export a diagnostics bundle') }}</strong></div><button type="button" class="w-btn" @click="gateway.run(() => host.najdDiagnostics!.export(), result => result?.saved === false ? s('أُلغي التصدير.', 'Export cancelled.') : s('صُدّرت حزمة التشخيص.', 'Diagnostics bundle exported.'))">{{ s('تصدير', 'Export') }}</button></div></section>
    <section class="w-section"><header><div><h3>{{ s('الأدوات', 'Tools') }}</h3><p>{{ s(`${tools.filter(tool => tool.ready).length} جاهزة من ${tools.length}`, `${tools.filter(tool => tool.ready).length} of ${tools.length} ready`) }}</p></div></header>
      <div v-for="tool in tools.slice(0, 200)" :key="tool.name" class="w-row"><div><strong>{{ tool.name }}</strong><small>{{ tool.reason || (ar() && TOOL_DESCRIPTIONS_AR[tool.name]) || tool.description }}</small></div><span :class="['w-badge', tool.ready ? 'green' : 'orange']">{{ tool.group }}</span></div></section>
    <section class="w-section"><header><div><h3>{{ s('التراخيص', 'Licenses') }}</h3></div></header><button type="button" class="w-btn" @click="licenses = !licenses">{{ licenses ? s('إخفاء', 'Hide') : s('عرض', 'Show') }}</button>
      <pre v-if="licenses" class="s-legal" tabindex="0" dir="ltr">{{ (notices.value.value as { text?: string } | null)?.text }}</pre></section>
  </template>

  <template v-else>
    <div v-if="!system.value.value" :class="system.failure.value ? 'w-banner error' : 'w-skeleton'">{{ system.failure.value }}<template v-if="!system.failure.value"><i /><i /></template></div>
    <section v-else class="w-section"><header><div><h3>{{ s('الإعداد', 'Setting') }}</h3></div></header>
      <div v-if="system.failure.value" class="w-banner error">{{ system.failure.value }}</div>
      <template v-for="value in [system.value.value as SystemStatus]" :key="'sys'">
        <div v-if="page === 'notifications'" class="w-row"><div><strong>{{ s('إشعار عند انتهاء مهمة مجدولة', 'Notify when a scheduled task finishes') }}</strong></div><button type="button" role="switch" :aria-label="s('إشعار عند انتهاء مهمة مجدولة', 'Notify when a scheduled task finishes')" :aria-checked="value.notifyFinished" :class="['w-toggle', { on: value.notifyFinished }]" @click="setSystem({ notifyFinished: !value.notifyFinished })"><i /></button></div>
        <template v-if="page === 'quick-summon'">
          <div class="w-row"><div><strong>{{ s('استدعاء نجد باختصار عام', 'Bring NAJD up with a global shortcut') }}</strong><small v-if="value.quickSummon && !value.shortcutActive">{{ s('الاختصار محجوز لبرنامج آخر.', 'Another program holds this shortcut.') }}</small></div><button type="button" role="switch" :aria-label="s('استدعاء نجد باختصار عام', 'Bring NAJD up with a global shortcut')" :aria-checked="value.quickSummon" :class="['w-toggle', { on: value.quickSummon }]" @click="setSystem({ quickSummon: !value.quickSummon })"><i /></button></div>
          <label class="w-field"><span>{{ s('الاختصار', 'Shortcut') }}</span><input dir="ltr" :value="value.accelerator" @blur="setSystem({ accelerator: ($event.target as HTMLInputElement).value })" /><small>Control+Alt+N</small></label></template>
        <template v-if="page === 'quick-summon'">
          <!-- Desktop control (2026-11-10): how the real pointer shows NAJD's actions, and the emergency stop. -->
          <div class="w-row" data-pointer-mode><div><strong>{{ s('الماوس أثناء تحكم نجد', 'The mouse while NAJD controls the computer') }}</strong><small>{{ s('يتحرك مؤشر ويندوز الحقيقي إلى كل عنصر قبل التنفيذ. إذا حرّكت الماوس بنفسك يتوقف نجد ويسألك.', 'The real Windows pointer moves to each control before acting. If you move the mouse yourself, NAJD stops and asks.') }}</small></div>
            <div class="w-seg" role="radiogroup"><button v-for="mode in (['follow', 'fast', 'off'] as const)" :key="mode" type="button" role="radio" :aria-checked="(value.pointerMode || 'follow') === mode" :class="{ on: (value.pointerMode || 'follow') === mode }" @click="setSystem({ pointerMode: mode })">{{ mode === 'follow' ? s('متابعة مرئية', 'Visible') : mode === 'fast' ? s('سريع', 'Fast') : s('بدون حركة', 'Off') }}</button></div></div>
          <div class="w-row"><div><strong>{{ s('إيقاف طارئ', 'Emergency stop') }}</strong><small>{{ value.stopShortcut ? s('يوقف كل المهام الجارية فورًا.', 'Stops every running task at once.') : s('الاختصار محجوز لبرنامج آخر.', 'Another program holds this shortcut.') }}</small></div><kbd dir="ltr">{{ value.stopShortcut || 'Control+Alt+Q' }}</kbd></div></template>
        <div v-if="page === 'startup-launch'" class="w-row"><div><strong>{{ s('التشغيل مع ويندوز', 'Start with Windows') }}</strong><small v-if="!value.packaged">{{ s('يعمل في النسخة المثبتة فقط.', 'Works in the installed app only.') }}</small></div><button type="button" role="switch" :aria-label="s('التشغيل مع ويندوز', 'Start with Windows')" :aria-checked="value.launchAtLogin" :disabled="!value.packaged" :class="['w-toggle', { on: value.launchAtLogin }]" @click="setSystem({ launchAtLogin: !value.launchAtLogin })"><i /></button></div>
        <div v-if="page === 'desktop-pet'" class="w-row"><div><strong>{{ s('إظهار الرفيق المكتبي', 'Show the desktop pet') }}</strong><small>{{ s('نافذة صغيرة فوق النوافذ؛ النقر المزدوج يفتح نجد.', 'A small window on top; double-click opens NAJD.') }}</small></div><button type="button" role="switch" :aria-label="s('إظهار الرفيق المكتبي', 'Show the desktop pet')" :aria-checked="value.pet" :class="['w-toggle', { on: value.pet }]" @click="setSystem({ pet: !value.pet })"><i /></button></div>
      </template></section>
  </template>
</template>
