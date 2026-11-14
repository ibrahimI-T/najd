import { onBeforeUnmount, ref } from 'vue'

// Voice input for the composer (R-080): the microphone records while the button is on; stopping sends the recording to the owner's
// OpenAI key for transcription and returns the text, which goes into the draft for the owner to read before sending. Nothing is sent
// while recording, a cancelled recording is discarded, and recordings stop by themselves after 5 minutes.
export type VoiceState = 'idle' | 'recording' | 'transcribing'
const LIMIT_MS = 5 * 60 * 1000

export function useVoiceInput(onText: (text: string) => void, onError: (code: string) => void) {
  const state = ref<VoiceState>('idle'), available = ref<boolean | null>(null), seconds = ref(0)
  let recorder: MediaRecorder | null = null, stream: MediaStream | null = null, chunks: Blob[] = [], started = 0, ticker: ReturnType<typeof setInterval> | null = null, limit: ReturnType<typeof setTimeout> | null = null, discard = false
  async function refresh() { try { available.value = (await window.najdVoice?.status())?.available ?? false } catch { available.value = false } }
  function release() { if (ticker) clearInterval(ticker); if (limit) clearTimeout(limit); ticker = limit = null; stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null }
  async function start() {
    if (state.value !== 'idle') return
    await refresh()
    if (!available.value) { onError('VOICE_NEEDS_KEY'); return }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }) } catch { onError('MICROPHONE_UNAVAILABLE'); return }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type)) || ''
    chunks = []; discard = false; started = Date.now(); seconds.value = 0
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onstop = () => void finish(recorder?.mimeType || mime || 'audio/webm')
    recorder.start(1000)
    state.value = 'recording'
    ticker = setInterval(() => { seconds.value = Math.round((Date.now() - started) / 1000) }, 500)
    limit = setTimeout(() => stop(), LIMIT_MS)
  }
  function stop() { if (state.value === 'recording' && recorder && recorder.state !== 'inactive') recorder.stop() }
  function cancel() { if (state.value !== 'recording') return; discard = true; stop() }
  async function finish(mime: string) {
    const duration = Math.max(1, Math.round((Date.now() - started) / 1000))
    release()
    if (discard || !chunks.length) { state.value = 'idle'; return }
    state.value = 'transcribing'
    try {
      const audio = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer())
      const result = await window.najdVoice!.transcribe(audio, mime, Math.min(300, duration))
      if (result.text) onText(result.text); else onError('VOICE_EMPTY')
    } catch (reason) { onError(String((reason as Error)?.message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { chunks = []; state.value = 'idle' }
  }
  onBeforeUnmount(() => { discard = true; if (recorder && recorder.state !== 'inactive') recorder.stop(); release() })
  return { state, available, seconds, refresh, start, stop, cancel, toggle: () => state.value === 'recording' ? stop() : start() }
}
