<script setup lang="ts">
// A draggable, keyboard-adjustable divider between the rail, the conversation and the workbench.
const props = defineProps<{ label: string; value: number; min: number; max: number; side: 'left' | 'right' }>()
const emit = defineEmits<{ change: [value: number] }>()
const clamp = (value: number) => Math.min(props.max, Math.max(props.min, value))
const sign = () => props.side === 'left' ? 1 : -1
function key(event: KeyboardEvent) { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); emit('change', clamp(props.value + (event.key === 'ArrowRight' ? 16 : -16) * sign())) }
function down(event: PointerEvent) {
  const start = event.clientX, from = props.value, target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const move = (next: PointerEvent) => emit('change', clamp(from + (next.clientX - start) * sign()))
  const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up) }
  target.addEventListener('pointermove', move); target.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="w-split" role="separator" aria-orientation="vertical" :aria-label="label" :aria-valuenow="value" :aria-valuemin="min" :aria-valuemax="max" tabindex="0" @keydown="key" @pointerdown="down" />
</template>
