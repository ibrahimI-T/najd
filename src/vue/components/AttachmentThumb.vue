<script setup lang="ts">
// One attached file (owner request 2026-11-10, screenshots of the reference composer): a picture shows as a small rounded thumbnail of
// the whole image, in the composer before sending and in the sent message; any other file stays a name chip. Click a sent picture to view it whole.
import { onMounted, ref, watch } from 'vue'
import { Paperclip, X } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'

const props = defineProps<{ id: string; name: string; kind?: string; removable?: boolean; size?: 'small' | 'large' }>()
const emit = defineEmits<{ remove: []; view: [item: { id: string; src: string; name: string }] }>()
const { s } = usePrefs()
const src = ref<string | null>(null)
const tried = ref(false)
async function load() {
  src.value = null; tried.value = false
  // Only pictures and videos have a thumbnail; documents skip the call.
  if (props.kind && !['image', 'video'].includes(props.kind)) { tried.value = true; return }
  try { src.value = await window.najdLibrary?.thumbnail(props.id) || null } catch { src.value = null } finally { tried.value = true }
}
onMounted(load)
watch(() => props.id, load)
</script>

<template>
  <span v-if="src" :class="['a-thumb', size || 'small']" :title="name" data-attachment-thumb>
    <button type="button" class="a-thumb-view" :aria-label="s('عرض الصورة ', 'View picture ') + name" @click="emit('view', { id, src: src!, name })"><img :src="src" :alt="name" /></button>
    <button v-if="removable" type="button" class="a-thumb-x" :aria-label="s('إزالة ', 'Remove ') + name" @click="emit('remove')"><X :size="12" /></button>
  </span>
  <span v-else-if="tried" class="k-file" :title="name"><Paperclip :size="13" /><bdi>{{ name }}</bdi>
    <button v-if="removable" type="button" :aria-label="s('إزالة ', 'Remove ') + name" @click="emit('remove')"><X :size="12" /></button></span>
  <span v-else :class="['a-thumb', 'loading', size || 'small']" aria-hidden="true" />
</template>
