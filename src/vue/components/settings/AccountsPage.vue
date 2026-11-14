<script setup lang="ts">
// Authorized accounts: the password goes to Windows Credential Manager and never reaches the model or this page again.
import { reactive } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { usePrefs } from '../../composables/usePrefs'
import { useLoad } from '../../composables/useLoad'

const { s } = usePrefs()
const api = () => window.najdAccounts!
const { value, failure, run } = useLoad(window.najdAccounts?.list)
// A removed account whose saved password could not be deleted yet stays hidden but unfinished (electron/credential-vault.cjs). The service keeps
// retrying it, and it used to be invisible: the owner could not tell that a password might still sit in Windows Credential Manager.
// `unresolved` means the password is gone but an interrupted removal was never confirmed: the owner says the browser tabs were closed or refreshed.
const pending = useLoad(window.najdAccounts?.pending)
const retry = () => pending.run(() => api().retry(), s('أُعيدت المحاولة.', 'Tried again.'))
const confirm = (id: string) => pending.run(() => api().acknowledge(id), s('تم التأكيد.', 'Confirmed.'))
const form = reactive({ label: '', siteUrl: '', username: '', password: '', autoLogin: true })
const removeAccount = (id: string) => run(async () => { await api().remove(id); await pending.load() })
function authorize() { const input = { ...form }; Object.assign(form, { label: '', siteUrl: '', username: '', password: '', autoLogin: true }); void run(() => api().add(input)) }
</script>

<template>
  <section class="w-section"><header><div><h3>{{ s('الحسابات المفوضة', 'Authorized accounts') }}</h3><p>{{ s('تذهب كلمة المرور إلى مدير بيانات اعتماد ويندوز ولا تصل إلى النموذج.', 'The password goes to Windows Credential Manager and never reaches the model.') }}</p></div></header>
    <div v-if="failure" class="w-banner error">{{ failure }}</div>
    <div v-if="(pending.value.value || []).length" class="w-banner warn" data-accounts-pending>
      <strong>{{ s('إزالة لم تكتمل', 'A removal is not finished') }}</strong>
      <div v-for="account in pending.value.value || []" :key="account.id" class="w-row"><div><span dir="auto">{{ account.label }} · {{ account.host }}</span>
        <small>{{ account.unresolved ? s('حُذفت كلمة المرور، لكن الإزالة انقطعت. أغلق تبويبات هذا الموقع أو حدّثها ثم أكّد.', 'The password is gone but the removal was interrupted. Close or refresh this site\'s tabs, then confirm.') : s('تعذر حذف كلمة المرور المحفوظة من مدير بيانات اعتماد ويندوز؛ ستبقى الإزالة مفتوحة وتُعاد المحاولة.', 'The saved password could not be deleted from Windows Credential Manager yet; the removal stays open and is retried.') }}</small></div>
        <button v-if="account.unresolved" type="button" class="w-btn" data-account-confirm @click="confirm(account.id)">{{ s('أكّدت', 'I did') }}</button>
        <button v-else type="button" class="w-btn" data-account-retry :disabled="pending.busy.value" @click="retry">{{ s('أعد المحاولة', 'Try again') }}</button></div></div>
    <div v-for="account in value || []" :key="account.id" class="w-row"><div><strong>{{ account.label }}</strong><small>{{ account.username + ' · ' + account.host }}</small></div><div class="w-row-end">
      <button type="button" role="switch" :aria-checked="account.autoLogin" :aria-label="s('دخول تلقائي', 'Auto sign-in')" :class="['w-toggle', { on: account.autoLogin }]" @click="run(() => api().setAutoLogin(account.id, !account.autoLogin))"><i /></button>
      <button type="button" class="w-icon" :aria-label="s('إزالة', 'Remove')" data-account-remove @click="removeAccount(account.id)"><Trash2 :size="16" /></button></div></div>
    <div class="s-form">
      <label class="w-field"><span>{{ s('الاسم', 'Label') }}</span><input v-model="form.label" /></label><label class="w-field"><span>{{ s('الموقع', 'Site') }}</span><input v-model="form.siteUrl" dir="ltr" /></label>
      <label class="w-field"><span>{{ s('اسم المستخدم', 'Username') }}</span><input v-model="form.username" dir="ltr" autocomplete="off" /></label><label class="w-field"><span>{{ s('كلمة المرور', 'Password') }}</span><input v-model="form.password" type="password" dir="ltr" autocomplete="off" /></label>
      <button type="button" class="w-btn primary" :disabled="!form.label || !form.siteUrl || !form.username || !form.password" @click="authorize">{{ s('تفويض', 'Authorize') }}</button></div>
  </section>
</template>
