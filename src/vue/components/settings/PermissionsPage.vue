<script setup lang="ts">
// Permissions & Control: Windows computer use, the linked browser extension(s), the built-in browser, the document pack, allowed folders.
import { computed, onMounted, ref } from 'vue'
import { usePrefs } from '../../composables/usePrefs'
import { useLoad } from '../../composables/useLoad'
import { extensionsConflict } from '../../lib/browserLinks'

const { s } = usePrefs()
const files = () => window.najdFiles!, host = window
const roots = useLoad(window.najdFiles?.listRoots), browser = useLoad(window.najdBrowser?.status), pack = useLoad(window.najdPack?.status), connector = useLoad(window.najdMcp?.list)
const code = ref<string | null>(null), whole = ref(false), activity = ref<NajdActivityEntry[]>([])
onMounted(() => {
  void window.najdFiles?.wholeComputer?.().then(item => { whole.value = item.wholeComputer }).catch(() => {})
  void window.najdFiles?.activity().then(list => { activity.value = [...list].reverse().slice(0, 50) }).catch(() => {})
})
const windowsMcp = computed(() => connector.value.value?.[0])
const links = computed(() => (browser.value.value?.links || []) as (NonNullable<NajdBrowserStatus['links']>[number] & { version?: string | null; latest?: string | null; outdated?: boolean })[])
function toggleWindows() { const item = windowsMcp.value; if (!item) return; void connector.run(() => item.state === 'connected' ? window.najdMcp!.disconnect(item.id) : window.najdMcp!.connect(item.id)) }
function setWhole() { void window.najdFiles?.wholeComputer?.(!whole.value).then(item => { whole.value = item.wholeComputer }) }
// The outdated-extension banner: NAJD cannot open a browser's own extensions page, so its address is copied for the owner to paste. From
// extension 2.9.0 the extension reloads itself after NAJD updates (src/self-update.js), so a browser on 2.9.0 or later never shows this again.
const copiedPage = ref('')
const extensionsPage = (name: string) => /edge/i.test(name) ? 'edge://extensions' : /brave/i.test(name) ? 'brave://extensions' : 'chrome://extensions'
function copyExtensionsPage(name: string) { const page = extensionsPage(name); void navigator.clipboard.writeText(page).then(() => { copiedPage.value = page; setTimeout(() => { if (copiedPage.value === page) copiedPage.value = '' }, 2000) }) }
function pairing() { void window.najdBrowser?.pairingCode().then(value => { code.value = value }) }
// A new code makes the one on screen useless: for when someone may have seen it before it was used (it is also replaced after each link).
function rotate() { void window.najdBrowser?.rotateCode().then(value => { code.value = value }) }
</script>

<template>
  <div v-if="roots.failure.value" class="w-banner error">{{ roots.failure.value }}</div>
  <section class="w-section"><header><div><h3>{{ s('استخدام حاسوب ويندوز', 'Windows computer use') }}</h3><p>{{ s('مكون ويندوز يراقب ويتصرف بموافقتك.', 'The Windows component observes and acts with your approval.') }}</p></div></header>
    <div class="w-row"><div><strong>{{ s('الحالة', 'State') }}</strong></div><div class="w-row-end"><span v-if="windowsMcp" :class="['w-badge', windowsMcp.state === 'connected' ? 'green' : '']">{{ windowsMcp.state }}</span><template v-else>—</template>
      <button v-if="windowsMcp" type="button" class="w-btn" @click="toggleWindows">{{ windowsMcp.state === 'connected' ? s('فصل', 'Disconnect') : s('اتصال', 'Connect') }}</button></div></div>
    <div class="w-row"><div><strong>{{ s('الوصول إلى الحاسوب كاملًا', 'Whole-computer access') }}</strong></div><button type="button" role="switch" :aria-checked="whole" :aria-label="s('الوصول إلى الحاسوب كاملًا', 'Whole-computer access')" :class="['w-toggle', { on: whole }]" @click="setWhole"><i /></button></div></section>
  <section class="w-section"><header><div><h3>{{ s('متصفحك', 'Your browser') }}</h3><p>{{ s('الربط مرة واحدة مع إضافة نجد.', 'Link once with the NAJD extension.') }}</p></div></header>
    <div class="w-row"><div><strong>{{ s('الحالة', 'State') }}</strong><small>{{ browser.value.value?.extensionPath }}</small></div><div class="w-row-end">
      <span :class="['w-badge', browser.value.value?.connected ? 'green' : browser.value.value?.paired ? 'orange' : '']">{{ browser.value.value?.connected ? s('متصل', 'Connected') : browser.value.value?.paired ? s('مربوط، غير متصل', 'Linked, not connected') : s('غير مربوط', 'Not linked') }}</span>
      <button type="button" class="w-btn" @click="pairing">{{ s('رمز الربط', 'Pairing code') }}</button></div></div>
    <div v-if="code" class="w-row-end"><code dir="ltr" data-pairing-code>{{ code }}</code><button type="button" class="w-btn" data-rotate-code @click="rotate">{{ s('رمز جديد', 'New code') }}</button><button type="button" class="w-btn" @click="code = null">{{ s('إخفاء', 'Hide') }}</button></div>
    <div v-if="extensionsConflict(links)" class="w-banner warn" data-extension-conflict>{{ s('أكثر من إضافة نجد متصلة الآن. عطّل الإصدار القديم (1.x) في صفحة إضافات المتصفح حتى لا تتعارض.', 'More than one NAJD extension is connected. Turn off the old 1.x extension in the browser so they do not conflict.') }}</div>
    <div v-for="link in links.filter(item => item.outdated)" :key="'old-' + link.id + (link.instance || '')" class="w-banner warn" data-extension-outdated><span>{{ s('الإضافة "' + link.name + '" في متصفحك على الإصدار ' + link.version + '، وإصدار نجد ' + link.latest + '. الصق ' + extensionsPage(link.name) + ' في شريط العنوان واضغط "إعادة تحميل" على إضافة نجد.', 'The "' + link.name + '" extension in your browser is ' + link.version + '; NAJD ships ' + link.latest + '. Paste ' + extensionsPage(link.name) + ' in the address bar and press Reload on the NAJD extension.') }}{{ /^2\./.test(link.latest || '') && !/^2\.[0-8]\./.test(link.latest || '') ? s(' هذه آخر مرة: من الإصدار 2.9.0 تحدّث الإضافة نفسها بعد تحديثات نجد.', ' This is the last time: from 2.9.0 the extension updates itself after NAJD updates.') : '' }}</span>
      <button type="button" class="w-btn" data-copy-extensions-page @click="copyExtensionsPage(link.name)">{{ copiedPage === extensionsPage(link.name) ? s('نُسخ', 'Copied') : s('انسخ ' + extensionsPage(link.name), 'Copy ' + extensionsPage(link.name)) }}</button></div>
    <div v-for="link in links" :key="link.id + (link.instance || '')" class="w-row"><div><strong>{{ link.name + (link.version ? ' · ' + link.version : '') }}</strong><small>{{ link.connected ? s('متصلة', 'Connected') : s('غير متصلة', 'Not connected') }}</small></div>
      <button type="button" class="w-btn danger" @click="browser.run(() => host.najdBrowser!.unpair(link.id, link.instance))">{{ s('فك الربط', 'Unlink') }}</button></div></section>
  <section class="w-section"><header><div><h3>{{ s('المتصفح المدمج', 'Built-in browser') }}</h3><p>{{ s('جلسة منفصلة داخل نجد، ولا تُستورد ملفات تعريف من متصفح آخر.', 'A separate session inside NAJD; no cookies are imported from another browser.') }}</p></div></header>
    <div class="w-row"><div><strong>{{ s('الحالة', 'State') }}</strong></div><span class="w-badge green">{{ s('متاح', 'Available') }}</span></div></section>
  <section class="w-section"><header><div><h3>{{ s('حزمة المستندات', 'Document pack') }}</h3></div></header>
    <div class="w-row"><div><strong>Word, Excel, PDF, PowerPoint</strong><small>{{ pack.value.value?.lastError }}</small></div><div class="w-row-end"><span :class="['w-badge', pack.value.value?.state === 'ready' ? 'green' : '']">{{ pack.value.value?.installing || pack.value.value?.state || '—' }}</span>
      <button v-if="pack.value.value?.state === 'ready'" type="button" class="w-btn danger" @click="pack.run(() => host.najdPack!.remove())">{{ s('إزالة', 'Remove') }}</button>
      <button v-else type="button" class="w-btn" :disabled="!!pack.value.value?.installing" @click="pack.run(() => host.najdPack!.install())">{{ s('تثبيت', 'Install') }}</button></div></div></section>
  <section class="w-section"><header><div><h3>{{ s('المجلدات المسموحة', 'Allowed folders') }}</h3></div><button type="button" class="w-btn" @click="roots.run(() => files().grantRoot())">{{ s('إضافة مجلد', 'Add a folder') }}</button></header>
    <div v-for="root in roots.value.value || []" :key="root" class="w-row"><div><strong>{{ root }}</strong></div><button type="button" class="w-btn danger" @click="roots.run(() => files().revokeRoot(root))">{{ s('سحب', 'Revoke') }}</button></div></section>
  <section class="w-section"><header><div><h3>{{ s('السجل', 'Activity') }}</h3></div></header>
    <div v-for="(entry, index) in activity" :key="index" class="w-row"><div><strong>{{ entry.action || '' }}</strong><small>{{ entry.path }}</small></div>{{ entry.decision }}</div></section>
</template>
