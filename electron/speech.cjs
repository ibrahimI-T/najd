// Read-aloud for replies (R-083, after OpenClaw's text-to-speech): Windows' own speech engine through electron/speech.ps1, so Arabic
// (Microsoft Naayf) and English voices work without any service, key or token. One request at a time; text is bounded; the WAV comes back
// as a data URL the renderer plays. Temporary files live under the app's temp folder and are removed after each request.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')

const MAX_TEXT = 6000
const fail = code => Object.assign(new Error(code), { code })

function createSpeech({ scriptPath, run = execFile, tempRoot = os.tmpdir(), platform = process.platform }) {
  let busy = null
  async function synthesize(text, language) {
    if (platform !== 'win32') throw fail('SPEECH_UNAVAILABLE')
    if (typeof text !== 'string' || !text.trim()) throw fail('INVALID_INPUT')
    const lang = language === 'ar' ? 'ar' : 'en'
    // A new request replaces the one still running (the owner pressed Listen on another reply).
    if (busy) { try { busy.kill() } catch {} busy = null }
    const dir = await fs.mkdtemp(path.join(tempRoot, 'najd-speech-'))
    const textFile = path.join(dir, 'text.txt'), out = path.join(dir, 'speech.wav')
    try {
      await fs.writeFile(textFile, text.slice(0, MAX_TEXT), 'utf8')
      const voice = await new Promise((resolve, reject) => {
        busy = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Out', out, '-Lang', lang, '-TextFile', textFile],
          { windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(fail('SPEECH_FAILED')) : resolve(String(stdout || '').trim().slice(0, 80)))
      })
      const audio = await fs.readFile(out)
      if (audio.length < 1000) throw fail('SPEECH_FAILED')
      return { voice, audio: 'data:audio/wav;base64,' + audio.toString('base64') }
    } finally { busy = null; await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) }
  }
  return { synthesize }
}
module.exports = { createSpeech, MAX_TEXT }
