<script setup lang="ts">
// A project: its instructions, folder and conversations. With no project chosen, it creates one.
import { computed, onMounted, ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import { confirmAction } from '../composables/useConfirm'
import type { Conversation } from '../composables/useConversation'

const props = defineProps<{ chat: Conversation; projectId: string | null }>()
const emit = defineEmits<{ openChat: [id: string]; close: []; created: [id: string] }>()
const { s } = usePrefs()
const api = () => window.najdProjects!
const project = computed(() => props.chat.projects.value.find(item => item.id === props.projectId) || null)
const instructions = ref(project.value?.instructions || ''), failure = ref(false), name = ref('')
watch(() => project.value?.id, () => { instructions.value = project.value?.instructions || '' })
const conversations = computed(() => project.value ? props.chat.sessions.value.filter(item => project.value!.chats.includes(item.id)) : [])
// Project files: library items attached to the project; NAJD adds them to every conversation in it (up to 20, the limit of one request).
const library = ref<NajdAsset[]>([])
const loadLibrary = async () => { try { library.value = await window.najdLibrary?.list() || [] } catch { library.value = [] } }
onMounted(() => { void loadLibrary() })
const attachable = computed(() => library.value.filter(item => !(project.value?.files || []).some(file => file.id === item.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const setFiles = (ids: string[]) => run(async () => { await api().setFiles(project.value!.id, ids.slice(0, 20)); await loadLibrary() })
const addFromLibrary = (id: string) => { if (id) void setFiles([...(project.value?.files || []).map(file => file.id), id]) }
const addNew = () => run(async () => { const added = await window.najdLibrary!.import(); if (added.length) await api().setFiles(project.value!.id, [...new Set([...(project.value?.files || []).map(file => file.id), ...added.map(item => item.id)])].slice(0, 20)); await loadLibrary() })
const removeFile = (id: string) => setFiles((project.value?.files || []).map(file => file.id).filter(item => item !== id))
async function run(work: () => Promise<unknown>) { failure.value = false; try { await work(); await props.chat.refreshProjects() } catch { failure.value = true } }
function startTask() { if (!project.value) return; props.chat.newTask(project.value.id); emit('close') }
async function remove() { const current = project.value; if (current && await confirmAction(s('حذف المشروع؟ تبقى المحادثات.', 'Delete the project? Its conversations stay.'), s('حذف', 'Delete'))) void run(() => api().remove(current.id)).then(() => emit('close')) }
function create() { const value = name.value.trim(); if (!value) return; void run(async () => { const made = await api().save({ name: value, instructions: '' }); name.value = ''; await props.chat.refreshProjects(); emit('created', made.id) }) }
</script>

<template>
  <div class="w-page" data-project>
    <template v-if="!project">
      <header class="w-page-head"><div><h1>{{ s('مشروع جديد', 'New project') }}</h1><p>{{ s('يجمع المشروع محادثاته وتعليماته ومجلده.', 'A project keeps its conversations, instructions and folder together.') }}</p></div></header>
      <div v-if="failure" class="w-banner error">{{ s('تعذر الحفظ.', 'Could not save.') }}</div>
      <label class="w-field"><span>{{ s('الاسم', 'Name') }}</span><input v-model="name" maxlength="80" dir="auto" data-project="name" @keydown.enter="create" /></label>
      <button type="button" class="w-btn primary" :disabled="!name.trim()" data-project="create" @click="create">{{ s('إنشاء', 'Create') }}</button>
    </template>
    <template v-else>
      <header class="w-page-head"><div><h1 dir="auto">{{ project.name }}</h1></div><div class="w-page-actions">
        <button type="button" class="w-btn primary" @click="startTask"><Plus :size="15" />{{ s('مهمة في المشروع', 'Task in this project') }}</button>
        <button type="button" class="w-btn danger" @click="remove"><Trash2 :size="15" />{{ s('حذف', 'Delete') }}</button></div></header>
      <div v-if="failure" class="w-banner error">{{ s('تعذر الحفظ.', 'Could not save.') }}</div>
      <section class="w-section"><header><div><h3>{{ s('تعليمات المشروع', 'Project instructions') }}</h3></div></header>
        <label class="w-field"><span>{{ s('التعليمات', 'Instructions') }}</span><textarea v-model="instructions" rows="5" dir="auto" /></label>
        <button type="button" class="w-btn" :disabled="instructions === project.instructions" @click="run(() => api().save({ id: project!.id, name: project!.name, instructions }))">{{ s('حفظ', 'Save') }}</button></section>
      <section class="w-section"><header><div><h3>{{ s('المجلد', 'Folder') }}</h3></div></header>
        <div class="w-row"><div><strong>{{ project.folder || s('بدون مجلد', 'No folder') }}</strong></div><div class="w-row-end"><button type="button" class="w-btn" @click="run(() => api().chooseFolder(project!.id))">{{ s('اختيار', 'Choose') }}</button>
          <button v-if="project.folder" type="button" class="w-btn" @click="run(() => api().clearFolder(project!.id))">{{ s('إزالة', 'Remove') }}</button></div></div></section>
      <section class="w-section" data-project-files><header><div><h3>{{ s('ملفات المشروع', 'Project files') }}</h3><p>{{ s('تُرفق تلقائياً بكل محادثة في هذا المشروع.', 'Attached automatically to every conversation in this project.') }}</p></div></header>
        <small v-if="!project.files.length" data-project-files-empty>{{ s('لا ملفات بعد.', 'No files yet.') }}</small>
        <div v-for="file in project.files" :key="file.id" class="w-row" data-project-file><div><strong dir="auto">{{ file.name }}</strong></div><button type="button" class="w-icon" data-project-file-remove :aria-label="s('إزالة من المشروع', 'Remove from the project')" @click="removeFile(file.id)"><Trash2 :size="15" /></button></div>
        <div class="w-row-end"><button type="button" class="w-btn" data-project-file-add :disabled="project.files.length >= 20" @click="addNew">{{ s('إضافة ملفات', 'Add files') }}</button>
          <select v-if="attachable.length" class="w-select" data-project-file-library :disabled="project.files.length >= 20" :aria-label="s('من المكتبة', 'From the library')" @change="event => { addFromLibrary((event.target as HTMLSelectElement).value); (event.target as HTMLSelectElement).value = '' }"><option value="">{{ s('من المكتبة…', 'From the library…') }}</option><option v-for="item in attachable" :key="item.id" :value="item.id">{{ item.name }}</option></select></div></section>
      <section class="w-section"><header><div><h3>{{ s('المحادثات', 'Conversations') }}</h3></div></header>
        <small v-if="!conversations.length">{{ s('لا توجد محادثات بعد.', 'No conversations yet.') }}</small>
        <div v-for="item in conversations" :key="item.id" class="w-row"><div><strong dir="auto">{{ item.title || s('مهمة', 'Task') }}</strong></div><button type="button" class="w-btn" @click="emit('openChat', item.id)">{{ s('فتح', 'Open') }}</button></div></section>
    </template>
  </div>
</template>
