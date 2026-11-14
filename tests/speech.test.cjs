const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createSpeech, MAX_TEXT } = require('../electron/speech.cjs')

test('read-aloud passes bounded text by file, returns the WAV and cleans up', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-speech-test-'))
  try {
    let seen
    const run = (command, args, options, done) => {
      seen = { command, args, options }
      const out = args[args.indexOf('-Out') + 1], textFile = args[args.indexOf('-TextFile') + 1]
      void fs.readFile(textFile, 'utf8').then(async text => { seen.text = text; await fs.writeFile(out, Buffer.alloc(4000, 1)); done(null, 'Microsoft Naayf') })
      return { kill() {} }
    }
    const speech = createSpeech({ scriptPath: 'speech.ps1', run, tempRoot, platform: 'win32' })
    const result = await speech.synthesize('مرحبا ' + 'ا'.repeat(MAX_TEXT + 50), 'ar')
    assert.equal(result.voice, 'Microsoft Naayf')
    assert.match(result.audio, /^data:audio\/wav;base64,/)
    assert.equal(seen.command, 'powershell.exe')
    assert.equal(seen.args[seen.args.indexOf('-Lang') + 1], 'ar')
    assert.equal(seen.text.length, MAX_TEXT)
    assert.equal(seen.options.windowsHide, true)
    assert.deepEqual(await fs.readdir(tempRoot), [], 'temporary files are removed')
    await assert.rejects(speech.synthesize('  ', 'en'), { code: 'INVALID_INPUT' })
    await assert.rejects(createSpeech({ scriptPath: 'x', platform: 'linux' }).synthesize('hi', 'en'), { code: 'SPEECH_UNAVAILABLE' })
    const broken = createSpeech({ scriptPath: 'x', tempRoot, platform: 'win32', run: (_c, _a, _o, done) => { done(new Error('boom')); return { kill() {} } } })
    await assert.rejects(broken.synthesize('hi', 'en'), { code: 'SPEECH_FAILED' })
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }) }
})
