<script setup lang="ts">
// One provider's setup, opened right below its row: subscription sign-in, API key (sent once, then cleared), address, model, test, use.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import { cleanError } from '../composables/useLoad'
import type { ProviderState } from '../composables/useProviders'

const props = defineProps<{ item: NajdProvider; providers: ProviderState }>()
const { s } = usePrefs()
const api = () => window.najdProviders!, gpt = () => window.najdChatGPT!
const key = ref(''), busy = ref(false), failure = ref<string | null>(null), tested = ref<boolean | null>(null), chatgpt = ref<NajdChatGPTStatus | null>(null)
onMounted(() => {
  if (props.item.id === 'chatgpt') void window.najdChatGPT?.status().then(value => { chatgpt.value = value; watchSignIn() }).catch(() => {})
  if (props.item.configured && !props.providers.models[props.item.id]) void props.providers.loadModels(props.item.id)
})
async function run(work: () => Promise<unknown>) { busy.value = true; failure.value = null; try { await work(); await props.providers.refresh() } catch (reason) { failure.value = cleanError(reason) } finally { busy.value = false } }
// Sign-in finishes in the browser, so while it is pending the status is read again every second; once it ends the models are listed.
let poll: ReturnType<typeof setTimeout> | undefined
function watchSignIn() {
  clearTimeout(poll)
  if (!chatgpt.value?.signingIn) return
  poll = setTimeout(() => { void gpt().status().then(async value => { chatgpt.value = value; if (value.signingIn) watchSignIn(); else { await props.providers.refresh(); await props.providers.loadModels('chatgpt') } }).catch(() => watchSignIn()) }, 1000)
}
onBeforeUnmount(() => clearTimeout(poll))
const chatgptRun = (work: () => Promise<NajdChatGPTStatus>) => run(async () => { chatgpt.value = await work(); watchSignIn() })
function saveKey() { const value = key.value.trim(); key.value = ''; void run(async () => { await api().saveKey(props.item.id, value); await props.providers.loadModels(props.item.id) }) }
function endpoint(event: Event) { const value = (event.target as HTMLInputElement).value; if (value && value !== props.item.endpoint) void run(() => api().setEndpoint(props.item.id, value)) }
function test() { tested.value = null; const chosen = props.providers.choices[props.item.id]; void run(async () => { tested.value = (await api().testModel(props.item.id, chosen)).verified }) }
</script>

<template>
  <div class="ps-setup" :data-setup="item.id">
    <div v-if="failure" class="w-banner error">{{ failure }}</div>
    <div v-if="item.id === 'chatgpt'" class="ps-step"><strong>{{ s('اربط اشتراكك', 'Link your subscription') }}</strong><small>{{ s('يفتح المتصفح لتسجيل الدخول في حسابك؛ لا يرى نجد كلمة المرور.', 'Your browser opens to sign in to your account; NAJD never sees the password.') }}</small>
      <div v-for="account in chatgpt?.accounts || []" :key="account.id" class="ps-line"><bdi>{{ account.label }}</bdi><span :class="['w-badge', account.signedIn ? 'green' : '']">{{ account.signedIn ? s('مسجل', 'Signed in') : s('غير مسجل', 'Signed out') }}</span>
        <button v-if="chatgpt?.activeId !== account.id" type="button" class="w-btn" @click="chatgptRun(() => gpt().select(account.id))">{{ s('استخدام', 'Use') }}</button>
        <button type="button" class="w-btn danger" @click="chatgptRun(() => gpt().signOut(account.id))">{{ s('خروج', 'Sign out') }}</button></div>
      <div class="ps-line"><button type="button" class="w-btn primary" :disabled="busy || chatgpt?.signingIn" data-provider-signin @click="chatgptRun(() => gpt().start())">{{ chatgpt?.signingIn ? s('بانتظار تسجيل الدخول…', 'Waiting for sign-in…') : s('تسجيل الدخول', 'Sign in') }}</button>
        <button v-if="chatgpt?.signingIn" type="button" class="w-btn" @click="chatgptRun(() => gpt().cancel())">{{ s('إلغاء', 'Cancel') }}</button></div></div>
    <div v-if="item.auth === 'key' || item.auth === 'optional-key'" class="ps-step"><strong>{{ item.auth === 'optional-key' ? s('مفتاح (اختياري)', 'Key (optional)') : s('مفتاح API', 'API key') }}</strong>
      <div class="ps-line"><input v-model="key" type="password" autocomplete="off" dir="ltr" :placeholder="item.keySaved ? s('محفوظ، اكتب مفتاحًا جديدًا لاستبداله', 'Saved; type a new key to replace it') : item.keyHint" :aria-label="s('مفتاح API', 'API key')" />
        <button type="button" class="w-btn primary" :disabled="!key.trim() || busy" @click="saveKey">{{ s('حفظ', 'Save') }}</button>
        <button v-if="item.keySaved" type="button" class="w-btn danger" :disabled="busy" @click="run(() => api().clearKey(item.id))">{{ s('مسح', 'Clear') }}</button>
        <button v-if="item.kind !== 'local'" type="button" class="w-btn ghost" @click="api().openConsole(item.id)">{{ s('الحصول على مفتاح', 'Get a key') }}</button></div></div>
    <div v-if="item.editableUrl" class="ps-step"><strong>{{ s('العنوان', 'Address') }}</strong><input dir="ltr" :value="item.endpoint" :aria-label="s('العنوان', 'Address')" @blur="endpoint" /></div>
    <div v-if="item.configured" class="ps-step"><strong>{{ s('النموذج', 'Model') }}</strong>
      <div class="ps-line"><select class="w-select" :aria-label="s('النموذج', 'Model')" :value="providers.choices[item.id] || ''" @change="providers.chooseModel(item.id, ($event.target as HTMLSelectElement).value)">
          <option value="">{{ providers.loading[item.id] ? s('يحمّل…', 'Loading…') : providers.errors[item.id] ? s('تعذر جلب النماذج', 'Could not list models') : s('اختر', 'Choose') }}</option>
          <option v-for="model in providers.models[item.id] || []" :key="model.id" :value="model.id">{{ model.label }}</option></select>
        <button type="button" class="w-btn" :disabled="!providers.choices[item.id] || busy" @click="test">{{ s('اختبار', 'Test') }}</button>
        <span v-if="tested === true" class="w-badge green">{{ s('يعمل', 'Works') }}</span><span v-if="tested === false" class="w-badge red">{{ s('لم يرد', 'No answer') }}</span>
        <button type="button" :class="['w-btn', providers.provider.value === item.id ? 'primary' : '']" :disabled="!providers.choices[item.id]" data-provider-use @click="providers.setProvider(item.id)"><template v-if="providers.provider.value === item.id"><Check :size="14" />{{ s('المستخدم الآن', 'In use') }}</template><template v-else>{{ s('استخدام في المحادثة', 'Use in chat') }}</template></button></div></div>
  </div>
</template>
