<script setup lang="ts">
// Files a reply produced or names (owner request 2026-11-10): one card each, with Preview inside NAJD, Open in its app,
// Show in Explorer and Copy path. Recorded outputs use the conversation's output rules; other paths only work inside the NAJD workspace.
import { computed, ref } from 'vue'
import { Check, Copy, ExternalLink, Eye, File, FileCode, FileImage, FileSpreadsheet, FileText, FolderOpen, Presentation } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import { extensionOf, fileName } from '../lib/filePaths'

export type FileCard = { path: string; name?: string; output: boolean }
const props = defineProps<{ files: FileCard[]; conversationId: string | null }>()
const emit = defineEmits<{ open: [item: { title: string; language: string; source: string }] }>()
const { s } = usePrefs()
const copied = ref<string | null>(null), failed = ref<string | null>(null)
const cards = computed(() => props.files.map(file => ({ ...file, name: file.name || fileName(file.path), ext: extensionOf(file.path) })))

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const SHEET = new Set(['xlsx', 'xls', 'csv', 'tsv'])
const CODE = new Set(['js', 'ts', 'py', 'json', 'html', 'htm', 'css', 'ps1', 'sh', 'vue', 'cs', 'java', 'go', 'rs', 'sql', 'xml', 'yaml', 'yml'])
const SLIDES = new Set(['pptx', 'ppt'])
// Types NAJD can show itself (text, code, pages, pictures, and Office/PDF as extracted text); others open in their own app on purpose.
const PREVIEWABLE = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'html', 'htm', 'svg', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ps1', 'sh', 'bat', 'cmd', 'css', 'sql', 'java', 'cs', 'go', 'rs', 'rb', 'php', 'c', 'h', 'cpp', 'vue',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'docx', 'xlsx', 'pptx', 'pdf'])
const canPreview = (ext: string) => PREVIEWABLE.has(ext)
const icon = (ext: string) => IMAGE.has(ext) ? FileImage : SHEET.has(ext) ? FileSpreadsheet : CODE.has(ext) ? FileCode : SLIDES.has(ext) ? Presentation : ['md', 'txt', 'docx', 'doc', 'pdf', 'log'].includes(ext) ? FileText : File

function flash(path: string) { failed.value = path; setTimeout(() => { if (failed.value === path) failed.value = null }, 2500) }
async function act(card: FileCard, mode: 'open' | 'reveal') {
  try {
    const ok = card.output && props.conversationId ? await window.najdAgent?.openOutput?.(props.conversationId, card.path, mode)
      : (await window.najdSessions?.openFile?.({ path: card.path, mode }))?.opened
    if (!ok) flash(card.path)
  } catch { flash(card.path) }
}
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)
async function preview(card: FileCard) {
  try {
    const result = card.output && props.conversationId ? await window.najdAgent?.previewOutput?.(props.conversationId, card.path) : await window.najdSessions?.previewFile?.({ path: card.path })
    if (!result) return flash(card.path)
    // Pictures and pages show in the workbench's sandboxed page view; text (and Office/PDF text) in its code view. A file NAJD cannot
    // read is never opened in another program from Preview: the card says so, and "Open in its app" stays the owner's own click.
    if (result.kind === 'image') emit('open', { title: result.name, language: 'html', source: `<img src="${result.dataUrl}" alt="${escapeHtml(result.name)}" style="max-width:100%;height:auto;display:block;margin:auto">` })
    else if (result.kind === 'text') emit('open', { title: result.name, language: result.language,
      source: (result.extracted ? s('[نص مستخرج للمعاينة؛ افتحه بالبرنامج لرؤية التنسيق]', '[Text extracted for preview; open it in its app to see the layout]') + '\n\n' : '') + (result.truncated ? result.text + '\n\n… (preview limited to the first 512 KB)' : result.text) })
    else flash(card.path)
  } catch { flash(card.path) }
}
function copyPath(path: string) { void navigator.clipboard.writeText(path).then(() => { copied.value = path; setTimeout(() => { if (copied.value === path) copied.value = null }, 1500) }) }
</script>

<template>
  <ul v-if="cards.length" class="c-files" data-file-cards>
    <li v-for="card in cards" :key="card.path" class="c-filecard" :data-failed="failed === card.path || undefined">
      <button type="button" class="c-filecard-main" :title="card.path" @click="canPreview(card.ext) ? preview(card) : act(card, 'open')"><component :is="icon(card.ext)" :size="18" /><span class="c-filecard-text"><bdi dir="auto">{{ card.name }}</bdi><small dir="ltr">{{ failed === card.path ? s('تعذّر فتح الملف', 'Could not open this file') : (card.ext.toUpperCase() || s('ملف', 'File')) }}</small></span></button>
      <span class="c-filecard-actions">
        <button v-if="canPreview(card.ext)" type="button" class="w-icon" :aria-label="s('معاينة داخل نجد', 'Preview in NAJD')" :title="s('معاينة داخل نجد', 'Preview in NAJD')" @click="preview(card)"><Eye :size="15" /></button>
        <button type="button" class="w-icon" :aria-label="s('فتح بالبرنامج', 'Open in its app')" :title="s('فتح بالبرنامج', 'Open in its app')" @click="act(card, 'open')"><ExternalLink :size="15" /></button>
        <button type="button" class="w-icon" :aria-label="s('عرض في مستكشف الملفات', 'Show in File Explorer')" :title="s('عرض في مستكشف الملفات', 'Show in File Explorer')" @click="act(card, 'reveal')"><FolderOpen :size="15" /></button>
        <button type="button" class="w-icon" :aria-label="s('نسخ المسار', 'Copy path')" :title="s('نسخ المسار', 'Copy path')" @click="copyPath(card.path)"><component :is="copied === card.path ? Check : Copy" :size="15" /></button>
      </span>
    </li>
  </ul>
</template>
