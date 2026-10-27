// Video understanding without extra programs: Electron's own Chromium decodes the video in
// a hidden, sandboxed window, seeks to evenly spaced moments and returns bounded JPEG frames.
// The file is served only through a single-use token on a private scheme (no file:// access,
// no network); the page has no preload and no Node access.
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const SCHEME = 'najd-media'
const fail = code => Object.assign(new Error(code), { code })
const types = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg' }
const PAGE = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src najd-media:; connect-src najd-media:; script-src \'unsafe-inline\'"><video muted preload="auto"></video><canvas></canvas>'

// Must run before app 'ready'.
function registerVideoScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
}

function createVideoFrames({ protocol, BrowserWindow }) {
  const tokens = new Map()
  let registered = false
  function ensureHandler() {
    if (registered) return
    registered = true
    protocol.handle(SCHEME, request => {
      const url = new URL(request.url)
      // Page and media share one origin so sampled frames can be read back from the canvas.
      if (url.hostname !== 'frames') return new Response(null, { status: 404 })
      if (url.pathname === '/') return new Response(PAGE, { headers: { 'Content-Type': 'text/html' } })
      const entry = url.pathname.startsWith('/media/') && tokens.get(url.pathname.slice('/media/'.length))
      if (!entry) return new Response(null, { status: 404 })
      // Range requests let Chromium seek without loading the whole file.
      const size = entry.size, range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '')
      let start = 0, end = size - 1
      if (range) { start = range[1] ? Number(range[1]) : size - Number(range[2]); end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1 }
      if (start < 0 || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      const stream = fs.createReadStream(entry.file, { start, end })
      return new Response(require('node:stream').Readable.toWeb(stream), { status: range ? 206 : 200, headers: {
        'Content-Type': entry.type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) } })
    })
  }

  // times: explicit moments in seconds (at most 600) instead of evenly spaced frames, used by the Office playback check
  // (M3-012); with gray, each frame is a gray-level grid of gray.width x gray.height bytes (no JPEG noise) and no audio.
  async function extract(file, { maxFrames = 8, maxSide = 1024, timeoutMs = 90000, audioSeconds = 600, audioMaxDuration = 900, audioMaxBytes = 300 * 1024 * 1024, times = null, gray = null } = {}) {
    if (times !== null && (!Array.isArray(times) || !times.length || times.length > 600 || times.some(time => !Number.isFinite(time) || time < 0))) throw fail('INVALID_INPUT')
    if (gray !== null && !(Number.isInteger(gray?.width) && Number.isInteger(gray?.height) && gray.width >= 16 && gray.height >= 9 && gray.width <= 640 && gray.height <= 360)) throw fail('INVALID_INPUT')
    const type = types[path.extname(file).toLowerCase()]
    if (!type) throw fail('UNSUPPORTED_FORMAT')
    const stat = await fs.promises.stat(file)
    if (!stat.isFile() || stat.size < 1) throw fail('UNSUPPORTED_FORMAT')
    ensureHandler()
    const token = randomBytes(24).toString('hex')
    tokens.set(token, { file, size: stat.size, type })
    const window = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, javascript: true, offscreen: !!gray } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    const timer = setTimeout(() => { if (!window.isDestroyed()) window.destroy() }, timeoutMs)
    try {
      await window.loadURL(`${SCHEME}://frames/`)
      const result = await window.webContents.executeJavaScript(`(async () => {
        const video = document.querySelector('video'), canvas = document.querySelector('canvas')
        const once = (name) => new Promise((resolve, reject) => { video.addEventListener(name, resolve, { once: true }); video.addEventListener('error', () => reject(new Error('decode')), { once: true }) })
        try {
        video.src = '${SCHEME}://frames/media/${token}'
        await once('loadedmetadata')
        // Recorded/streamed files (e.g. browser-made WebM) may omit duration until the end is read.
        if (!Number.isFinite(video.duration)) {
          video.currentTime = 1e7
          await new Promise(resolve => { const check = () => Number.isFinite(video.duration) && resolve(); video.addEventListener('durationchange', check); video.addEventListener('seeked', check); setTimeout(resolve, 15000) })
        }
        const duration = video.duration
        if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) throw new Error('decode')
        const requested = ${JSON.stringify(times)}, grid = ${JSON.stringify(gray)}
        const count = requested ? requested.length : Math.max(1, Math.min(${maxFrames}, Math.ceil(duration / 2)))
        const scale = Math.min(1, ${maxSide} / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = grid ? grid.width : Math.round(video.videoWidth * scale); canvas.height = grid ? grid.height : Math.round(video.videoHeight * scale)
        const context = canvas.getContext('2d', { willReadFrequently: !!grid }), frames = []
        const levelsNow = () => {
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, levels = new Uint8Array(canvas.width * canvas.height)
          for (let p = 0; p < levels.length; p++) levels[p] = Math.round(0.299 * pixels[p * 4] + 0.587 * pixels[p * 4 + 1] + 0.114 * pixels[p * 4 + 2])
          return levels
        }
        const encode = levels => { let binary = ''; for (let i = 0; i < levels.length; i += 0x8000) binary += String.fromCharCode.apply(null, levels.subarray(i, i + 0x8000)); return btoa(binary) }
        // Many timed gray samples: one pass of playback at triple speed, keeping for each requested moment the frame that
        // was on screen then (the last frame whose media time is not after it). Exact frame times, no per-seek waits.
        if (grid && requested && requested.length > 8 && video.requestVideoFrameCallback) {
          const wanted = requested.map((time, index) => ({ time: Math.min(duration - 0.02, time), index })).sort((a, b) => a.time - b.time)
          const picked = new Array(requested.length)
          let previous = null, cursor = 0
          video.currentTime = 0
          await once('seeked')
          video.playbackRate = 3
          await new Promise(resolve => {
            const finish = () => { while (cursor < wanted.length) { picked[wanted[cursor].index] = previous; cursor++ } resolve() }
            const deadline = setTimeout(finish, (duration / 3 + 30) * 1000)
            const onFrame = (_now, meta) => {
              const current = levelsNow()
              while (cursor < wanted.length && wanted[cursor].time < meta.mediaTime - 0.001) { picked[wanted[cursor].index] = previous || current; cursor++ }
              previous = current
              if (cursor >= wanted.length) { clearTimeout(deadline); finish(); return }
              video.requestVideoFrameCallback(onFrame)
            }
            video.addEventListener('ended', () => { clearTimeout(deadline); finish() }, { once: true })
            video.requestVideoFrameCallback(onFrame)
            video.play().catch(() => { clearTimeout(deadline); finish() })
          })
          video.pause()
          if (picked.every(Boolean)) return { duration: Math.round(duration * 1000) / 1000, width: video.videoWidth, height: video.videoHeight, audio: null,
            frames: requested.map((time, index) => ({ time: Math.round(time * 1000) / 1000, gray: encode(picked[index]) })) }
        }
        for (let index = 0; index < count; index++) {
          const time = requested ? Math.min(duration - 0.02, requested[index]) : Math.min(duration - 0.05, (index + 0.5) * duration / count)
          video.currentTime = Math.max(0, time)
          await once('seeked')
          // 'seeked' can fire before the new frame is painted; wait until it is presented (bounded), so a sample is never a
          // stale earlier frame.
          await new Promise(resolve => { const timer = setTimeout(resolve, 500); if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve() }); else { clearTimeout(timer); setTimeout(resolve, 80) } })
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          if (grid) {
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, levels = new Uint8Array(canvas.width * canvas.height)
            for (let p = 0; p < levels.length; p++) levels[p] = Math.round(0.299 * pixels[p * 4] + 0.587 * pixels[p * 4 + 1] + 0.114 * pixels[p * 4 + 2])
            let binary = ''
            for (let i = 0; i < levels.length; i += 0x8000) binary += String.fromCharCode.apply(null, levels.subarray(i, i + 0x8000))
            frames.push({ time: Math.round(time * 1000) / 1000, gray: btoa(binary) })
          } else frames.push({ time: Math.round(time * 10) / 10, jpeg: canvas.toDataURL('image/jpeg', 0.8) })
        }
        if (grid) return { duration: Math.round(duration * 1000) / 1000, width: video.videoWidth, height: video.videoHeight, frames, audio: null }
        // Audio for optional transcription: decoded locally, resampled to 16 kHz mono 16-bit WAV (first ${audioSeconds} s).
        // Skipped for long or very large files (the full decode happens in memory) and for videos without sound.
        let audio = null
        if (duration <= ${audioMaxDuration} && ${stat.size} <= ${audioMaxBytes}) {
          try {
            const data = await (await fetch(video.src)).arrayBuffer()
            const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(data)
            const seconds = Math.min(decoded.duration, ${audioSeconds})
            const offline = new OfflineAudioContext(1, Math.ceil(seconds * 16000), 16000)
            const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start()
            const pcm = (await offline.startRendering()).getChannelData(0)
            let peak = 0
            for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]))
            if (peak > 0.003) {
              const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2))
              const text = (offset, value) => { for (let i = 0; i < value.length; i++) wav.setUint8(offset + i, value.charCodeAt(i)) }
              text(0, 'RIFF'); wav.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true)
              wav.setUint32(24, 16000, true); wav.setUint32(28, 32000, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, pcm.length * 2, true)
              for (let i = 0; i < pcm.length; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
              const bytes = new Uint8Array(wav.buffer); let binary = ''
              for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
              audio = { seconds: Math.round(seconds * 10) / 10, truncated: decoded.duration > seconds + 0.5, wav: btoa(binary) }
            }
          } catch {}
        }
        return { duration: Math.round(duration * 10) / 10, width: video.videoWidth, height: video.videoHeight, frames, audio }
        } catch (failure) {
          // Plain data only crosses back to main; media error codes help diagnose unsupported codecs.
          return { error: String(failure && failure.message || failure), media: video.error ? video.error.code + ':' + video.error.message : null }
        }
      })()`, true)
      if (result?.error) throw Object.assign(fail('UNSUPPORTED_FORMAT'), { detail: result.error + ' ' + result.media })
      if (!result || !Array.isArray(result.frames) || !result.frames.length) throw fail('UNSUPPORTED_FORMAT')
      if (gray) return { duration: result.duration, width: result.width, height: result.height, audio: null,
        frames: result.frames.map(frame => ({ time: frame.time, gray: Buffer.from(String(frame.gray || ''), 'base64') })).filter(frame => frame.gray.length === gray.width * gray.height) }
      return { duration: result.duration, width: result.width, height: result.height,
        frames: result.frames.filter(frame => /^data:image\/jpeg;base64,/.test(frame.jpeg)).map(frame => ({ time: frame.time, jpeg: Buffer.from(frame.jpeg.split(',')[1], 'base64') })),
        audio: result.audio && typeof result.audio.wav === 'string' ? { seconds: result.audio.seconds, truncated: result.audio.truncated === true, wav: Buffer.from(result.audio.wav, 'base64') } : null }
    } catch (error) {
      throw Object.assign(fail('UNSUPPORTED_FORMAT'), { detail: error?.detail || String(error?.message || error) })
    } finally {
      clearTimeout(timer)
      tokens.delete(token)
      if (!window.isDestroyed()) window.destroy()
    }
  }
  return { extract }
}
module.exports = { registerVideoScheme, createVideoFrames }
