// The saved file access (folders, whole-computer choice) is loaded before the window opens and before any file-access
// answer (C60-01), and the sidebar's link opener only knows its three fixed addresses.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

test('C60-01: every file-access handler and the window wait for the saved access', () => {
  assert.match(main, /const fileAccessLoaded = loadFileAccess\(\)/)
  assert.doesNotMatch(main, /void loadFileAccess\(\)/)
  for (const channel of ['grantRoot', 'listRoots', 'revokeRoot', 'wholeComputer']) {
    const start = main.indexOf(`'najd:files:${channel}'`)
    assert.ok(start > 0, channel)
    assert.match(main.slice(start, start + 200), /await fileAccessLoaded/, channel)
  }
  assert.match(main, /fileAccessLoaded\.then\(\(\) => \{ if \(!quitting\) createWindow\(\) \}\)/)
  const startup = main.slice(main.indexOf('fileAccessLoaded.then'))
  assert.doesNotMatch(startup.slice(0, startup.indexOf("app.on('activate'")), /^\s*createWindow\(\)/m, 'no window before the load')
})

test('C61-01: before the saved access is read, no tool sees a readable root, whatever starts the task', () => {
  assert.match(main, /const readableRoots = \(\) => fileAccessReady \? .* : \[\]/)
  assert.match(main, /finally \{ fileAccessReady = true \}/)
  // Every file-reading tool takes its roots from readableRoots only.
  for (const factory of ['createFileTool', 'createDocumentFinder', 'createWorkspaceTools']) assert.match(main, new RegExp(factory + '\\(\\{ getRoots: readableRoots'), factory)
  assert.equal((main.match(/getRoots:/g) || []).length, 3)
})

test('C62-01: only a missing file takes the defaults; an unreadable or invalid one fails closed', async () => {
  // Run the real loader against fixture files with stand-ins for its module state.
  const source = main.slice(main.indexOf('async function loadFileAccess()'), main.indexOf('async function saveFileAccess()'))
  const fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'najd-file-access-')), file = path.join(root, 'file-access.json')
  const load = async () => {
    const state = new Function('fs', 'path', 'fileAccessPath', `let wholeComputer = true, fileAccessReady = false; const fileRoots = new Set()
      ${source}
      return loadFileAccess().then(() => ({ wholeComputer, ready: fileAccessReady, roots: [...fileRoots] }))`)
    return state(fsp, path, () => file)
  }
  try {
    assert.deepEqual(await load(), { wholeComputer: true, ready: true, roots: [] }, 'first run')
    await fsp.writeFile(file, JSON.stringify({ wholeComputer: false, roots: [root] }))
    assert.deepEqual(await load(), { wholeComputer: false, ready: true, roots: [path.resolve(root)] }, 'saved choice')
    await fsp.writeFile(file, JSON.stringify({ roots: [root] }))
    assert.equal((await load()).wholeComputer, true, 'a file from before the choice keeps the default')
    for (const bad of ['{"wholeComputer": fal', '[1]', 'null', '{"wholeComputer":"no","roots":[]}']) {
      await fsp.writeFile(file, bad)
      assert.deepEqual(await load(), { wholeComputer: false, ready: true, roots: [] }, bad)
      assert.equal(await fsp.readFile(file, 'utf8'), bad, 'left as it is')
    }
    await fsp.rm(file); await fsp.mkdir(file)
    assert.deepEqual(await load(), { wholeComputer: false, ready: true, roots: [] }, 'unreadable')
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
})

test('the community links open only fixed addresses', () => {
  assert.match(main, /const COMMUNITY_LINKS = \{ community: 'https:\/\/discord\.gg\/QAbYVEdcE', website: 'https:\/\/najdagent\.si', author: 'https:\/\/discord\.gg\/QAbYVEdcE' \}/)
  assert.match(main, /Object\.hasOwn\(COMMUNITY_LINKS, name\) \? shell\.openExternal\(COMMUNITY_LINKS\[name\]\)/)
})
