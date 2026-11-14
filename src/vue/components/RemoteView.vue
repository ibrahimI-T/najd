<script setup lang="ts">
// Remote Control: off by default; a one-time code pairs a device with scoped, revocable access. Credentials never reach the model.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Smartphone, Trash2 } from 'lucide-vue-next'
import QRCode from 'qrcode-generator'
import { usePrefs } from '../composables/usePrefs'
import type { RemoteStatus } from '../../workstation/types'

const { s, prefs } = usePrefs()
const status = ref<RemoteStatus | null>(null), scopes = ref<string[]>(['status']), failure = ref<string | null>(null)
const SCOPES = [{ id: 'status', ar: 'متابعة التقدم', en: 'Check progress' }, { id: 'instruct', ar: 'إضافة تعليمات', en: 'Add instructions' }, { id: 'resume', ar: 'استئناف العمل', en: 'Resume work' }]
const api = () => window.najdWorkstation!
async function load() { try { status.value = await api().remote() } catch { failure.value = 'REMOTE' } }
async function act(work: () => Promise<RemoteStatus>) { failure.value = null; try { status.value = await work() } catch (reason) { failure.value = String((reason as Error).message).split(': ').pop() || 'FAILED' } }
let off: (() => void) | undefined
onMounted(() => { void load(); off = window.najdWorkstation?.onChanged(kind => { if (kind === 'remote') void load() }) })
onBeforeUnmount(() => off?.())
const url = computed(() => status.value?.port ? `http://${status.value.address}:${status.value.port}/` : null)
const qr = computed(() => { if (!url.value) return ''; const code = QRCode(0, 'M'); code.addData(url.value); code.make(); return code.createDataURL(5, 8) })
const when = (value: string) => new Date(value).toLocaleString(prefs.language === 'ar' ? 'ar-SA' : 'en-US')
</script>

<template>
  <div class="w-page">
    <header class="w-page-head"><div><h1>{{ s('التحكم عن بعد', 'Remote Control') }}</h1><p>{{ s('اربط جهازًا برمز لمرة واحدة وصلاحيات محددة يمكن سحبها. لا تصل بيانات الدخول إلى النموذج.', 'Pair a device with a one-time code and scoped, revocable access. Credentials never reach the model.') }}</p></div></header>
    <div v-if="failure" class="w-banner error">{{ failure }}</div>
    <div v-if="!status" class="w-skeleton"><i /><i /></div>
    <template v-else>
      <section class="w-section"><header><div><h3>{{ s('السماح', 'Access') }}</h3></div></header>
        <div class="w-row"><div><strong>{{ s('السماح بالتحكم عن بعد', 'Allow remote control') }}</strong><small>{{ s('متوقف افتراضيًا. عند الإيقاف لا يستمع نجد لأي اتصال.', 'Off by default. When off, NAJD listens for nothing.') }}</small></div><button type="button" role="switch" :aria-checked="status.enabled" :class="['w-toggle', { on: status.enabled }]" :aria-label="s('السماح بالتحكم عن بعد', 'Allow remote control')" data-remote="enabled" @click="act(() => api().remoteConfigure({ enabled: !status!.enabled }))"><i /></button></div>
        <div class="w-row"><div><strong>{{ s('الشبكة المحلية', 'Local network') }}</strong><small>{{ s('يعمل على هذا الجهاز فقط ما لم تفعل هذا. الاتصال داخل الشبكة غير مشفر.', 'Works on this computer only unless you turn this on. Traffic on the network is not encrypted.') }}</small></div><button type="button" role="switch" :aria-checked="status.lan" :disabled="!status.enabled" :class="['w-toggle', { on: status.lan }]" :aria-label="s('الشبكة المحلية', 'Local network')" data-remote="lan" @click="act(() => api().remoteConfigure({ lan: !status!.lan }))"><i /></button></div>
        <div class="w-row"><div><strong>{{ s('إبقاء الحاسوب مستيقظًا', 'Keep the computer awake') }}</strong><small>{{ s('يمنع السكون التلقائي ما دام التحكم عن بعد مفعلًا.', 'Prevents automatic sleep while remote control is on.') }}</small></div><button type="button" role="switch" :aria-checked="status.keepAwake" :disabled="!status.enabled" :class="['w-toggle', { on: status.keepAwake }]" :aria-label="s('إبقاء الحاسوب مستيقظًا', 'Keep the computer awake')" data-remote="awake" @click="act(() => api().remoteConfigure({ keepAwake: !status!.keepAwake }))"><i /></button></div>
      </section>
      <section v-if="status.enabled" class="w-section"><header><div><h3>{{ s('ربط جهاز', 'Pair a device') }}</h3><p>{{ s('افتح العنوان من الجهاز، ثم أدخل الرمز خلال خمس دقائق.', 'Open the address on the device, then enter the code within five minutes.') }}</p></div></header>
        <div class="r-scopes"><label v-for="scope in SCOPES" :key="scope.id"><input v-model="scopes" type="checkbox" :value="scope.id" />{{ prefs.language === 'ar' ? scope.ar : scope.en }}</label></div>
        <button type="button" class="w-btn primary" :disabled="!scopes.length" data-remote="pair" @click="act(() => api().remotePair([...scopes]))">{{ s('إنشاء رمز ربط', 'Create a pairing code') }}</button>
        <div v-if="status.pairing && url" class="r-pair"><img class="r-qr" :src="qr" :alt="url" width="180" height="180" /><div><code dir="ltr" data-remote="url">{{ url }}</code><strong class="r-code" dir="ltr" data-remote="code">{{ status.pairing.code }}</strong></div></div>
      </section>
      <section class="w-section"><header><div><h3>{{ s('الأجهزة', 'Devices') }}</h3></div></header>
        <div v-if="!status.devices.length" class="w-empty"><Smartphone :size="26" /><strong>{{ s('لا توجد أجهزة مربوطة', 'No paired devices') }}</strong></div>
        <div v-for="device in status.devices" :key="device.id" class="w-row"><div><strong>{{ device.name }}</strong><small>{{ s('آخر ظهور: ', 'Last seen: ') + when(device.lastSeenAt) }}</small></div><div class="w-row-end"><span v-for="scope in device.scopes" :key="scope" class="w-badge">{{ scope }}</span><button type="button" class="w-icon" :aria-label="s('سحب', 'Revoke')" @click="act(() => api().remoteRevoke(device.id))"><Trash2 :size="16" /></button></div></div>
      </section>
      <section class="w-section"><header><div><h3>{{ s('السجل', 'Audit trail') }}</h3></div></header>
        <small v-if="!status.audit.length">{{ s('لا شيء بعد.', 'Nothing yet.') }}</small>
        <ol v-else class="r-audit"><li v-for="(entry, index) in status.audit" :key="index"><time>{{ when(entry.at) }}</time><code dir="ltr">{{ entry.action }}</code><bdi>{{ entry.device }}</bdi></li></ol></section>
    </template>
  </div>
</template>
