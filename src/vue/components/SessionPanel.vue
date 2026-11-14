<script setup lang="ts">
// Session details (reference screenshot 4): environment, context use and what fills it, connectors, outputs. Sizes only, never text.
import { memoryFocus, focusFromTrace } from '../composables/useMemoryFocus'
import { computed, ref, watch } from 'vue'
import { Brain, ChevronDown, FileText, Folder, Laptop, Plug, Smartphone, Sparkles, Wrench } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import { toolName } from '../../workstation/toolNames'
import { reasonOf } from '../lib/memoryReasons'

const props = defineProps<{ conversationId: string | null; activity?: NajdTaskActivity; project: NajdProject | null }>()
const { s, prefs } = usePrefs()
const ar = computed(() => prefs.language === 'ar')
type Usage = NajdContextUsage & { conversationId?: string | null }
const PARTS = [{ key: 'history', ar: 'الرسائل', en: 'Messages', color: 'var(--blue)' }, { key: 'toolDefinitions', ar: 'تعريفات الأدوات', en: 'Tool definitions', color: 'var(--orange)' },
  { key: 'instructions', ar: 'تعليمات النظام والمهارات', en: 'System prompt and skills', color: 'var(--purple)' }, { key: 'taskSoFar', ar: 'خطوات المهمة الحالية', en: 'Current task steps', color: 'var(--green)' }] as const
const usage = ref<Usage | null>(null), context = ref<NajdAgentContext | null>(null), servers = ref<NajdMcpServer[]>([]), remote = ref<boolean | null>(null), more = ref(false), details = ref(true)
const short = (value: number) => value >= 1000 ? (value / 1000).toFixed(value >= 100000 ? 0 : 1) + 'k' : String(value)
// Memory used by the latest request of this conversation (the retrieval trace NAJD already records): which notes entered the context and why,
// so the owner can see what shaped an answer and correct it in Settings > Conversation memory.
const memoryUsed = ref<NajdMemoryTrace | null>(null)
const emit = defineEmits<{ memory: [] }>()
// A memory item opens Settings > Conversation memory with that note highlighted (when it is a learned preference or lesson).
function openMemory(uid: string) { memoryFocus.value = focusFromTrace(uid); emit('memory') }
const reasonText = (reason: string) => reasonOf(reason, ar.value)
async function loadMemory() {
  try { const rows = await window.najdMemoryGraph?.traces() || []; memoryUsed.value = rows.find(row => !!props.conversationId && row.session_id === props.conversationId) || null } catch { memoryUsed.value = null }
}
async function load() {
  void loadMemory()
  try { const rows = await window.najdGraph?.usage() as Usage[] | undefined; usage.value = (rows || []).filter(row => row.conversationId === props.conversationId).at(-1) || null } catch {}
  try { context.value = props.conversationId ? await window.najdAgent?.context(props.conversationId) || null : null } catch {}
  try { servers.value = await window.najdMcpServers?.list() || [] } catch {}
  try { remote.value = (await window.najdWorkstation?.remote())?.enabled ?? null } catch {}
  if (!skillNames.value) try { skillNames.value = Object.fromEntries((await window.najdWorkstation!.catalog()).entries.filter(entry => entry.kind === 'skill').map(entry => [entry.id, [entry.i18n?.ar?.displayName || entry.displayName, entry.displayName] as [string, string]])) } catch { skillNames.value = {} }
}
// What this conversation used, from the main-owned run receipts (owner request 2026-11-08): tokens, models, tools by name and skills read.
const skillNames = ref<Record<string, [string, string]> | null>(null)
const totals = computed(() => context.value?.totals || null)
const tools = computed(() => Object.entries(totals.value?.tools || {}).sort((a, b) => b[1] - a[1]))
// A skill outside the workstation catalog (an engine skill such as hermes-systematic-debugging-575b2847) is named from its id.
const readable = (id: string) => id.replace(/^(hermes|openclaw|najd|my)-/, '').replace(/-[0-9a-f]{8,}$/, '').replace(/-/g, ' ')
const skills = computed(() => (totals.value?.skills || []).map(id => ({ id, name: skillNames.value?.[id]?.[ar.value ? 0 : 1] || readable(id) })))
const models = computed(() => [...new Set((context.value?.runs || []).map(run => run.modelName || run.provider).filter(Boolean))] as string[])
const recent = computed(() => (context.value?.runs || []).slice(-5).reverse())
const number = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString(ar.value ? 'ar' : 'en')
const clock = (at: number) => new Date(at).toLocaleTimeString(ar.value ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })
watch(() => [props.conversationId, props.activity], load, { immediate: true })
const windowSize = computed(() => usage.value?.windowTokens || context.value?.runs.at(-1)?.contextWindow || null)
const used = computed(() => usage.value?.total || 0)
const percent = computed(() => windowSize.value ? Math.min(100, Math.round(used.value / windowSize.value * 100)) : null)
const free = computed(() => windowSize.value ? Math.max(0, windowSize.value - used.value) : null)
const shown = computed(() => more.value ? servers.value : servers.value.slice(0, 3))
async function toggleRemote(enabled: boolean) { try { remote.value = (await window.najdWorkstation!.remoteConfigure({ enabled })).enabled } catch {} }
async function connect(id: string) { try { const server = servers.value.find(item => item.id === id); const next = server?.remote && server.error === 'AUTH_REQUIRED' ? await window.najdMcpServers!.signIn(id) : await window.najdMcpServers!.connect(id); servers.value = servers.value.map(item => item.id === next.id ? next : item) } catch {} }
const openOutput = (path: string) => { if (props.conversationId) void window.najdAgent?.openOutput?.(props.conversationId, path, 'open') }
const part = (key: string) => (usage.value as unknown as Record<string, number> | null)?.[key] || 0
</script>

<template>
  <div class="sp" data-session-panel>
    <section class="sp-block"><h3>{{ s('البيئة', 'Environment') }}</h3>
      <div class="sp-line"><Laptop :size="15" /><span>{{ s('هذا الحاسوب', 'This computer') }}</span></div>
      <div class="sp-line"><Folder :size="15" /><bdi dir="auto">{{ project ? project.name + (project.folder ? ' · ' + project.folder : '') : s('بدون مشروع', 'No project') }}</bdi></div>
      <div class="sp-line"><Smartphone :size="15" /><span>{{ s('التحكم عن بعد', 'Remote Control') }}</span><span class="w-grow" />
        <button v-if="remote !== null" type="button" role="switch" :aria-checked="remote" :aria-label="s('التحكم عن بعد', 'Remote Control')" :class="['w-toggle', { on: remote }]" @click="toggleRemote(!remote)"><i /></button></div>
    </section>
    <section class="sp-block" data-usage><h3>{{ s('استهلاك هذه المحادثة', 'This conversation') }}</h3>
      <small v-if="!totals || !totals.runs">{{ conversationId ? s('لم يكتمل أي طلب في هذه المحادثة بعد.', 'No finished request in this conversation yet.') : s('ابدأ مهمة ليظهر الاستهلاك هنا.', 'Start a task to see what it uses here.') }}</small>
      <template v-else>
        <div class="sp-stats">
          <div><small>{{ s('إجمالي التوكنات', 'Total tokens') }}</small><b dir="ltr" data-usage-total>{{ number(totals.total) }}</b></div>
          <div><small>{{ s('مدخل', 'Input') }}</small><b dir="ltr">{{ number(totals.input) }}</b></div>
          <div><small>{{ s('مخرج', 'Output') }}</small><b dir="ltr">{{ number(totals.output) }}</b></div>
          <div><small>{{ s('من الذاكرة المؤقتة', 'Cached') }}</small><b dir="ltr">{{ number(totals.cached) }}</b></div>
          <div><small>{{ s('طلبات النموذج', 'Model calls') }}</small><b dir="ltr">{{ number(totals.modelCalls) }}</b></div>
          <div><small>{{ s('استدعاءات الأدوات', 'Tool calls') }}</small><b dir="ltr">{{ number(totals.toolCalls) }}</b></div>
          <div><small>{{ s('الطلبات', 'Requests') }}</small><b dir="ltr">{{ number(totals.runs) }}</b></div></div>
        <small v-if="totals.partial && totals.total !== null" class="sp-hint">{{ s('بعض الطلبات لم يذكر مزودها عدد التوكنات؛ المجموع جزئي.', 'Some providers did not report tokens; the totals are partial.') }}</small>
        <div v-if="models.length" class="sp-line"><span>{{ s('النماذج', 'Models') }}</span><span class="w-grow" /><bdi dir="ltr" class="sp-models">{{ models.join(' · ') }}</bdi></div>
        <h4><Sparkles :size="13" />{{ s('المهارات المستخدمة', 'Skills used') }}</h4>
        <small v-if="!skills.length" class="sp-hint">{{ s('لم تُقرأ أي مهارة.', 'No skill was read.') }}</small>
        <div v-else class="sp-chips" data-usage-skills><span v-for="item in skills" :key="item.id" class="sp-chip" :title="item.id" dir="auto">{{ item.name }}</span></div>
        <h4><Wrench :size="13" />{{ s('الأدوات المستخدمة', 'Tools used') }}</h4>
        <small v-if="!tools.length" class="sp-hint">{{ s('لم تُستخدم أدوات.', 'No tools were used.') }}</small>
        <ul v-else class="sp-tools" data-usage-tools><li v-for="[name, times] in tools" :key="name" :title="name"><span dir="auto">{{ toolName(name, ar) }}</span><b dir="ltr">×{{ times }}</b></li></ul>
        <h4>{{ s('آخر الطلبات', 'Recent requests') }}</h4>
        <ul class="sp-runs"><li v-for="run in recent" :key="run.runId"><small dir="ltr">{{ clock(run.at) }}</small><bdi dir="ltr">{{ run.modelName || run.provider || '—' }}</bdi><span v-if="run.state !== 'COMPLETED'" class="sp-state" :data-state="run.state">{{ run.state === 'CANCELLED' ? s('أُلغي', 'Stopped') : s('فشل', 'Failed') }}</span><span class="w-grow" /><small dir="ltr">{{ number(run.usage.total) }} {{ s('توكن', 'tok') }} · {{ run.toolCalls }} {{ s('أداة', 'tools') }}</small></li></ul>
      </template>
    </section>
    <section class="sp-block" data-context><h3>{{ s('السياق', 'Context') }}</h3>
      <template v-if="usage">
        <div class="sp-line"><strong>{{ percent !== null ? s(`${percent}% مستخدم`, `${percent}% used`) : s('حجم النافذة غير معروف', 'Window size unknown') }}</strong><span class="w-grow" /><small dir="ltr">{{ short(used) }}{{ windowSize ? ' / ' + short(windowSize) : '' }}</small></div>
        <div class="sp-bar"><i v-for="item in PARTS" :key="item.key" :style="{ width: windowSize ? (part(item.key) / windowSize * 100) + '%' : 0, background: item.color }" /></div>
        <button type="button" class="sp-toggle" :aria-expanded="details" @click="details = !details"><ChevronDown :size="13" :data-open="details" />{{ s('ما الذي يملأ السياق', 'What fills the context') }}</button>
        <ul v-if="details" class="sp-parts"><li v-for="item in PARTS" :key="item.key"><i :style="{ background: item.color }" /><span>{{ s(item.ar, item.en) }}</span><small dir="ltr">{{ short(part(item.key)) }}</small><small dir="ltr">{{ windowSize ? (part(item.key) / windowSize * 100).toFixed(1) + '%' : '' }}</small></li>
          <li v-if="free !== null"><i style="background: var(--surface-4)" /><span>{{ s('مساحة فارغة', 'Free space') }}</span><small dir="ltr">{{ short(free) }}</small><small dir="ltr">{{ (free / windowSize! * 100).toFixed(1) }}%</small></li>
          <li class="sp-note"><span>{{ s(`الطلب الأخير: ${usage.tools} أداة محملة · طبقة ${usage.tier}`, `Latest request: ${usage.tools} tools loaded · ${usage.tier} tier`) }}</span></li></ul>
      </template>
      <small v-else>{{ conversationId ? s('لم يُرسل طلب للنموذج في هذه المحادثة بعد.', 'No model request in this conversation yet.') : s('ابدأ مهمة ليظهر استهلاك السياق.', 'Start a task to see context use.') }}</small>
      <small v-if="totals && totals.runs" class="sp-hint">{{ s('كل طلب يعيد إرسال السياق، لذلك يزيد المجموع أسرع من حجم السياق.', 'Each request resends its context, so the totals grow faster than the context.') }}</small>
    </section>
    <section class="sp-block" data-memory-used><h3>{{ s('الذاكرة المستخدمة', 'Memory used') }}</h3>
      <small v-if="!memoryUsed">{{ s('لم يستخدم هذا الحوار الذاكرة بعد.', 'This conversation has not used memory yet.') }}</small>
      <small v-else-if="!memoryUsed.items.length">{{ s('آخر طلب لم يحتج أي ملاحظة من الذاكرة.', 'The last request needed no memory notes.') }}</small>
      <template v-else>
        <button v-for="item in memoryUsed.items.slice(0, 8)" :key="item.id" type="button" class="sp-line sp-link" data-memory-item :title="s('افتحها في ذاكرة المحادثة لتعديلها أو حذفها', 'Open it in Conversation memory to edit or delete it')" @click="openMemory(item.id)"><Brain :size="15" /><bdi>{{ item.title }}</bdi><span class="w-grow" /><small>{{ reasonText(item.reason) }}</small></button>
        <small v-if="memoryUsed.items.length > 8">{{ s('و', 'and ') + (memoryUsed.items.length - 8) + s(' أخرى', ' more') }}</small>
        <small>{{ s('آخر طلب · ', 'Last request · ') + clock(Date.parse(memoryUsed.at)) + ' · ' + number(memoryUsed.tokens) + s(' توكن', ' tokens') }}</small>
      </template>
      <div v-if="project?.instructions?.trim()" class="sp-line" data-project-instructions><Folder :size="15" /><bdi>{{ s('تعليمات المشروع', 'Project instructions') + ' · ' + project.name }}</bdi></div>
      <small v-if="project?.instructions?.trim()" dir="auto" class="sp-quote">{{ project.instructions.trim().slice(0, 160) + (project.instructions.trim().length > 160 ? '…' : '') }}</small>
      <small>{{ s('اضغط ملاحظة لتعديلها أو حذفها في الإعدادات ← ذاكرة المحادثة، وتعليمات المشروع من صفحة المشروع.', 'Press a note to edit or delete it in Settings > Conversation memory; and project instructions on the project page.') }}</small>
    </section>
    <section class="sp-block" data-connectors><h3>{{ s('الاتصالات', 'Connectors') }}</h3>
      <small v-if="!servers.length">{{ s('لا توجد خوادم MCP مضافة.', 'No MCP servers added.') }}</small>
      <div v-for="server in shown" :key="server.id" class="sp-line"><Plug :size="15" /><bdi>{{ server.name }}</bdi><span class="w-grow" />
        <small v-if="server.state === 'connected'" class="sp-ok">{{ s('متصل', 'Connected') }}</small>
        <button v-else type="button" class="sp-action" @click="connect(server.id)">{{ /AUTH|401|403|TOKEN/i.test(server.error || '') ? s('توثيق', 'Authenticate') : server.state === 'failed' ? s('إعادة المحاولة', 'Retry') : s('اتصال', 'Connect') }}</button></div>
      <button v-if="servers.length > 3" type="button" class="sp-toggle" @click="more = !more">{{ more ? s('عرض أقل', 'Show less') : s('عرض المزيد', 'Show more') }}</button>
    </section>
    <section class="sp-block" data-outputs><h3>{{ s('المخرجات', 'Outputs') }}</h3>
      <small v-if="!context?.outputs.length">{{ s('لا توجد ملفات بعد.', 'No files yet.') }}</small>
      <button v-for="(item, index) in context?.outputs || []" :key="index" type="button" class="sp-line sp-file" :disabled="!item.path || !conversationId" @click="item.path && openOutput(item.path)"><FileText :size="15" /><bdi dir="auto">{{ item.name }}</bdi></button>
    </section>
  </div>
</template>
