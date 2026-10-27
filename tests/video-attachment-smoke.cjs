// Real Electron path: a short video is recorded inside the app's own Chromium (WebM, and MP4
// when the recorder supports it), attached through the composer, sampled into frames by
// NAJD's hidden decoder window, and delivered to the selected model (fixture) as vision input.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

const RECORD = (mime, sound) => `(async () => {
  if (!MediaRecorder.isTypeSupported(${JSON.stringify(mime)})) return null
  const sound = ${sound}
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
  const context = canvas.getContext('2d'), stream = canvas.captureStream(25)
  // A steady tone gives the recording a real sound track for NAJD's local audio extraction.
  const audio = sound ? new AudioContext() : null, tone = audio?.createOscillator()
  if (audio) {
    await Promise.race([audio.resume(), new Promise(r => setTimeout(r, 1000))])
    const level = audio.createGain(), sink = audio.createMediaStreamDestination()
    tone.frequency.value = 440; level.gain.value = 0.3; tone.connect(level); level.connect(sink); tone.start()
    stream.addTrack(sink.stream.getAudioTracks()[0])
  }
  const recorder = new MediaRecorder(stream, { mimeType: ${JSON.stringify(mime)} }), chunks = []
  recorder.ondataavailable = event => chunks.push(event.data)
  const stopped = new Promise(resolve => { recorder.onstop = resolve })
  recorder.start(200)
  const started = performance.now()
  await new Promise(resolve => { const draw = () => { const t = performance.now() - started
    context.fillStyle = t < 2000 ? 'red' : t < 4000 ? 'green' : 'blue'; context.fillRect(0, 0, 320, 180)
    if (t < 6000) setTimeout(draw, 40); else resolve() }; draw() })
  recorder.stop(); await stopped; if (audio) { tone.stop(); void audio.close() }
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
  let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
})()`

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  await fs.mkdir(root + '-imports')
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value
    }
    const formats = [], withSound = new Set()
    // MP4 with sound when the recorder supports it, otherwise MP4 video only (still covers MP4 decoding).
    for (const [mime, name, sound] of [['video/webm;codecs=vp8,opus', 'clip.webm', true], ['video/mp4;codecs=avc1,mp4a.40.2', 'clip.mp4', true], ['video/mp4;codecs=avc1', 'clip.mp4', false]]) {
      if (formats.includes(name)) continue
      // Start in the page and poll: one evaluate may not outlast the 6 s recording.
      await run(`window.__najdRecording = ${RECORD(mime, sound)}.then(value => (window.__najdRecorded = { value }), error => (window.__najdRecorded = { error: String(error) })); window.__najdRecorded = null; true`)
      await waitFor(async () => await evaluate(client, 'window.__najdRecorded !== null'), 30000)
      const recorded = await run('window.__najdRecorded')
      assert.ok(!recorded.error, recorded.error)
      const data = recorded.value
      if (data) { await fs.writeFile(path.join(root + '-imports', name), Buffer.from(data, 'base64')); formats.push(name); if (sound && name.endsWith('.webm')) withSound.add(name) }
    }
    // A standard MP4 with AAC sound, like a phone recording (the in-app recorder only makes fragmented MP4).
    try {
      require('node:child_process').execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(root + '-imports', 'phone.mp4')], { windowsHide: true, timeout: 60000 })
      formats.push('phone.mp4'); withSound.add('phone.mp4')
    } catch { console.log('ffmpeg not available: standard MP4/AAC case skipped') }
    assert.ok(formats.includes('clip.webm'), 'WebM recording required')
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))
    for (const name of formats) {
      await fs.writeFile(path.join(root + '-imports', 'pick.txt'), name)
      await click(client, '.attach-button')
      await click(client, '.attachment-popover .model-refresh')
      await waitFor(async () => await evaluate(client, `document.querySelector(".attachment-chips")?.textContent.includes(${JSON.stringify(name)})`), 120000)
      await click(client, '.attach-button')
      await click(client, '#prompt')
      await client.send('Input.insertText', { text: 'video fixture: what changes in ' + name })
      await click(client, '.send-button')
      await waitFor(async () => await evaluate(client, `Array.from(document.querySelectorAll(".message.assistant")).filter(m=>m.textContent.includes("Video frames received")).length >= ${formats.indexOf(name) + 1}`), 120000)
    }
    const videos = (await run('window.najdLibrary.list()')).filter(item => item.kind === 'video')
    assert.equal(videos.length, formats.length)
    for (const video of videos) if (withSound.has(video.name)) assert.ok(video.audioSeconds > 3, 'sound track extracted and stored for ' + video.name + ': ' + JSON.stringify(video))
      else assert.equal(video.audioSeconds, undefined, 'a silent recording stores no sound track')
    console.log(`PASS: ${formats.join(' and ')} decoded by NAJD's Chromium, sampled into frames, their sound tracks extracted locally, and delivered to the selected model with the transcription tool offered.`)
  } finally {
    if (instance) await stop(instance)
    for (const dir of [root, root + '-imports', root + '-documents']) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
