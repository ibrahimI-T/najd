<script setup lang="ts">
// The community corner at the bottom of the rail (owner request 2026-11-14): NAJD's Discord, the website and the maker's Discord name. The links
// are fixed in the main process (COMMUNITY_LINKS in electron/main.cjs) and opened in the owner's browser through najdLinks.open.
import { Globe } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'

defineProps<{ collapsed: boolean }>()
const { s } = usePrefs()
const host = window
const open = (name: 'community' | 'website' | 'author') => { void host.najdLinks?.open(name) }
// The Discord mark, drawn here (the icon set has no brand marks).
const DISCORD = 'M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8.5 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z'
</script>

<template>
  <div v-if="!collapsed" class="cm-card" data-community>
    <button type="button" class="cm-join" data-community-join @click="open('community')">
      <span class="cm-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path :d="DISCORD" fill="currentColor" /></svg></span>
      <span class="cm-text"><strong>{{ s('انضم للمجتمع', 'Join the community') }}</strong><small>{{ s('نجد على ديسكورد', 'NAJD on Discord') }}</small></span>
    </button>
    <div class="cm-row">
      <button type="button" class="cm-pill" data-community-site @click="open('website')"><Globe :size="14" /><bdi dir="ltr">najdagent.si</bdi></button>
      <button type="button" class="cm-pill" data-community-author @click="open('author')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path :d="DISCORD" fill="currentColor" /></svg><span class="cm-by"><small>{{ s('صنع بواسطة', 'Made by') }}</small><bdi dir="ltr">@fm.1</bdi></span></button>
    </div>
  </div>
  <div v-else class="cm-icons" data-community>
    <button type="button" class="w-icon" :aria-label="s('انضم لمجتمع نجد على ديسكورد', 'Join the NAJD community on Discord')" :title="s('مجتمع نجد', 'NAJD community')" data-community-join @click="open('community')"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path :d="DISCORD" fill="currentColor" /></svg></button>
    <button type="button" class="w-icon" aria-label="najdagent.si" title="najdagent.si" data-community-site @click="open('website')"><Globe :size="16" /></button>
  </div>
</template>
