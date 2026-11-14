<script setup lang="ts">
// The left rail of the workstation (reference screenshots 12–13), in Vue. Every entry routes or acts; nothing is decorative.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AppWindow, CalendarClock, ChevronDown, CirclePlus, FolderOpen, FolderPlus, LayoutDashboard, MessageCircle, Monitor, PanelLeftClose, PanelLeftOpen, Pencil, Pin, PinOff, Puzzle, Search, Languages, Settings2, Smartphone, Trash2, UserRound } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import logoUrl from '../../assets/najd-logo.png' // NAJD's gray emblem (build/icon.png), shown as the account avatar
import { confirmAction } from '../composables/useConfirm'
import CommunityCard from './CommunityCard.vue'
import type { Route, SettingsRoute } from '../../workstation/types'
import { loadPinned, savePinned, togglePinned, withPinnedFirst } from '../../workstation/pinned'

const props = defineProps<{ route: Route; sessions: NajdSessionSummary[]; projects: NajdProject[]; activeSessionId: string | null; locked: boolean; plan: string; collapsed: boolean }>()
const emit = defineEmits<{ go: [route: Route]; newTask: []; openChat: [id: string]; deleteChat: [id: string]; renamed: []; openProject: [id: string]; newProject: []; apps: []; settings: [route: SettingsRoute]; toggle: [] }>()
const { prefs, s, change } = usePrefs()
const open = ref({ projects: true, tasks: true })
const searching = ref(false), query = ref(''), results = ref<(NajdSessionSummary & { snippet?: string })[] | null>(null), account = ref(false), accountBox = ref<HTMLElement | null>(null)
// Searching reads the saved conversations' text in the main process, not only their titles.
let timer: ReturnType<typeof setTimeout> | undefined, ticket = 0
watch(query, value => { clearTimeout(timer); const text = value.trim(), mine = ++ticket; if (!text || !window.najdSessions) { results.value = null; return } timer = setTimeout(() => { void window.najdSessions!.search(text).then(list => { if (mine === ticket) results.value = list }).catch(() => { if (mine === ticket) results.value = [] }) }, 200) })
const outside = (event: PointerEvent) => { if (account.value && event.target instanceof Node && !accountBox.value?.contains(event.target)) account.value = false }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); clearTimeout(timer) })
function pick(next: () => void) { account.value = false; next() }
// Deleting asks first; the main process refuses a conversation with a running task.
async function remove(item: NajdSessionSummary) { if (await confirmAction(s('حذف هذه المحادثة؟', 'Delete this conversation?'), s('حذف', 'Delete'))) emit('deleteChat', item.id) }
const work = computed(() => prefs.mode === 'work')
const inProjects = computed(() => new Set(props.projects.flatMap(project => project.chats)))
// Pinned conversations stay on top (workstation/pinned.ts); a search shows results in their own order.
const pinned = ref<string[]>(loadPinned(localStorage))
// Rename in place (double-click or the pencil): Enter saves, Esc cancels; the list reloads from the main process.
const renaming = ref<string | null>(null), newTitle = ref('')
function startRename(item: { id: string; title?: string }) { renaming.value = item.id; newTitle.value = item.title || ''; void nextTick(() => (document.querySelector('[data-rename-input]') as HTMLInputElement | null)?.select()) }
async function saveRename() {
  const id = renaming.value, title = newTitle.value.trim()
  renaming.value = null
  if (!id || !title || !window.najdSessions?.rename) return
  try { await window.najdSessions.rename(id, title); emit('renamed') } catch { /* an invalid title keeps the old one */ }
}
function togglePin(id: string) { pinned.value = togglePinned(pinned.value, id); savePinned(localStorage, pinned.value) }
const shown = computed(() => { const list = (results.value ?? props.sessions).filter(item => !work.value || results.value !== null || !inProjects.value.has(item.id) || pinned.value.includes(item.id)); return results.value ? list : withPinnedFirst(list, pinned.value) })
const nav = computed(() => [
  ...(work.value ? [{ id: 'dashboard' as Route, label: s('لوحة التحكم', 'Dashboard'), icon: LayoutDashboard }] : []),
  { id: 'skills-plugins' as Route, label: s('الإضافات', 'Plugins'), icon: Puzzle },
  ...(work.value ? [{ id: 'task-center' as Route, label: s('مركز المهام', 'Task center'), icon: CalendarClock }, { id: 'remote-control' as Route, label: s('التحكم عن بعد', 'Remote control'), icon: Smartphone }] : [])
])
</script>

<template>
  <nav class="n-rail" :data-collapsed="collapsed" :aria-label="s('التنقل الرئيسي', 'Main navigation')" :dir="prefs.language === 'ar' ? 'rtl' : 'ltr'" :style="collapsed ? undefined : { width: prefs.railWidth + 'px' }">
    <div class="n-top">
      <button type="button" class="w-icon" :aria-label="collapsed ? s('فتح الشريط', 'Open the rail') : s('طي الشريط', 'Collapse the rail')" @click="emit('toggle')">
        <component :is="collapsed ? PanelLeftOpen : PanelLeftClose" :size="16" />
      </button>
    </div>
    <div v-if="!collapsed" class="n-mode" role="radiogroup" :aria-label="s('الوضع', 'Mode')">
      <button type="button" role="radio" :aria-checked="prefs.mode === 'work'" :class="{ on: prefs.mode === 'work' }" @click="change({ mode: 'work' })"><Monitor :size="15" />Work</button>
      <button type="button" role="radio" :aria-checked="prefs.mode === 'chat'" :class="{ on: prefs.mode === 'chat' }" @click="change({ mode: 'chat' })"><MessageCircle :size="15" />Chat</button>
    </div>
    <button type="button" class="n-new" :disabled="locked" data-nav="new" @click="emit('newTask')"><CirclePlus :size="17" /><span>{{ work ? s('مهمة جديدة', 'New task') : s('محادثة جديدة', 'New chat') }}</span><kbd dir="ltr">Ctrl</kbd><kbd dir="ltr">K</kbd></button>
    <button v-for="item in nav" :key="item.id" type="button" :class="['n-item', { on: route === item.id }]" :aria-current="route === item.id ? 'page' : undefined" :data-nav="item.id" @click="emit('go', item.id)"><component :is="item.icon" :size="17" :stroke-width="1.7" /><span>{{ item.label }}</span></button>
    <button v-if="work" type="button" class="n-item" data-nav="apps" @click="emit('apps')"><AppWindow :size="17" :stroke-width="1.7" /><span>{{ s('التطبيقات', 'Apps') }}</span><em class="n-beta">{{ s('تجريبي', 'Beta') }}</em></button>
    <div v-if="!collapsed" class="n-scroll">
      <template v-if="work">
        <button type="button" class="n-label" :aria-expanded="open.projects" @click="open.projects = !open.projects"><span>{{ s('مشروع', 'Projects') }}</span><ChevronDown :size="13" :data-open="open.projects" /><span class="w-grow" />
          <span role="button" tabindex="0" class="n-label-act" :aria-label="s('مشروع جديد', 'New project')" @click.stop="emit('newProject')" @keydown.enter.stop="emit('newProject')"><FolderPlus :size="14" /></span></button>
        <template v-if="open.projects">
          <div v-for="project in projects" :key="project.id" class="n-group">
            <button type="button" :class="['n-row', { on: route === 'project' }]" @click="emit('openProject', project.id)"><FolderOpen :size="15" /><bdi>{{ project.name }}</bdi></button>
            <button v-for="session in sessions.filter(item => project.chats.includes(item.id)).slice(0, 5)" :key="session.id" type="button" :class="['n-row sub', { on: activeSessionId === session.id }]" :disabled="locked" @click="emit('openChat', session.id)"><bdi>{{ session.title || s('مهمة', 'Task') }}</bdi></button>
          </div>
        </template>
      </template>
      <button type="button" class="n-label" :aria-expanded="open.tasks" @click="open.tasks = !open.tasks"><span>{{ work ? s('المهام', 'Tasks') : s('المحادثات', 'Chats') }}</span><ChevronDown :size="13" :data-open="open.tasks" /><span class="w-grow" />
        <span role="button" tabindex="0" class="n-label-act" :aria-label="s('بحث', 'Search')" @click.stop="searching = !searching" @keydown.enter.stop="searching = !searching"><Search :size="14" /></span></button>
      <label v-if="searching" class="w-search"><Search :size="15" /><input v-model="query" type="search" maxlength="120" :placeholder="s('ابحث في المحادثات', 'Search conversations')" /></label>
      <template v-if="open.tasks">
        <div v-for="item in shown" :key="item.id" :class="['n-session', { on: activeSessionId === item.id }]"><input v-if="renaming === item.id" v-model="newTitle" class="n-rename" data-rename-input maxlength="60" dir="auto" :aria-label="s('اسم المحادثة', 'Conversation name')" @keydown.enter.prevent="saveRename" @keydown.esc.stop="renaming = null" @blur="saveRename" />
          <button v-else type="button" class="n-row" :disabled="locked" :aria-current="activeSessionId === item.id ? 'page' : undefined" @click="emit('openChat', item.id)" @dblclick="startRename(item)"><bdi>{{ item.title || s('مهمة', 'Task') }}</bdi><small v-if="'snippet' in item && item.snippet" class="n-snippet" dir="auto">{{ item.snippet }}</small></button>
          <button type="button" class="w-icon n-edit" :title="s('إعادة تسمية', 'Rename')" :aria-label="s('إعادة تسمية ', 'Rename ') + (item.title || '')" data-session-rename @click="startRename(item)"><Pencil :size="13" :stroke-width="1.8" /></button>
          <button type="button" :class="['w-icon', 'n-pin', { pinned: pinned.includes(item.id) }]" :title="pinned.includes(item.id) ? s('إلغاء التثبيت', 'Unpin') : s('تثبيت في الأعلى', 'Pin to top')" :aria-label="(pinned.includes(item.id) ? s('إلغاء تثبيت ', 'Unpin ') : s('تثبيت ', 'Pin ')) + (item.title || '')" :aria-pressed="pinned.includes(item.id)" data-session-pin @click="togglePin(item.id)"><component :is="pinned.includes(item.id) ? PinOff : Pin" :size="13" :stroke-width="1.8" /></button>
          <button type="button" class="w-icon" :title="s('حذف', 'Delete')" :aria-label="s('حذف ', 'Delete ') + (item.title || '')" :disabled="locked" data-session-delete @click="remove(item)"><Trash2 :size="13" :stroke-width="1.8" /></button></div>
        <small v-if="!shown.length" class="n-none">{{ query ? s('لا نتائج', 'No results') : s('لا توجد محادثات بعد', 'No conversations yet') }}</small>
      </template>
    </div>
    <span class="w-grow" />
    <CommunityCard :collapsed="collapsed" />
    <div ref="accountBox" class="w-menu-box" @keydown.esc.stop="account = false"><button type="button" class="n-account" data-nav="account" aria-haspopup="menu" :aria-expanded="account" @click="account = !account"><span class="n-avatar"><img :src="logoUrl" alt="" draggable="false" /></span><template v-if="!collapsed"><bdi>{{ prefs.displayName || 'NAJD' }}</bdi></template></button>
      <div v-if="account" class="w-menu start up" role="menu" :aria-label="s('الحساب', 'Account')">
        <button type="button" role="menuitem" class="w-menu-item" @click="pick(() => emit('go', 'profile'))"><UserRound :size="15" /><span>{{ s('الملف الشخصي', 'Profile') }}</span></button>
        <button type="button" role="menuitem" class="w-menu-item" @click="pick(() => emit('settings', 'account-security'))"><span>{{ s('الحساب والأمان', 'Account & Security') }}</span></button>
        <button type="button" role="menuitem" class="w-menu-item" @click="pick(() => emit('settings', 'models'))"><span>{{ s('النماذج', 'Models') }}</span></button>
        <button type="button" role="menuitem" class="w-menu-item" data-account-language @click="pick(() => change({ language: prefs.language === 'ar' ? 'en' : 'ar' }))"><Languages :size="15" /><span>{{ s('اللغة', 'Language') }}</span><span class="w-grow" /><small dir="auto">{{ prefs.language === 'ar' ? 'English' : 'العربية' }}</small></button>
        <button type="button" role="menuitem" class="w-menu-item" @click="pick(() => emit('settings', 'appearance'))"><Settings2 :size="15" /><span>{{ s('الإعدادات', 'Settings') }}</span></button></div></div>
  </nav>
</template>
