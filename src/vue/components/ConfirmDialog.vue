<script setup lang="ts">
// The confirmation asked by confirmAction(): the question, Cancel, and the destructive action named on its button. Esc cancels.
import { nextTick, ref, watch } from 'vue'
import { answerConfirm, useConfirmState } from '../composables/useConfirm'
import { usePrefs } from '../composables/usePrefs'

const state = useConfirmState()
const { s } = usePrefs()
const cancelButton = ref<HTMLButtonElement | null>(null)
watch(() => state.pending, async value => { if (value) { await nextTick(); cancelButton.value?.focus() } })
</script>

<template>
  <div v-if="state.pending" class="w-scrim" @mousedown.self="answerConfirm(false)"><div class="w-dialog w-confirm" role="alertdialog" aria-modal="true" data-confirm-dialog @keydown.esc="answerConfirm(false)">
    <div class="w-dialog-body"><p dir="auto">{{ state.pending.text }}</p></div>
    <footer><button ref="cancelButton" type="button" class="w-btn" data-confirm="cancel" @click="answerConfirm(false)">{{ s('إلغاء', 'Cancel') }}</button>
      <button type="button" class="w-btn danger" data-confirm="ok" @click="answerConfirm(true)">{{ state.pending.action }}</button></footer>
  </div></div>
</template>
