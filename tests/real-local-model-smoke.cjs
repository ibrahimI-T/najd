const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { createHash, randomUUID } = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const pins = require('../build/local-model-test-pins.json')
const { createOllamaClient } = require('../electron/ollama.cjs')
const { createProviderService } = require('../electron/provider-service.cjs')
const { createNajdCore } = require('../electron/najd-core.cjs')
const { createFileTool } = require('../electron/file-tools.cjs')
const execute = promisify(execFile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function hash(filename) { const digest = createHash('sha256'); for await (const chunk of createReadStream(filename)) digest.update(chunk); return digest.digest('hex') }

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows-only isolated proof')
  const root = path.resolve(__dirname, '..'), runtimeRoot = path.join(root, '.runtimes')
  const executable = path.resolve(process.env.NAJD_OLLAMA_EXE || path.join(process.env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe'))
  assert.equal(await hash(executable), pins.ollamaExeSha256, 'Installed Ollama binary differs from the reviewed pin')
  const signature = await execute('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$s=Get-AuthenticodeSignature -LiteralPath $env:NAJD_OLLAMA_EXE; if($s.Status -ne "Valid" -or $s.SignerCertificate.Subject -notlike "CN=Ollama Inc.,*"){exit 1}'],
    { env: { ...process.env, NAJD_OLLAMA_EXE: executable }, windowsHide: true, timeout: 10000 })
  assert.equal(signature.stderr.trim(), '')
  assert.match(pins.model, /^[a-z0-9.]+:[a-z0-9.]+$/)
  const models = path.join(runtimeRoot, 'ollama-models-' + pins.model.replace(':', '-'))
  const marker = { model: pins.model, manifest: pins.manifestSha256 }
  try { await fs.mkdir(models); await fs.writeFile(path.join(models, 'najd-cache.json'), JSON.stringify(marker), { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.deepEqual(JSON.parse(await fs.readFile(path.join(models, 'najd-cache.json'), 'utf8')), marker) }
  assert.equal((await fs.lstat(models)).isSymbolicLink(), false)
  assert.equal(await fs.realpath(models), models)
  const stateRoot = await fs.mkdtemp(path.join(runtimeRoot, 'ollama-proof-'))
  let child, exited = false, service
  const originalFetch = globalThis.fetch
  try {
    const home = path.join(stateRoot, 'home')
    for (const folder of ['AppData/Roaming', 'AppData/Local', 'AppData/LocalLow', 'Desktop', 'Documents']) await fs.mkdir(path.join(home, folder), { recursive: true })
    const reserve = net.createServer()
    await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
    const port = reserve.address().port
    await new Promise(resolve => reserve.close(resolve))
    const baseUrl = `http://127.0.0.1:${port}`
    const system = process.env.SystemRoot
    child = spawn(executable, ['serve'], { cwd: stateRoot, windowsHide: true, stdio: 'ignore', env: {
      SystemRoot: system, WINDIR: system, PATH: path.dirname(executable) + path.delimiter + path.join(system, 'System32'),
      HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
      TEMP: stateRoot, TMP: stateRoot, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: models,
      OLLAMA_KEEP_ALIVE: '0', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NO_CLOUD: 'true', CUDA_VISIBLE_DEVICES: '-1'
    } })
    child.once('exit', () => { exited = true })
    child.on('error', () => { exited = true })
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (exited) throw new Error('Private Ollama server exited')
      try { const result = await fetch(baseUrl + '/api/version', { signal: AbortSignal.timeout(1000), redirect: 'error' }); if (result.ok) { assert.equal((await result.json()).version, pins.ollamaVersion); ready = true; break } } catch { }
      await pause(250)
    }
    assert.equal(ready, true, 'Private server readiness failed')
    const sockets = await execute(path.join(system, 'System32/netstat.exe'), ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 5000 })
    const owners = sockets.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === `127.0.0.1:${port}` && parts[3] === 'LISTENING')
    assert.ok(owners.length && owners.every(parts => Number(parts[4]) === child.pid), 'Refusing an unrelated local listener')
    console.log(`Owned Ollama ${pins.ollamaVersion} ready; private model cache and loopback port verified.`)
    const pulled = await fetch(baseUrl + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: pins.model, stream: true }), signal: AbortSignal.timeout(600000), redirect: 'error' })
    assert.equal(pulled.ok, true)
    let buffer = '', success = false, progress = -25
    for await (const chunk of pulled.body) {
      buffer += Buffer.from(chunk).toString('utf8')
      if (buffer.length > 65536) throw new Error('Oversized pull status')
      let separator
      while ((separator = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, separator); buffer = buffer.slice(separator + 1)
        if (!line.trim()) continue
        const item = JSON.parse(line)
        if (item.error) throw new Error('Model pull failed')
        if (item.total > 1000000 && Number.isFinite(item.completed)) {
          const percent = Math.floor(item.completed * 100 / item.total)
          if (percent >= progress + 25) { console.log(`Model download: ${percent}%`); progress = percent }
        }
        if (item.status === 'success') success = true
      }
    }
    assert.equal(success, true)
    const [family, tag] = pins.model.split(':')
    const manifestPath = path.join(models, 'manifests/registry.ollama.ai/library', family, tag)
    assert.equal(await hash(manifestPath), pins.manifestSha256)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    for (const layer of [manifest.config, ...manifest.layers]) {
      assert.match(layer.digest, /^sha256:[a-f0-9]{64}$/)
      assert.equal(await hash(path.join(models, 'blobs', layer.digest.replace(':', '-'))), layer.digest.slice(7))
    }
    assert.ok((await fs.readFile(path.join(models, 'blobs', 'sha256-' + pins.licenseDigest), 'utf8')).includes('Apache License'))
    console.log('Pinned model manifest, every blob hash and full Apache-2.0 notice verified.')
    const detailResponse = await fetch(baseUrl + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: pins.model }), signal: AbortSignal.timeout(10000), redirect: 'error' })
    assert.equal(detailResponse.ok, true)
    const details = await detailResponse.json()
    console.log('Verified model metadata: ' + JSON.stringify({ tools: details.capabilities?.includes('tools'), declaredContextTokens: details.model_info?.['qwen2.context_length'] ?? null }))
    if (process.argv.includes('--diagnose')) globalThis.fetch = async (url, options) => {
      const response = await originalFetch(url, options)
      if (String(url) === baseUrl + '/api/chat' && JSON.parse(options.body).tools) {
        const payload = await response.clone().json()
        console.log('Synthetic local tool diagnostic: ' + JSON.stringify({ done: payload.done, reason: payload.done_reason, message: payload.message }).slice(0, 2000))
      }
      return response
    }
    const ollama = createOllamaClient({ baseUrl })
    service = createProviderService({ directory: path.join(stateRoot, 'providers'), ollama,
      encryption: { isAsyncEncryptionAvailable: async () => false }, chatGPT: { status: async () => ({ signedIn: false }) } })
    assert.ok((await service.models('ollama')).some(model => model.id === pins.model))
    if (process.argv.includes('--learning-only')) {
      const { createLearning } = require('../electron/learning.cjs')
      const { createPersonalityStore, personalityPrompt } = require('../electron/personality.cjs')
      const persona = createPersonalityStore(path.join(stateRoot, 'personality.json'))
      await persona.save({ enabled: true, name: 'NAJD', instructions: 'When the user asks for the voice proof, reply with exactly NAJD-VOICE-READY and nothing else.' })
      const voice = await service.chat({ provider: 'ollama', modelName: pins.model, systemPrompt: personalityPrompt(await persona.get()),
        history: [{ role: 'user', text: 'Give me the voice proof.' }] })
      assert.match(voice.text, /^\s*NAJD-VOICE-READY[.!]?\s*$/)
      const learning = createLearning({ directory: path.join(stateRoot, 'learning') })
      try {
        await learning.setSettings({ mode: 'preferences', sharePreferences: true })
        await learning.review({ text: 'I prefer short answers.', provider: 'ollama', modelName: pins.model })
        const learned = await learning.list()
        assert.equal(learned.approved.preference.length, 1, 'Local preference capture failed: ' + JSON.stringify(learned))
        await learning.setSettings({ mode: 'review', sharePreferences: true, shareExperiences: true })
        await learning.review({ text: 'Workflow lesson: verify build results before reporting success.' })
        await learning.accept('experience', (await learning.list()).pending.experience[0].id)
        const reopened = createLearning({ directory: path.join(stateRoot, 'learning') })
        const context = await reopened.context()
        assert.ok(context.includes('I prefer short answers.'))
        const recalled = await service.chat({ provider: 'ollama', modelName: pins.model, systemPrompt: context,
          history: [{ role: 'user', text: 'What reply length do I prefer? Reply with one English word.' }] })
        assert.match(recalled.text, /\b(short|concise|brief)\b/i)
        const lessonContext = await reopened.context('Verify build results before reporting success')
        assert.ok(lessonContext.includes('Workflow lesson: verify build results'))
        const lessonRecall = await service.chat({ provider: 'ollama', modelName: pins.model, systemPrompt: lessonContext,
          history: [{ role: 'user', text: 'In the saved workflow lesson, what two words follow verify? Reply with those two English words only.' }] })
        assert.match(lessonRecall.text, /\bbuild\s+results\b/i)
        await reopened.remove('preference', learned.approved.preference[0].id)
        assert.equal(await reopened.context(), undefined)
        await reopened.remove('experience', (await reopened.list()).approved.experience[0].id)
        assert.equal(await reopened.context('Verify build results'), undefined)
        assert.equal((await service.limits()).cloudAttempts, 0)
        console.log('PASS: real local personality, local preference/lesson capture, restart, new-turn preference and related approved lesson recall, deletion; zero cloud attempts or device effects.')
      } finally { await learning.cancel() }
      return
    }
    const history = [{ role: 'user', text: 'Calculate 17 + 25. Reply with the number only.' }]
    const first = await service.chat({ provider: 'ollama', modelName: pins.model, history })
    assert.match(first.text, /42/)
    history.push({ role: 'assistant', text: first.text }, { role: 'user', text: 'Add one to your previous result. Reply with the number only.' })
    assert.match((await service.chat({ provider: 'ollama', modelName: pins.model, history })).text, /43/)
    console.log('PASS: real local two-turn conversation retained the prior numeric result.')
    if (process.argv.includes('--hermes')) {
      const { createHermesAdapter } = require('../electron/hermes.cjs')
      const { createEngineRouter } = require('../electron/engine-router.cjs')
      const hermes = createHermesAdapter({ root, stateRoot: path.join(stateRoot, 'hermes-tasks'), chat: request => service.chat(request) })
      let effects = 0
      const hermesCore = createNajdCore({ model: createEngineRouter({ hermes, chat: request => service.chat(request) }), tool: async () => { effects++ } })
      try {
        const task = hermesCore.startTask({ intentId: randomUUID(), provider: 'ollama', modelName: pins.model,
          text: '/hermes Calculate 17 + 25. Reply with the number only.' })
        let state
        for (let attempt = 0; attempt < 1200; attempt++) {
          state = hermesCore.getTask(task.id)
          if (!['QUEUED', 'RUNNING'].includes(state.state)) break
          await pause(100)
        }
        assert.equal(state.state, 'COMPLETED', state.errorCode)
        assert.match(state.output, /^\s*42\s*[.!]?\s*$/)
        assert.equal(effects, 0)
        assert.equal((await service.limits()).cloudAttempts, 0)
        console.log('PASS: real Hermes AIAgent -> NAJD provider policy -> private pinned Ollama/Qwen -> core completion, zero device effects/cloud attempts.')
      } finally { await hermes.stop() }
    }
    const fixture = path.join(stateRoot, 'proof.txt')
    await fs.writeFile(fixture, 'NAJD REAL MODEL TOOL PROOF')
    let reads = 0
    const fileTool = createFileTool({ getRoots: () => [stateRoot] })
    const core = createNajdCore({ model: request => service.chat(request), tool: request => { reads++; return fileTool(request) } })
    const task = core.startTask({ provider: 'ollama', modelName: pins.model, intentId: randomUUID(), text: '/ask-read ' + fixture })
    let snapshot
    for (let attempt = 0; attempt < 1200; attempt++) { snapshot = core.getTask(task.id); if (!['QUEUED', 'RUNNING'].includes(snapshot.state)) break; await pause(100) }
    assert.equal(snapshot.state, 'WAITING_APPROVAL', `Real model proposal failed: ${snapshot.errorCode}`)
    assert.equal(reads, 0)
    assert.equal(snapshot.proposedInput.path, fixture)
    core.respondApproval(snapshot.approvalId, 'ALLOW_ONCE')
    for (let attempt = 0; attempt < 100; attempt++) { snapshot = core.getTask(task.id); if (snapshot.state === 'COMPLETED') break; await pause(10) }
    assert.equal(snapshot.output, 'NAJD REAL MODEL TOOL PROOF')
    assert.equal(reads, 1)
    assert.equal((await service.limits()).cloudAttempts, 0)
    console.log('PASS: real local two-turn inference and exact-file model proposal, independent approval and real bounded file read; zero cloud attempts.')
    if (process.argv.includes('--desktop')) await execute(process.execPath, [path.join(__dirname, 'electron-ui-smoke.cjs'), '--local-real'], {
      cwd: root, env: { ...process.env, NAJD_REAL_OLLAMA_URL: baseUrl, NAJD_REAL_OLLAMA_MODEL: pins.model }, windowsHide: true, timeout: 300000, maxBuffer: 65536
    }).then(result => console.log(result.stdout.trim()))
  } finally {
    globalThis.fetch = originalFetch
    service?.dispose()
    if (child && !exited) await execute(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => {})
    for (let attempt = 0; child && !exited && attempt < 50; attempt++) await pause(100)
    if (child) assert.equal(exited, true, 'Owned server did not exit')
    if (!stateRoot.startsWith(runtimeRoot + path.sep) || !path.basename(stateRoot).startsWith('ollama-proof-')) throw new Error('Unsafe proof cleanup root')
    await fs.rm(stateRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
