<script setup lang="ts">
// Dashboards: start from a template, edit widgets, save to a project. Stored by the main process (electron/workstation/documents.cjs).
import { computed, onMounted, ref } from 'vue'
import { LayoutDashboard, Maximize2, Trash2 } from 'lucide-vue-next'
import MessageBody from './MessageBody.vue'
import { plain } from '../lib/plain'
import { usePrefs } from '../composables/usePrefs'
import { confirmAction } from '../composables/useConfirm'
import type { Widget, WorkstationDocument } from '../../workstation/types'

const props = defineProps<{ documentId?: string; projects: NajdProject[]; inWorkbench?: boolean }>()
const emit = defineEmits<{ openTab: [document: WorkstationDocument] }>()
const { s, prefs } = usePrefs()
const ar = computed(() => prefs.language === 'ar')
const items = ref<WorkstationDocument[] | null>(null), active = ref<string | null>(props.documentId || null), editing = ref(false), failure = ref(false)
const w = (type: Widget['type'], title: string, value: string, column: Widget['column']): Widget => ({ id: crypto.randomUUID(), type, title, value, column })
const chart = (labels: string[]) => '```chart\n' + JSON.stringify({ type: 'bar', labels, series: [{ name: 'Value', values: labels.map(() => 0) }] }) + '\n```'
const TEMPLATES = [
  { id: 'finance', ar: 'المالية', en: 'Finance', widgets: () => [w('metric', 'Revenue', '0', 1), w('metric', 'Expenses', '0', 2), w('metric', 'Cash', '0', 3), w('chart', 'Monthly', chart(['Jan', 'Feb', 'Mar']), 1)] },
  { id: 'bi', ar: 'ذكاء الأعمال', en: 'Business intelligence', widgets: () => [w('metric', 'KPI', '0', 1), w('chart', 'Trend', chart(['Q1', 'Q2', 'Q3', 'Q4']), 2), w('note', 'Insights', '', 3)] },
  { id: 'projects', ar: 'المشاريع', en: 'Projects', widgets: () => [w('list', 'To do', '', 1), w('list', 'In progress', '', 2), w('list', 'Done', '', 3)] },
  { id: 'daily', ar: 'الموجز اليومي', en: 'Daily brief', widgets: () => [w('note', 'Today', '', 1), w('list', 'Priorities', '', 2), w('note', 'Notes', '', 3)] },
  { id: 'personal', ar: 'المتابعة الشخصية', en: 'Personal tracking', widgets: () => [w('metric', 'Goal', '0', 1), w('list', 'Habits', '', 2), w('chart', 'Week', chart(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 3)] },
  { id: 'custom', ar: 'مخصصة', en: 'Custom', widgets: () => [] as Widget[] }
]
async function load() { try { const list = await window.najdWorkstation!.documents('dashboard'); items.value = list; if (!active.value || !list.some(item => item.id === active.value)) active.value = list[0]?.id ?? null } catch { failure.value = true; items.value = [] } }
onMounted(load)
const current = computed(() => items.value?.find(item => item.id === active.value) || null)
async function save(document: WorkstationDocument) { items.value = (items.value || []).map(item => item.id === document.id ? document : item); try { await window.najdWorkstation!.documentSave(plain(document)) } catch { failure.value = true } }
async function create(template: typeof TEMPLATES[number]) { try { const made = await window.najdWorkstation!.documentSave({ id: crypto.randomUUID(), kind: 'dashboard', title: ar.value ? template.ar : template.en, template: template.id, widgets: template.widgets() }); await load(); active.value = made.id; editing.value = template.id === 'custom' } catch { failure.value = true } }
async function remove() { if (current.value && await confirmAction(s('حذف هذه اللوحة؟', 'Delete this board?'), s('حذف', 'Delete'))) { await window.najdWorkstation!.documentRemove(current.value.id); await load() } }
const update = (patch: Partial<WorkstationDocument>) => { if (current.value) void save({ ...current.value, ...patch }) }
const updateWidget = (next: Widget) => update({ widgets: current.value!.widgets.map(item => item.id === next.id ? next : item) })
</script>

<template>
  <div class="w-page">
    <header class="w-page-head"><div><h1>{{ s('لوحات البيانات', 'Dashboard') }}</h1><p>{{ s('ابدأ من قالب، وعدل الودجت، واحفظ اللوحة في مشروع.', 'Start from a template, edit the widgets and save the board to a project.') }}</p></div>
      <div v-if="current" class="w-page-actions"><button type="button" class="w-btn" data-dashboard="edit" @click="editing = !editing">{{ editing ? s('انتهيت', 'Done') : s('تعديل', 'Edit') }}</button>
        <button v-if="editing" type="button" class="w-btn" @click="update({ widgets: [...current.widgets, w('note', s('ودجت', 'Widget'), '', 1)] })">+ {{ s('ودجت', 'Widget') }}</button>
        <select class="w-select" :aria-label="s('حفظ في مشروع', 'Save to project')" :value="current.projectId || ''" @change="event => update({ projectId: (event.target as HTMLSelectElement).value || null })"><option value="">{{ s('بدون مشروع', 'No project') }}</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select>
        <button v-if="!inWorkbench && current" type="button" class="w-icon" :aria-label="s('فتح في مساحة العمل', 'Open in the workbench')" @click="emit('openTab', current!)"><Maximize2 :size="16" /></button>
        <button type="button" class="w-icon" :aria-label="s('حذف', 'Delete')" @click="remove"><Trash2 :size="16" /></button></div></header>
    <div v-if="failure" class="w-banner error">{{ s('تعذر حفظ اللوحة.', 'The board could not be saved.') }}</div>
    <template v-if="items">
      <template v-if="items.length">
        <div class="w-tabs" role="tablist"><button v-for="item in items" :key="item.id" type="button" role="tab" :aria-selected="active === item.id" :class="{ on: active === item.id }" @click="active = item.id">{{ item.title }}</button></div>
        <template v-if="current">
          <label v-if="editing" class="w-field"><span>{{ s('الاسم', 'Name') }}</span><input :value="current.title" dir="auto" @change="event => update({ title: (event.target as HTMLInputElement).value || current!.title })" /></label>
          <div class="d-grid" data-dashboard="grid"><div v-for="column in [1, 2, 3]" :key="column">
            <template v-for="widget in current.widgets.filter(item => item.column === column)" :key="widget.id">
              <div v-if="editing" class="d-widget edit"><input :aria-label="s('العنوان', 'Title')" :value="widget.title" dir="auto" @change="event => updateWidget({ ...widget, title: (event.target as HTMLInputElement).value })" />
                <textarea :aria-label="s('المحتوى', 'Content')" :rows="widget.type === 'metric' ? 1 : 4" :value="widget.value" dir="auto" @change="event => updateWidget({ ...widget, value: (event.target as HTMLTextAreaElement).value })" />
                <div><select class="w-select" :aria-label="s('العمود', 'Column')" :value="widget.column" @change="event => updateWidget({ ...widget, column: Number((event.target as HTMLSelectElement).value) as Widget['column'] })"><option v-for="value in [1, 2, 3]" :key="value" :value="value">{{ value }}</option></select>
                  <button type="button" class="w-icon" :aria-label="s('حذف', 'Delete')" @click="update({ widgets: current.widgets.filter(item => item.id !== widget.id) })"><Trash2 :size="16" /></button></div></div>
              <div v-else :class="['d-widget', widget.type]"><h3 dir="auto">{{ widget.title }}</h3><strong v-if="widget.type === 'metric'" dir="auto">{{ widget.value }}</strong>
                <ul v-else-if="widget.type === 'list'"><li v-for="(line, index) in widget.value.split('\n').filter(Boolean)" :key="index" dir="auto">{{ line }}</li></ul>
                <MessageBody v-else :text="widget.value" /></div>
            </template></div></div>
        </template>
        <h2 class="d-more">{{ s('قالب جديد', 'New from a template') }}</h2>
      </template>
      <div v-else class="w-empty"><LayoutDashboard :size="26" /><strong>{{ s('لا توجد لوحات بعد', 'No boards yet') }}</strong><p>{{ s('اختر قالبًا للبدء.', 'Choose a template to start.') }}</p></div>
      <div class="d-gallery"><button v-for="template in TEMPLATES" :key="template.id" type="button" class="d-template" :data-template="template.id" @click="create(template)"><LayoutDashboard :size="18" /><strong>{{ ar ? template.ar : template.en }}</strong><small>{{ template.widgets().length || '+' }}</small></button></div>
    </template>
    <div v-else class="w-skeleton"><i /><i /><i /></div>
  </div>
</template>
