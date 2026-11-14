<script setup lang="ts">
// The conversation: messages, the live activity, the approval card, recovery of an unanswered request, errors and the image viewer.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDown, Bookmark, BookmarkCheck, Brain, Check, ChevronDown, ChevronUp, Copy, GitBranch, Pencil, RotateCcw, Search, ShieldCheck, Shuffle, Sparkles, Square, Volume2, X } from 'lucide-vue-next'
import ActivityBox from './ActivityBox.vue'
import MessageBody from './MessageBody.vue'
import FileCards, { type FileCard } from './FileCards.vue'
import AttachmentThumb from './AttachmentThumb.vue'
import { mentionedPaths } from '../lib/filePaths'
import { buildActivity, resumeNote, skillWorthyRun } from '../../activity'
import { languageOf, speakableText } from '../lib/speech'
import { clearPaint, findRanges, paint } from '../lib/findInThread'
import { usePrefs } from '../composables/usePrefs'
import { reasonOf, traceFor } from '../lib/memoryReasons'
import { errorText } from '../../workstation/errorText'
import type { Conversation, WorkRun } from '../composables/useConversation'
import type { ProviderState } from '../composables/useProviders'

const props = defineProps<{ chat: Conversation; providers?: ProviderState }>()
const emit = defineEmits<{ open: [item: { title: string; language: string; source: string }]; edit: [text: string] }>()
async function branch(index: number) { if (await c.branchFrom(index)) emit('edit', c.draft.value) }
const { s, prefs, change } = usePrefs()
const ar = computed(() => prefs.language === 'ar')
const c = props.chat
const scroller = ref<HTMLElement | null>(null)
const following = ref(true), showLatest = ref(false)
const viewer = ref<{ id: string; src: string; name: string } | null>(null)
const copied = ref<number | null>(null)
const lastUser = computed(() => [...c.messages.value].reverse().find(message => message.role === 'user')?.text)
const pending = computed(() => c.workRuns.value.filter(run => run.sessionId === c.activeSessionId.value && !c.messages.value.slice(run.afterIndex).some(item => item.role === 'assistant')).slice(-1))
const interrupted = computed(() => !c.busy.value && !c.approval.value && !c.importing.value && c.messages.value.at(-1)?.role === 'user' && !c.workRuns.value.some(run => run.sessionId === c.activeSessionId.value))
function runFor(message: NajdMessage, index: number): WorkRun | undefined {
  if (message.activity) return { key: 'saved:' + index, sessionId: c.activeSessionId.value, afterIndex: index, startedAt: Date.parse(message.activity.startedAt), finishedAt: message.activity.finishedAt ? Date.parse(message.activity.finishedAt) : Date.now(), steps: [], activity: message.activity }
  return message.role === 'assistant' ? c.workRuns.value.find(run => run.sessionId === c.activeSessionId.value && run.afterIndex === index) : undefined
}
const near = (element: HTMLElement) => element.scrollHeight - element.clientHeight - element.scrollTop < 80
function onScroll() { if (!scroller.value) return; following.value = near(scroller.value); showLatest.value = !following.value }
function toLatest() { following.value = true; if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight; showLatest.value = false }
watch(() => [c.messages.value.length, c.workRuns.value, c.approval.value, c.busy.value], async () => { await nextTick(); if (following.value) toLatest() }, { deep: true })
watch(c.activeSessionId, async () => { await nextTick(); toLatest() })
// Files each reply produced (the conversation's recorded outputs, by when its run worked) or names in its text: shown as cards under it.
const outputs = ref<NajdAgentContext['outputs']>([])
async function loadOutputs() {
  const id = c.activeSessionId.value
  try { outputs.value = id ? (await window.najdAgent?.context(id))?.outputs || [] : [] } catch { outputs.value = [] }
}
watch([c.activeSessionId, c.busy, () => c.messages.value.length], () => { void loadOutputs() }, { immediate: true })
function filesFor(message: NajdMessage, index: number): FileCard[] {
  if (message.role !== 'assistant') return []
  const run = runFor(message, index)
  const produced = run ? outputs.value.filter(item => item.path && item.at >= run.startedAt - 1000 && item.at <= (run.finishedAt ?? Date.now()) + 5000) : []
  const cards: FileCard[] = produced.map(item => ({ path: item.path!, name: item.name, output: true }))
  for (const path of mentionedPaths(message.text)) if (!cards.some(card => card.path.toLowerCase() === path.toLowerCase())) cards.push({ path, output: outputs.value.some(item => item.path === path) })
  return cards.slice(0, 8)
}
// Learning loop (after Hermes Agent's: skills from experience, owner request 2026-11-10): the latest reply of a task that took several tool
// steps and finished offers to keep the procedure as a skill. One click asks NAJD to write it; the skill is saved only after the owner
// approves it in chat (najd_skill_save is approval-gated). Offered once per reply.
const offered = ref<Set<string>>(new Set())
const offerKey = (index: number) => (c.activeSessionId.value || '') + ':' + index
function skillWorthy(message: NajdMessage, index: number) {
  if (message.role !== 'assistant' || index !== c.messages.value.length - 1 || c.busy.value || offered.value.has(offerKey(index))) return false
  return skillWorthyRun(runFor(message, index)?.activity?.events)
}
function saveAsSkill(index: number) {
  offered.value = new Set([...offered.value, offerKey(index)])
  c.submitText(s('حوّل طريقة تنفيذ المهمة السابقة إلى مهارة قابلة لإعادة الاستخدام: اقترح اسمًا ووصفًا وخطوات واضحة تعمم الطريقة (بدون بيانات خاصة بهذه المرة)، ثم احفظها بـ najd_skill_save بعد موافقتي.',
    'Turn how the previous task was done into a reusable skill: propose a name, a description and clear steps that generalise the method (without the private details of this particular run), then save it with najd_skill_save after I approve.'), {})
}
// Read aloud (lib/speech.ts, electron/speech.cjs): Windows' own voices, Arabic included; one reply at a time, pressing again stops.
const speaking = ref<number | null>(null), loadingSpeech = ref<number | null>(null)
let player: HTMLAudioElement | null = null
function stopSpeaking() { player?.pause(); player = null; speaking.value = null; loadingSpeech.value = null }
async function speak(text: string, index: number) {
  if (speaking.value === index || loadingSpeech.value === index) { stopSpeaking(); return }
  stopSpeaking()
  const words = speakableText(text)
  if (!words || !window.najdSessions?.speak) return
  loadingSpeech.value = index
  try {
    const result = await window.najdSessions.speak(words, languageOf(words))
    if (loadingSpeech.value !== index) return
    player = new Audio(result.audio)
    player.onended = player.onerror = () => { if (speaking.value === index) stopSpeaking() }
    loadingSpeech.value = null; speaking.value = index
    await player.play()
  } catch { if (loadingSpeech.value === index || speaking.value === index) stopSpeaking() }
}
watch(c.activeSessionId, stopSpeaking)
// Retry with another model (as in the reference apps): the latest request again on a model the owner picks for this answer only;
// the default model stays as it is. Lists the current provider's models.
// Memory used by each answer: the retrieval trace NAJD records per request, matched to the answer by time (see lib/memoryReasons.ts).
const memoryTraces = ref<NajdMemoryTrace[]>([]), memoryOpen = ref<number | null>(null)
async function loadMemoryTraces() { try { const rows = await window.najdMemoryGraph?.traces() || []; memoryTraces.value = rows.filter(row => !!c.activeSessionId.value && row.session_id === c.activeSessionId.value && row.items.length) } catch { memoryTraces.value = [] } }
watch(() => [c.activeSessionId.value, c.messages.value.length, c.busy.value], loadMemoryTraces, { immediate: true })
const memoryOf = (index: number) => traceFor(memoryTraces.value, c.messages.value, index)
const retryMenu = ref(false)
const otherModels = computed(() => { const p = props.providers; if (!p) return []; return (p.models[p.provider.value] || []).filter(item => item.id !== p.model.value).slice(0, 12) })
function retryWith(model: string) { retryMenu.value = false; if (lastUser.value && props.providers) c.submitText(lastUser.value, { model: { provider: props.providers.provider.value, model } }) }
// Find in this conversation (lib/findInThread.ts): Ctrl+F opens the bar, Enter or the arrows move between matches, Esc closes.
const finding = ref(false), findQuery = ref(''), findIndex = ref(0), findCount = ref(0), findInput = ref<HTMLInputElement | null>(null)
let found: Range[] = []
function runFind(move = 0) {
  if (!scroller.value || !findQuery.value.trim()) { found = []; findCount.value = 0; clearPaint(); return }
  found = findRanges(scroller.value, findQuery.value)
  findCount.value = found.length
  if (!found.length) { clearPaint(); return }
  findIndex.value = ((move ? findIndex.value + move : Math.min(findIndex.value, found.length - 1)) + found.length) % found.length
  paint(found, findIndex.value)
  following.value = false
  found[findIndex.value].startContainer.parentElement?.scrollIntoView({ block: 'center' })
}
function openFind() { finding.value = true; void nextTick(() => { findInput.value?.focus(); findInput.value?.select() }) }
function closeFind() { finding.value = false; findQuery.value = ''; found = []; findCount.value = 0; clearPaint() }
watch(findQuery, () => { findIndex.value = 0; runFind() })
watch(() => [c.activeSessionId.value, c.messages.value.length], () => { if (finding.value) void nextTick(() => runFind()) })
const findKeys = (event: KeyboardEvent) => { if (event.ctrlKey && event.code === 'KeyF') { event.preventDefault(); openFind() } }
onMounted(() => window.addEventListener('keydown', findKeys))
onBeforeUnmount(() => { window.removeEventListener('keydown', findKeys); clearPaint() })
// My prompts (original NAJD improvement, 2026-11-10): a request that worked is kept with one click and reused from the "/" menu or the
// home chips; it stays editable in Settings > Common prompts. Pressing again removes it.
function savePrompt(text: string) {
  const clean = text.trim()
  if (!clean || clean.length > 4000) return
  change({ prompts: prefs.prompts.includes(clean) ? prefs.prompts.filter(item => item !== clean) : [clean, ...prefs.prompts].slice(0, 100) })
}
// Continue from where it stopped: after a stop or a failure the same request runs again with a note of the steps already taken.
const stoppedRun = computed(() => pending.value[0] && pending.value[0].finishedAt ? pending.value[0] : null)
const canContinue = computed(() => !c.busy.value && !c.approval.value && c.messages.value.at(-1)?.role === 'user' && !!stoppedRun.value && !['EXPORTED', 'EXPORTED_PDF', 'EXPORTED_MD', 'EXPORT_EXISTS', 'EXPORT_FAILED', 'HISTORY'].includes(String(c.errorCode.value)))
function continueRun() {
  const run = stoppedRun.value, text = c.messages.value.at(-1)?.text
  if (!run || !text) return
  const view = buildActivity(run.activity)
  const note = resumeNote(view.rows.flatMap(row => row.type === 'event' ? [row.event] : row.group.items))
  void c.submitText(text, { alreadySaved: true, ...(note ? { resumeNote: note } : {}) })
}
const openPicture = (id: string) => { void window.najdLibrary?.open?.(id) }
const revealPicture = (id: string) => { void window.najdLibrary?.reveal(id) }
function copy(text: string, index: number) { void navigator.clipboard.writeText(text).then(() => { copied.value = index; setTimeout(() => { copied.value = null }, 1500) }) }
</script>

<template>
  <div ref="scroller" class="c-scroll" data-thread @scroll="onScroll">
    <div v-if="finding" class="c-find" role="search" data-find @keydown.esc.stop="closeFind"><Search :size="15" />
      <input ref="findInput" v-model="findQuery" type="search" maxlength="200" :placeholder="s('ابحث في هذه المحادثة', 'Find in this conversation')" :aria-label="s('ابحث في هذه المحادثة', 'Find in this conversation')" @keydown.enter.prevent="runFind($event.shiftKey ? -1 : 1)" />
      <small aria-live="polite" dir="ltr" data-find-count>{{ findQuery.trim() ? (findCount ? (findIndex + 1) + ' / ' + findCount : s('لا نتائج', 'No matches')) : '' }}</small>
      <button type="button" class="w-icon" :aria-label="s('السابق', 'Previous')" :disabled="!findCount" @click="runFind(-1)"><ChevronUp :size="15" /></button>
      <button type="button" class="w-icon" :aria-label="s('التالي', 'Next')" :disabled="!findCount" @click="runFind(1)"><ChevronDown :size="15" /></button>
      <button type="button" class="w-icon" :aria-label="s('إغلاق البحث', 'Close find')" @click="closeFind"><X :size="15" /></button></div>
    <div class="c-list" aria-live="polite">
      <article v-for="(message, index) in c.messages.value" :key="index" :class="['c-msg', message.role]">
        <ActivityBox v-if="message.role === 'assistant' && runFor(message, index)" :run="runFor(message, index)!" />
        <div v-if="message.attachments?.length" class="c-attached"><AttachmentThumb v-for="item in message.attachments" :key="item.id" :id="item.id" :name="item.name" size="large" @view="item => viewer = item" /></div>
        <div v-if="message.role === 'user'" class="c-body" dir="auto">{{ message.text }}</div>
        <MessageBody v-else :text="message.text" @open="item => emit('open', item)" @picture="item => viewer = item" />
        <FileCards v-if="message.role === 'assistant'" :files="filesFor(message, index)" :conversation-id="c.activeSessionId.value" @open="item => emit('open', item)" />
        <div class="c-actions">
          <button type="button" class="w-icon" :aria-label="s('نسخ', 'Copy')" @click="copy(message.text, index)"><component :is="copied === index ? Check : Copy" :size="14" /></button>
          <button v-if="message.role === 'assistant'" type="button" class="w-icon" data-read-aloud :aria-pressed="speaking === index || loadingSpeech === index" :aria-label="speaking === index ? s('إيقاف القراءة', 'Stop reading') : s('استمع', 'Listen')" :title="speaking === index ? s('إيقاف القراءة', 'Stop reading') : s('استمع', 'Listen')" @click="speak(message.text, index)"><component :is="speaking === index ? Square : Volume2" :size="14" :class="{ 'w-pulse': loadingSpeech === index }" /></button>
          <button v-if="message.role === 'user' && index === c.messages.value.length - 1 && !c.busy.value" type="button" class="w-icon" :aria-label="s('تعديل', 'Edit')" @click="emit('edit', message.text)"><Pencil :size="14" /></button>
          <button v-if="message.role === 'user'" type="button" class="w-icon" data-save-prompt :aria-pressed="prefs.prompts.includes(message.text)" :aria-label="prefs.prompts.includes(message.text) ? s('محفوظ في أوامري', 'Saved in my prompts') : s('احفظه في أوامري', 'Save to my prompts')" :title="prefs.prompts.includes(message.text) ? s('محفوظ في أوامري: اكتب / لاستخدامه', 'Saved in my prompts: type / to use it') : s('احفظه في أوامري لتعيد استخدامه بـ /', 'Save to my prompts and reuse it with /')" @click="savePrompt(message.text)"><component :is="prefs.prompts.includes(message.text) ? BookmarkCheck : Bookmark" :size="14" /></button>
          <button v-if="message.role === 'user' && index > 0 && !c.busy.value && !c.approval.value" type="button" class="w-icon" data-branch :aria-label="s('تفرّع من هنا', 'Branch from here')" :title="s('محادثة جديدة من هذه النقطة؛ عدّل الرسالة وأرسلها', 'New conversation from this point; edit the message and send it')" @click="branch(index)"><GitBranch :size="14" /></button>
          <button v-if="message.role === 'assistant' && index === c.messages.value.length - 1 && !c.busy.value && lastUser" type="button" class="w-icon" :aria-label="s('إعادة المحاولة', 'Retry')" @click="c.submitText(lastUser!, {})"><RotateCcw :size="14" /></button>
          <span v-if="message.role === 'assistant' && index === c.messages.value.length - 1 && !c.busy.value && lastUser && otherModels.length" class="w-menu-box"><button type="button" class="w-icon" data-retry-model :aria-expanded="retryMenu" :aria-label="s('إعادة بنموذج آخر', 'Retry with another model')" :title="s('إعادة بنموذج آخر', 'Retry with another model')" @click="retryMenu = !retryMenu"><Shuffle :size="14" /></button>
            <div v-if="retryMenu" class="w-menu" role="menu"><button v-for="item in otherModels" :key="item.id" type="button" role="menuitem" class="w-menu-item" @click="retryWith(item.id)"><bdi dir="ltr">{{ item.label }}</bdi></button></div></span>
          <span v-if="message.role === 'assistant' && memoryOf(index)" class="w-menu-box"><button type="button" class="w-icon c-memory" data-memory-chip :aria-expanded="memoryOpen === index" :aria-label="s('الذاكرة المستخدمة في هذا الرد', 'Memory used in this answer')" :title="s('الذاكرة المستخدمة في هذا الرد', 'Memory used in this answer')" @click="memoryOpen = memoryOpen === index ? null : index"><Brain :size="14" /><small>{{ memoryOf(index)!.items.length }}</small></button>
            <div v-if="memoryOpen === index" class="w-menu c-memory-list" role="dialog" :aria-label="s('الذاكرة المستخدمة', 'Memory used')"><div v-for="item in memoryOf(index)!.items.slice(0, 8)" :key="item.id" class="c-memory-item"><bdi dir="auto">{{ item.title }}</bdi><small>{{ reasonOf(item.reason, ar) }}</small></div><small>{{ s('عدّلها من الإعدادات ← ذاكرة المحادثة', 'Edit in Settings > Conversation memory') }}</small></div></span>
          <button v-if="skillWorthy(message, index)" type="button" class="c-skill-offer" data-skill-offer @click="saveAsSkill(index)"><Sparkles :size="14" />{{ s('حوّلها إلى مهارة', 'Save as a skill') }}</button>
        </div>
      </article>
    </div>
    <ActivityBox v-for="run in pending" :key="run.key" :run="run" :can-stop="(c.busy.value && !!c.activeTaskId.value) || !!c.approval.value?.taskId" @stop="c.stop()" />
    <div v-if="interrupted" class="w-banner warn" role="status"><span>{{ s('لم يصل رد على هذا الطلب: توقف العمل قبل أن يكتمل.', 'This request never got its answer: the work stopped before it finished.') }}</span>
      <button type="button" class="w-btn" @click="c.submitText(c.messages.value.at(-1)!.text, { alreadySaved: true })">{{ s('أكمل الطلب', 'Resume the request') }}</button></div>
    <section v-if="c.approval.value" class="c-approval" role="alert" dir="ltr" lang="en" data-approval>
      <h3><ShieldCheck :size="16" />Approval needed</h3>
      <p dir="auto">{{ c.approval.value.agent?.summary || (c.approval.value.localOnly ? 'Read this file for a local preview only.' : 'NAJD asks to carry out this action.') }}</p>
      <code v-if="c.approval.value.path" dir="ltr">{{ c.approval.value.path }}</code>
      <pre v-if="c.approval.value.agent?.body" dir="ltr">{{ c.approval.value.agent.body }}</pre>
      <div><button type="button" class="w-btn primary" :disabled="c.busy.value" @click="c.respondToApproval('ALLOW_ONCE')">Allow once</button>
        <button v-if="c.approval.value.agent" type="button" class="w-btn" :disabled="c.busy.value" @click="c.respondToApproval('ALLOW_TASK')">Allow for this task</button>
        <button type="button" class="w-btn danger" :disabled="c.busy.value" @click="c.respondToApproval('DENY')">Deny</button></div>
    </section>
    <section v-if="c.localPreview.value && c.localPreview.value.sessionId === c.activeSessionId.value" class="c-preview"><pre tabindex="0">{{ c.localPreview.value.text }}</pre><button type="button" class="w-btn" @click="c.localPreview.value = null">{{ s('إزالة المعاينة', 'Clear preview') }}</button></section>
    <div v-if="c.errorCode.value" :class="['w-banner', c.errorCode.value === 'CANCELLED' || String(c.errorCode.value).startsWith('EXPORTED') ? 'info' : 'error']" role="alert"><span>{{ errorText(c.errorCode.value!, prefs.language) }}</span><button v-if="canContinue" type="button" class="w-btn" data-continue :title="s('يكمل نفس الطلب ويخبر النموذج بالخطوات التي انتهت حتى لا يعيدها', 'Continues the same request and tells the model which steps already finished so it does not repeat them')" @click="continueRun">{{ s('أكمل من حيث توقف', 'Continue from where it stopped') }}</button><button type="button" class="w-btn ghost" @click="c.errorCode.value = null">{{ s('إغلاق', 'Dismiss') }}</button></div>
    <button v-if="showLatest" type="button" class="c-latest" :aria-label="s('آخر المحادثة', 'Latest messages')" @click="toLatest"><ArrowDown :size="15" /></button>
    <div v-if="viewer" class="c-viewer" role="dialog" aria-modal="true" :aria-label="viewer.name" data-image-viewer @mousedown.self="viewer = null" @keydown.esc="viewer = null">
      <img :src="viewer.src" :alt="viewer.name" />
      <div class="c-viewer-bar"><bdi>{{ viewer.name }}</bdi><span class="w-grow" />
        <button type="button" class="w-btn" @click="openPicture(viewer!.id)">{{ s('فتح في البرنامج', 'Open in its app') }}</button>
        <button type="button" class="w-btn" @click="revealPicture(viewer!.id)">{{ s('عرض في المجلد', 'Show in folder') }}</button>
        <button type="button" class="w-btn primary" @click="viewer = null">{{ s('إغلاق', 'Close') }}</button></div>
    </div>
  </div>
</template>
