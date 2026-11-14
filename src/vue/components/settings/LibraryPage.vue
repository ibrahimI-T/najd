<script setup lang="ts">
// The attachment library: every file NAJD imported (attachments, pictures, knowledge-base files) or produced (generated documents and
// captures). The service and its IPC (najdLibrary.list/remove/reveal) were complete, but the Vue renderer had no page for it, so nothing
// imported could be seen or deleted from the app.
import { computed, ref } from 'vue'
import { FolderOpen, Trash2 } from 'lucide-vue-next'
import { usePrefs } from '../../composables/usePrefs'
import { useLoad } from '../../composables/useLoad'

const { s, prefs } = usePrefs()
const host = window
const library = useLoad(window.najdLibrary?.list)
const query = ref(''), confirming = ref<string | null>(null)
const items = computed(() => {
  const word = query.value.trim().toLowerCase()
  return [...(library.value.value || [])].filter(item => !word || item.name.toLowerCase().includes(word)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
})
const total = computed(() => (library.value.value || []).reduce((sum, item) => sum + item.size, 0))
const KIND: Record<NajdAsset['kind'], [string, string]> = { text: ['نص', 'Text'], pdf: ['PDF', 'PDF'], docx: ['Word', 'Word'], xlsx: ['Excel', 'Excel'], pptx: ['PowerPoint', 'PowerPoint'], image: ['صورة', 'Image'], video: ['فيديو', 'Video'] }
const size = (bytes: number) => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : bytes >= 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' B'
const date = (value: string) => { const at = new Date(value); return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString(prefs.language === 'ar' ? 'ar' : 'en') }
// Deleting asks twice: the first press turns the button into a confirmation for a few seconds.
let timer: ReturnType<typeof setTimeout> | null = null
function remove(item: NajdAsset) {
  if (confirming.value !== item.id) { confirming.value = item.id; if (timer) clearTimeout(timer); timer = setTimeout(() => { confirming.value = null }, 4000); return }
  confirming.value = null
  void library.run(() => host.najdLibrary!.remove(item.id), s('حُذف من المكتبة.', 'Removed from the library.'))
}
</script>

<template>
  <section class="w-section" data-library-page>
    <header><div><h3>{{ s('مكتبة المرفقات', 'Attachment library') }}</h3>
      <p>{{ s(`${(library.value.value || []).length} عنصر · ${size(total)}. ما استوردته نجد أو أنتجه لك. حذف عنصر يزيله من المكتبة ولا يمس الملف الأصلي على جهازك.`, `${(library.value.value || []).length} items · ${size(total)}. What NAJD imported or produced for you. Removing one deletes it from the library, not the original file on your computer.`) }}</p></div></header>
    <div v-if="library.failure.value" class="w-banner error">{{ library.failure.value }}</div>
    <label class="w-search"><input v-model="query" type="search" maxlength="120" data-library-search :placeholder="s('ابحث بالاسم', 'Search by name')" /></label>
    <p v-if="library.value.value && !items.length" class="pf-note" data-library-empty>{{ query.trim() ? s('لا عناصر مطابقة.', 'No matching items.') : s('المكتبة فارغة.', 'The library is empty.') }}</p>
    <div class="s-recall-list s-library-list"><div v-for="item in items" :key="item.id" class="w-row" data-library-item :data-kind="item.kind"><div><strong dir="auto">{{ item.name }}</strong>
      <small>{{ s(KIND[item.kind][0], KIND[item.kind][1]) }} · {{ size(item.size) }} · {{ date(item.createdAt) }}{{ item.origin === 'artifact' ? s(' · أنتجه نجد', ' · made by NAJD') : '' }}</small></div>
      <div class="w-row-end">
        <button v-if="item.origin === 'artifact' && item.source" type="button" class="w-icon" data-library-reveal :aria-label="s('إظهار في المجلد', 'Show in folder')" @click="host.najdLibrary!.reveal(item.id).catch(() => {})"><FolderOpen :size="16" /></button>
        <button type="button" :class="['w-btn', confirming === item.id ? 'danger' : 'w-icon']" data-library-remove :aria-label="s('حذف من المكتبة', 'Remove from the library')" :disabled="library.busy.value" @click="remove(item)"><Trash2 v-if="confirming !== item.id" :size="16" /><template v-else>{{ s('تأكيد الحذف', 'Confirm removal') }}</template></button></div></div></div>
  </section>
</template>
