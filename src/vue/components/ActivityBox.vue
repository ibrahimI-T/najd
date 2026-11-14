<script setup lang="ts">
// The steps NAJD took, from the real task events only (English, like the agent's own work). Open while running, folded when done.
import { computed, ref, watch } from 'vue'
import { ChevronDown, Square } from 'lucide-vue-next'
import { buildActivity, formatCompact, summarize, NOTE_KINDS, receiptOf, receiptText } from '../../activity'
import { usePrefs } from '../composables/usePrefs'
import type { WorkRun } from '../composables/useConversation'

const props = defineProps<{ run: WorkRun; canStop?: boolean }>()
const emit = defineEmits<{ stop: [] }>()
const view = computed(() => buildActivity(props.run.activity))
const live = computed(() => !props.run.finishedAt)
const open = ref(live.value)
watch(live, value => { open.value = value })
const steps = computed(() => view.value.rows.flatMap(row => row.type === 'event' ? [row.event] : row.group.items))
// The receipt of a finished run, in the owner's language: how many steps were confirmed, unconfirmed, failed or not done.
const { prefs } = usePrefs()
const receipt = computed(() => receiptOf(steps.value))
const receiptLine = computed(() => live.value ? '' : receiptText(receipt.value, prefs.language))
// Thinking and advice notes open in full on click, like the reference app's thought blocks (owner request 2026-11-10).
const expanded = ref(new Set<string>())
const isNote = (event: { kind: string; summary?: string }) => NOTE_KINDS.has(event.kind as never) && !!event.summary
function toggle(id: string) { const next = new Set(expanded.value); if (next.has(id)) next.delete(id); else next.add(id); expanded.value = next }
const mark = { running: '◌', succeeded: '✓', failed: '✕', cancelled: '–', 'awaiting-approval': '…', unconfirmed: '?' } as const
</script>

<template>
  <section v-if="steps.length || live" class="a-box" dir="ltr" lang="en" :data-activity="live ? 'running' : 'done'">
    <button type="button" class="a-head" :aria-expanded="open" @click="open = !open"><ChevronDown :size="14" :data-open="open" />
      <span>{{ live ? (view.waiting ? 'Waiting for your approval' : 'Working') : (summarize(view.counts, 'en') || 'Finished') }}</span>
      <time v-if="run.finishedAt">{{ formatCompact(run.finishedAt - run.startedAt, 'en') }}</time></button>
    <p v-if="receiptLine" :class="['a-receipt', { warn: receipt.unconfirmed || receipt.failed }]" :dir="prefs.language === 'ar' ? 'rtl' : 'ltr'" :lang="prefs.language" data-run-receipt>{{ receiptLine }}</p>
    <ol v-if="open" class="a-steps"><li v-for="event in steps" :key="event.id" :class="['a-step', event.status, { note: isNote(event), expanded: expanded.has(event.id) }]">
      <template v-if="isNote(event)"><button type="button" class="a-note-head" :aria-expanded="expanded.has(event.id)" @click="toggle(event.id)"><span aria-hidden="true">{{ mark[event.status] }}</span><strong dir="auto">{{ event.title }}</strong><small dir="auto">{{ event.summary }}</small><time v-if="event.durationMs !== undefined">{{ formatCompact(event.durationMs, 'en') }}</time><ChevronDown :size="12" :data-open="expanded.has(event.id)" /></button>
        <p v-if="expanded.has(event.id)" class="a-note-body" dir="auto">{{ event.summary }}</p></template>
      <template v-else><span aria-hidden="true">{{ mark[event.status] }}</span><strong dir="auto">{{ event.title }}</strong><small v-if="event.summary" dir="auto">{{ event.summary }}</small><time v-if="event.durationMs !== undefined">{{ formatCompact(event.durationMs, 'en') }}</time></template></li></ol>
    <button v-if="canStop && live" type="button" class="w-btn ghost" @click="emit('stop')"><Square :size="15" />Stop</button>
  </section>
</template>
