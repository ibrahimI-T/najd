<script setup lang="ts">
// Recall of earlier conversations and notes (Settings > Conversation memory): whether NAJD may bring the owner's saved notes and earlier chats
// into a new request when they match it, and which earlier chats are allowed. The service (electron/memory-service.cjs) has always supported
// all of it; the Vue renderer had no control, so an earlier chat could not be kept out of the context.
import { ref, watch } from 'vue'
import { usePrefs } from '../../composables/usePrefs'
import { useLoad } from '../../composables/useLoad'
import { toast } from '../../composables/useToast'

const { s, prefs } = usePrefs()
const host = window
const status = useLoad(window.najdMemoryGraph?.status)
const query = ref(''), limit = ref(30), chats = ref<{ total: number; matching: number; rows: NajdMemoryChat[] } | null>(null), failed = ref(false)
async function loadChats() {
  try { const result = await host.najdMemoryGraph!.chats({ query: query.value, offset: 0, limit: limit.value }); chats.value = { total: result.total, matching: result.matching, rows: result.rows }; failed.value = false } catch { failed.value = true }
}
watch([() => status.value.value?.settings.shareChats, query, limit], () => { if (status.value.value?.settings.shareChats) void loadChats() }, { immediate: true })
function setShare(patch: { shareNotes?: boolean; shareChats?: boolean }) {
  void status.run(() => host.najdMemoryGraph!.settings(patch), s('حُفظ الإعداد.', 'Setting saved.'))
}
async function allow(chat: NajdMemoryChat) {
  const next = !chat.allowed
  try { await host.najdMemoryGraph!.setChatAllowed(chat.id, next); chat.allowed = next } catch { toast(s('تعذر حفظ الإعداد.', 'The setting could not be saved.'), 'error') }
}
const date = (value: string) => { const at = new Date(value); return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString(prefs.language === 'ar' ? 'ar' : 'en') }
</script>

<template>
  <section v-if="status.value.value" class="w-section" data-recall>
    <header><div><h3>{{ s('تذكّر المحادثات والملاحظات', 'Recalling conversations and notes') }}</h3>
      <p>{{ s('عندما يطابق طلبك ملاحظة محفوظة أو محادثة سابقة، يضمّها نجد إلى الطلب. هنا تقرر ما يُسمح له بتذكّره.', 'When your request matches a saved note or an earlier conversation, NAJD can bring it in. Decide here what it may remember.') }}</p></div></header>
    <div v-if="status.value.value.error" class="w-banner warn">{{ s('تعذر فتح فهرس الذاكرة: ', 'The memory index could not be opened: ') + status.value.value.error }}</div>
    <div class="w-row"><div><strong>{{ s('استخدام ملاحظاتي المحفوظة', 'Use my saved notes') }}</strong></div>
      <button type="button" role="switch" data-recall-switch="notes" :aria-checked="status.value.value.settings.shareNotes" :aria-label="s('استخدام الملاحظات', 'Use notes')" :class="['w-toggle', { on: status.value.value.settings.shareNotes }]" :disabled="status.busy.value" @click="setShare({ shareNotes: !status.value.value!.settings.shareNotes })"><i /></button></div>
    <div class="w-row"><div><strong>{{ s('السماح لنجد بتذكّر محادثاتي السابقة', 'Let NAJD remember my earlier conversations') }}</strong></div>
      <button type="button" role="switch" data-recall-switch="chats" :aria-checked="status.value.value.settings.shareChats" :aria-label="s('تذكّر المحادثات', 'Remember conversations')" :class="['w-toggle', { on: status.value.value.settings.shareChats }]" :disabled="status.busy.value" @click="setShare({ shareChats: !status.value.value!.settings.shareChats })"><i /></button></div>
    <template v-if="status.value.value.settings.shareChats">
      <label class="w-search"><input v-model="query" type="search" maxlength="120" data-recall-search :placeholder="s('ابحث في المحادثات', 'Search conversations')" /></label>
      <p v-if="failed" class="pf-note">{{ s('تعذرت قراءة المحادثات.', 'The conversations could not be read.') }}</p>
      <p v-else-if="chats && !chats.rows.length" class="pf-note" data-recall-empty>{{ s('لا محادثات مطابقة.', 'No matching conversations.') }}</p>
      <div class="s-recall-list"><div v-for="chat in chats?.rows || []" :key="chat.id" class="w-row" data-recall-chat :data-allowed="chat.allowed"><div><strong dir="auto">{{ chat.title || s('مهمة', 'Task') }}</strong><small>{{ s(`${chat.messageCount} رسالة · ${date(chat.updatedAt)}`, `${chat.messageCount} messages · ${date(chat.updatedAt)}`) }}</small></div>
        <button type="button" role="switch" data-recall-chat-switch :aria-checked="chat.allowed" :aria-label="s('السماح بتذكّر هذه المحادثة', 'Allow remembering this conversation')" :class="['w-toggle', { on: chat.allowed }]" @click="allow(chat)"><i /></button></div></div>
      <div v-if="chats && chats.matching > chats.rows.length" class="w-row-end"><button type="button" class="w-btn" data-recall-more @click="limit += 30">{{ s(`عرض المزيد (${chats.rows.length} من ${chats.matching})`, `Show more (${chats.rows.length} of ${chats.matching})`) }}</button></div>
    </template>
  </section>
</template>
