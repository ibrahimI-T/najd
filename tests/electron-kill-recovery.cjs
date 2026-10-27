// T40 crash-recovery verification with real Windows safeStorage in isolated temporary app data.
// Phase A: kill the process inside the OS key-flush window; the next launch must fail closed
// (CREDENTIAL_UNAVAILABLE, record preserved) and recover through explicit re-entry/re-sign-in.
// Phase B: kill after the OS key reached disk; credentials must survive the forced kill.
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const electron = require('electron')
const harness = path.join(__dirname, 'electron-harness.cjs')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitForPage(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const pages = await response.json()
      const page = pages.find(item => item.type === 'page' && item.title === 'NAJD AGENT')
      if (page) return page
    } catch { /* Electron may still be starting. */ }
    await pause(100)
  }
  throw new Error('NAJD window did not open')
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
  })
  function send(method, params = {}) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  return { send, close: () => socket.close() }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error('Renderer evaluation failed: ' + JSON.stringify(result.exceptionDetails.exception))
  return result.result.value
}

async function launch(root) {
  const port = await freePort()
  const child = spawn(electron, [harness], {
    cwd: path.join(__dirname, '..'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, NAJD_TEST_USER_DATA: root, NAJD_TEST_DEBUG_PORT: String(port), NAJD_TEST_PACKAGED: '0' }
  })
  try {
    const page = await waitForPage(port)
    return { child, client: await connect(page.webSocketDebuggerUrl) }
  } catch (error) { child.kill(); throw error }
}

async function killTree(instance) {
  instance.client.close()
  try { execFileSync('taskkill', ['/pid', String(instance.child.pid), '/T', '/F'], { stdio: 'ignore' }) }
  catch { /* already gone */ }
  await pause(2000)
}

async function rmWithRetry(root) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { await fs.rm(root, { recursive: true, force: true }); return true }
    catch (error) { if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error; await pause(500) }
  }
  return false
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return
    await pause(100)
  }
  throw new Error('Timed out waiting for ' + label)
}

async function providerStatus(client, id) {
  const list = await evaluate(client, 'najdProviders.catalog()')
  return list.find(p => p.id === id)
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const dataDir = path.join(root, 'najd-data')
  let result
  try {
    // Phase A, first run: save an API key and complete a fixture ChatGPT sign-in, then kill
    // the whole tree inside the OS key-flush window (~10 s after first encryption).
    let instance = await launch(root)
    assert.equal(await evaluate(instance.client, 'najdKimi.saveKey("sk-kimi-kill-probe").then(() => 1)'), 1)
    await evaluate(instance.client, 'najdChatGPT.start()')
    await waitFor(async () => (await evaluate(instance.client, 'najdChatGPT.status()')).signedIn, 'fixture sign-in')
    await killTree(instance)

    // The credential records themselves survive on disk; only the OS key was lost.
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'credentials.json'), 'utf8')).version, 1)
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'chatgpt.json'), 'utf8')).version, 1)

    // Phase A, second run: fail closed, never silently overwrite, and expose recovery.
    instance = await launch(root)
    const lockedKimi = await providerStatus(instance.client, 'kimi-code')
    assert.equal(lockedKimi.configured, false)
    assert.equal(lockedKimi.errorCode, 'CREDENTIAL_UNAVAILABLE')
    const lockedChatGPT = await providerStatus(instance.client, 'chatgpt')
    assert.equal(lockedChatGPT.configured, false)
    assert.equal(lockedChatGPT.errorCode, 'CREDENTIAL_UNAVAILABLE')

    // Recovery: re-entering the key works immediately.
    assert.equal(await evaluate(instance.client, 'najdKimi.saveKey("sk-kimi-kill-probe").then(() => 1)'), 1)
    assert.equal((await providerStatus(instance.client, 'kimi-code')).configured, true)
    // Recovery: a fresh sign-in moves the unreadable record aside and completes.
    await evaluate(instance.client, 'najdChatGPT.start()')
    await waitFor(async () => (await evaluate(instance.client, 'najdChatGPT.status()')).signedIn, 'recovery sign-in')
    const backups = (await fs.readdir(dataDir)).filter(name => name.startsWith('chatgpt.json.unreadable-'))
    assert.equal(backups.length, 1, 'unreadable record must be preserved aside')
    const preserved = JSON.parse(await fs.readFile(path.join(dataDir, backups[0]), 'utf8'))
    assert.equal(preserved.version, 1)
    assert.equal(typeof preserved.encrypted, 'string')

    // Phase B: once the OS key has been flushed to disk, even a forced kill keeps credentials.
    await pause(20000)
    await killTree(instance)
    instance = await launch(root)
    const survivedKimi = await providerStatus(instance.client, 'kimi-code')
    assert.equal(survivedKimi.configured, true, 'key must survive a forced kill after OS key flush')
    const survivedChatGPT = await providerStatus(instance.client, 'chatgpt')
    assert.equal(survivedChatGPT.configured, true, 'ChatGPT session must survive a forced kill after OS key flush')
    await killTree(instance)

    result = 'Kill-recovery passed: in-window kill fails closed with record preserved and re-entry/sign-in recovery; post-flush kill keeps credentials'
  } catch (error) { result = error }
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup path')
  if (!await rmWithRetry(root)) console.warn('warning: temporary directory still locked, left for OS cleanup:', root)
  if (result instanceof Error) throw result
  console.log(result)
}

main()
  .then(() => process.exit(0))
  .catch(error => { console.error(error); process.exit(1) })
