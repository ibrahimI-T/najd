<script setup lang="ts">
// One assistant reply: rendered Markdown (no raw HTML), code blocks with Copy, Open and Save, charts, and NAJD library pictures that open whole.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { blockExtension, renderMarkdown } from '../lib/markdown'
import { toast } from '../composables/useToast'
import { usePrefs } from '../composables/usePrefs'

const props = defineProps<{ text: string }>()
const emit = defineEmits<{ open: [item: { title: string; language: string; source: string }]; picture: [item: { id: string; src: string; name: string }] }>()
const root = ref<HTMLElement | null>(null)
const { s } = usePrefs()
const html = computed(() => renderMarkdown(props.text))

async function fillPictures() {
  await nextTick()
  for (const button of root.value?.querySelectorAll<HTMLButtonElement>('[data-library]') || []) {
    if (button.dataset.filled) continue
    button.dataset.filled = '1'
    const id = button.dataset.library!
    const url = await window.najdLibrary?.thumbnail(id).catch(() => null)
    if (url) { const image = document.createElement('img'); image.className = 'c-media'; image.src = url; image.alt = button.getAttribute('aria-label') || ''; button.replaceChildren(image) }
  }
}
onMounted(fillPictures)
watch(html, fillPictures)

function click(event: MouseEvent) {
  const target = event.target as HTMLElement
  const copy = target.closest<HTMLElement>('[data-copy]'), open = target.closest<HTMLElement>('[data-open]'), save = target.closest<HTMLElement>('[data-save]'), picture = target.closest<HTMLElement>('[data-library]'), link = target.closest<HTMLAnchorElement>('a[href^="file:///"]')
  // The block's source is stored HTML-escaped inside a text/plain script element (so a closing script tag in the code cannot end it); the browser
  // does not decode a script's text, so it is decoded here (a textarea decodes entities and runs nothing). Without this, Copy put "&lt;div&gt;" on the clipboard.
  const source = (id: string) => {
    const raw = root.value?.querySelector<HTMLElement>(`[data-source="${id}"]`)?.textContent || ''
    const area = document.createElement('textarea'); area.innerHTML = raw
    return area.value
  }
  if (copy) { void navigator.clipboard.writeText(source(copy.dataset.copy!)).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy' }, 1500) }) }
  else if (save) {
    // Save the block's source as a file through the normal save dialog (the dialog asks before replacing a file).
    const block = save.closest<HTMLElement>('[data-fence]'), fence = block?.dataset.fence || 'text'
    void window.najdSessions?.saveBlock({ text: source(save.dataset.save!), extension: blockExtension(fence), name: fence === 'text' ? 'najd' : fence }).then(result => { if (result.saved) toast(s('حُفظ الملف: ', 'Saved: ') + (result.name || ''), 'ok') }).catch(() => toast(s('تعذر حفظ الملف.', 'The file could not be saved.'), 'error'))
  }
  else if (open) { const block = open.closest<HTMLElement>('[data-fence]'); emit('open', { title: block?.dataset.fence || 'code', language: block?.dataset.fence || 'text', source: source(open.dataset.open!) }) }
  else if (picture) { const image = picture.querySelector('img'); if (image) emit('picture', { id: picture.dataset.library!, src: image.src, name: image.alt || 'image' }) }
  else if (link) { event.preventDefault(); void window.najdSessions?.openFile?.({ path: decodeURIComponent(link.href.replace(/^file:\/\/\//i, '')).replace(/\//g, '\\'), mode: 'open' }) }
}
</script>

<template>
  <div ref="root" class="c-body" dir="auto" @click="click" v-html="html" />
</template>
