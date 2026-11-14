<script setup lang="ts">
// The confirmations of useToast, at the bottom of the window; announced to screen readers.
import { X } from 'lucide-vue-next'
import { dismissToast, useToasts } from '../composables/useToast'
import { usePrefs } from '../composables/usePrefs'

const toasts = useToasts()
const { s } = usePrefs()
</script>

<template>
  <div class="w-toasts" role="status" aria-live="polite" data-toasts>
    <div v-for="item in toasts.items" :key="item.id" :class="['w-toast', item.tone]" :data-toast="item.tone"><span dir="auto">{{ item.text }}</span>
      <button type="button" class="w-icon" :aria-label="s('إغلاق', 'Close')" @click="dismissToast(item.id)"><X :size="14" /></button></div>
  </div>
</template>
