<script setup lang="ts">
// Every page outside the conversation, chosen by the rail.
import { computed } from 'vue'
import { usePrefs } from '../composables/usePrefs'
import type { Conversation } from '../composables/useConversation'
import type { ProviderState } from '../composables/useProviders'
import type { CatalogEntry, Route, SettingsRoute } from '../../workstation/types'
import type { WorkbenchTab } from '../../workstation/workbenchState'
import DashboardView from './DashboardView.vue'
import HubView from './HubView.vue'
import TaskCenterView from './TaskCenterView.vue'
import RemoteView from './RemoteView.vue'
import ProjectView from './ProjectView.vue'
import ProfileView from './ProfileView.vue'
import SettingsView from './SettingsView.vue'

const props = defineProps<{ route: Route; chat: Conversation; providers: ProviderState; settingsRoute: SettingsRoute; projectId: string | null; taskSeed: string | null }>()
const emit = defineEmits<{ settingsRoute: [route: SettingsRoute]; openChat: [id: string]; prompt: [text: string]; go: [route: Route]; openTab: [tab: WorkbenchTab]; project: [id: string] }>()
const { prefs } = usePrefs()
const ar = computed(() => prefs.language === 'ar')
// The skill's id goes with its name so the runtime gives the model that skill's guide (namedSkillRows matches ids).
function useSkill(entry: CatalogEntry) { const plugin = entry.kind === 'plugin'; emit('prompt', ar.value ? `استخدم ${plugin ? 'إضافة' : 'مهارة'} «${entry.i18n?.ar?.displayName || entry.displayName}» (${entry.id}) في: ` : `Use the ${plugin ? 'plugin' : 'skill'} "${entry.displayName}" (${entry.id}) for: `) }
</script>

<template>
  <div class="ws-route" :data-page="route">
    <DashboardView v-if="route === 'dashboard'" :projects="chat.projects.value" @open-tab="board => emit('openTab', { id: 'dashboard:' + board.id, kind: 'dashboard', title: board.title, documentId: board.id })" />
    <HubView v-else-if="route === 'skills-plugins'" @prompt="text => emit('prompt', text)" @use="useSkill" @settings="value => { emit('settingsRoute', value); emit('go', 'settings') }" @go="value => emit('go', value)" />
    <TaskCenterView v-else-if="route === 'task-center'" :providers="providers" :seed="taskSeed" @open-chat="id => emit('openChat', id)" @prompt="text => emit('prompt', text)" />
    <RemoteView v-else-if="route === 'remote-control'" />
    <ProjectView v-else-if="route === 'project'" :key="projectId || 'new'" :chat="chat" :project-id="projectId" @open-chat="id => emit('openChat', id)" @close="emit('go', 'home')" @created="id => emit('project', id)" />
    <ProfileView v-else-if="route === 'profile'" :sessions="chat.sessions.value" />
    <SettingsView v-else-if="route === 'settings'" :route="settingsRoute" :providers="providers" @route="value => emit('settingsRoute', value)" @open-chat="id => emit('openChat', id)" />
  </div>
</template>
