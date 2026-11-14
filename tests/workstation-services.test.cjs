// Workstation main-process services with isolated folders and fixtures: catalog/seed coverage and separated states, the package pipeline,
// Task Center schedules and restart behavior, Remote Control pairing and scopes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { zipSync } = require('fflate')
const seed = require('../electron/workstation/seed.cjs')
const inventory = require('../docs/NAJD_CAPABILITY_CATALOG.json')
const { createWorkstationCatalog, normalizeSource } = require('../electron/workstation/catalog.cjs')
const { createWorkstationPackages, payloadDigest } = require('../electron/workstation/packages.cjs')
const { createLocalPackageImporter } = require('../electron/workstation/local-package-importer.cjs')
const { createOfficialCompatibleMarket, OFFICIAL_MARKET_URL } = require('../electron/workstation/official-market.cjs')
const { createTaskCenter, nextCron, parseCron } = require('../electron/workstation/task-center.cjs')
const { createRemoteControl } = require('../electron/workstation/remote-control.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-ws-services-'))
const enc = text => new TextEncoder().encode(text)

test('the seed names every inventoried capability exactly once', () => {
  const ids = seed.entries.map(entry => entry.id)
  assert.equal(new Set(ids).size, ids.length)
  const all = [...inventory.builtinSkills, ...inventory.installedSkills, ...inventory.productionSkillFamilies, ...inventory.gatewaySkills, ...inventory.managedPlugins.map(item => item.id), ...inventory.extensionFamilies, ...inventory.hooks, ...inventory.marketplaceSeedIds]
  assert.deepEqual([...new Set(all)].filter(id => !ids.includes(id)), [])
  for (const { id, version } of inventory.managedPlugins) assert.equal(seed.entries.find(entry => entry.id === id).version, version)
})

test('catalog keeps visibility, installation and readiness apart and never claims readiness without a passing check', async () => {
  const catalog = createWorkstationCatalog({ directory: tmp(), probes: async () => ({ office: { installed: true, ready: false, reason: 'PACK_CHECK_FAILED' }, scheduler: { ready: true } }) })
  const { entries, state } = await catalog.list()
  const get = id => entries.find(entry => entry.id === id)
  assert.equal(state, 'no-source')
  assert.equal(get('najd-automation').state, 'AVAILABLE')
  assert.equal(get('najd-canvas').state, 'NOT_READY')
  assert.equal(get('najd-word').state, 'NOT_READY')
  assert.equal(get('najd-word').reason, 'PACK_CHECK_FAILED')
  assert.equal(get('najd-imf').state, 'NOT_INSTALLED')
  assert.equal(get('copywriting').installable, false)
  assert.ok(get('najd-word').categories.includes('installed'))
  assert.ok(!get('najd-imf').categories.includes('installed'))
})

test('installed packages stay manageable regardless of catalog layer and local packages can be reinstalled after removal', async () => {
  const packages = { list: async () => [{ id: 'najd-github', version: '0.1.14', enabled: true, ready: true, displayName: 'GitHub', description: 'GitHub tools', publisher: { name: 'NAJD' }, permissions: [] }] }
  const localPackages = { discover: async () => [
    { id: 'najd-github', version: '0.1.14', displayName: 'GitHub', description: 'GitHub tools', publisher: { name: 'NAJD' }, license: { spdx: 'MIT' }, categories: ['developer-tools'], skills: ['najd-github'] },
    { id: 'najd-word', version: '0.4.12', displayName: 'Word', description: 'Word tools', publisher: { name: 'NAJD' }, license: { spdx: 'MIT' }, categories: ['productivity'], skills: ['najd-word'] }
  ] }
  const catalog = createWorkstationCatalog({ directory: tmp(), packages, localPackages, probes: async () => ({}) })
  const { entries } = await catalog.list()
  const github = entries.find(entry => entry.id === 'najd-github'), word = entries.find(entry => entry.id === 'najd-word')
  assert.equal(github.layer, 'managed')
  assert.equal(github.packageInstalled, true)
  assert.equal(github.manageable, true)
  assert.equal(word.packageInstalled, false)
  assert.equal(word.localImportable, true)
  assert.equal(word.installable, true)
})

test('a remote registry is read to the last page, replaces the fixture and cannot grant permissions', async () => {
  const pages = { featured: [[{ id: 'copywriting', version: '2.0.0', displayName: 'Copy', permissions: [{ id: 'desktop' }] }, { id: 'extra-one', version: '1.0.0' }], [{ id: 'extra-two', version: '1.0.0' }]] }
  const fetchImpl = async url => { const list = pages[url.searchParams.get('category')] || [[]]; const index = Number(url.searchParams.get('cursor') || 0); return { ok: true, text: async () => JSON.stringify({ items: list[index], nextCursor: index + 1 < list.length ? String(index + 1) : null }) } }
  const catalog = createWorkstationCatalog({ directory: tmp(), fetchImpl })
  await catalog.addSource('https://registry.example/v1')
  const result = await catalog.sync()
  assert.equal(result.state, 'online')
  assert.ok(result.pagesRead >= 14)
  assert.ok(result.entries.some(entry => entry.id === 'extra-two'))
  const copy = result.entries.filter(entry => entry.id === 'copywriting')
  assert.equal(copy.length, 1); assert.equal(copy[0].version, '2.0.0'); assert.deepEqual(copy[0].permissions, [])
  assert.throws(() => normalizeSource('http://example.com'), { code: 'REGISTRY_SOURCE_INVALID' })
  assert.throws(() => normalizeSource('https://user:pass@example.com'), { code: 'REGISTRY_SOURCE_INVALID' })
})

function packageBytes({ version = '1.0.0', id = 'my-pack', extra = {}, mutate = manifest => manifest } = {}) {
  const files = { 'skills/hello/SKILL.md': enc('# Hello ' + version), ...extra }
  const manifest = mutate({ schemaVersion: 1, id, displayName: 'My pack', version, publisher: { name: 'Owner' }, description: 'Test', categories: ['personal'], skills: ['skills/hello'], permissions: [], dependencies: [], compatibility: { os: ['win32', 'linux', 'darwin'], arch: ['x64', 'arm64'], minNajd: '0.1.0' }, integrity: { sha256: payloadDigest(files) }, license: { spdx: 'MIT' } })
  return zipSync({ ...files, 'najd-package.json': enc(JSON.stringify(manifest)) })
}

test('package install, update, disable, rollback and remove work without a restart', async () => {
  const packages = createWorkstationPackages({ directory: tmp(), appVersion: '0.10.20' })
  const plan = await packages.planFromBytes(packageBytes(), 'file:a')
  assert.equal(plan.currentVersion, null)
  assert.equal((await packages.install(plan.planId)).version, '1.0.0')
  await assert.rejects(packages.install(plan.planId), { code: 'PLAN_EXPIRED' })
  assert.equal((await packages.skills()).length, 1)
  await packages.install((await packages.planFromBytes(packageBytes({ version: '1.1.0' }), 'file:b')).planId)
  assert.equal((await packages.list())[0].previousVersion, '1.0.0')
  await packages.setEnabled('my-pack', false)
  assert.equal((await packages.skills()).length, 0)
  await packages.setEnabled('my-pack', true)
  assert.equal((await packages.rollback('my-pack')).version, '1.0.0')
  assert.equal(await packages.remove('my-pack'), true)
  assert.deepEqual(await packages.list(), [])
})

test('package lifecycle awaits owned-service shutdown and retains state when shutdown fails', async () => {
  const events = []; let rejectShutdown = false
  const packages = createWorkstationPackages({ directory: tmp(), appVersion: '0.10.22', beforeChange: async (id, action) => { events.push([id, action]); if (rejectShutdown) throw Error('SERVICE_STOP_FAILED') } })
  await packages.install((await packages.planFromBytes(packageBytes(), 'fixture')).planId)
  await packages.setEnabled('my-pack', false)
  assert.equal((await packages.skills()).length, 0)
  await packages.setEnabled('my-pack', true)
  rejectShutdown = true
  await assert.rejects(packages.remove('my-pack'), /SERVICE_STOP_FAILED/)
  assert.equal((await packages.list()).length, 1)
  rejectShutdown = false
  await packages.remove('my-pack')
  assert.deepEqual(events.map(row => row[1]), ['disable', 'enable', 'remove', 'remove'])
})

test('tampered, undeclared-executable, unsafe and failing packages are refused and leave nothing installed', async () => {
  const dir = tmp()
  let healthy = false
  const packages = createWorkstationPackages({ directory: dir, appVersion: '0.10.20', health: async () => ({ ok: healthy }) })
  await assert.rejects(packages.planFromBytes(packageBytes({ mutate: m => ({ ...m, integrity: { sha256: 'a'.repeat(64) } }) }), 'x'), { code: 'PACKAGE_DIGEST_MISMATCH' })
  await assert.rejects(packages.planFromBytes(packageBytes({ extra: { 'bin/run.exe': enc('MZ') } }), 'x'), { code: 'PACKAGE_UNDECLARED_EXECUTABLE' })
  await assert.rejects(packages.planFromBytes(zipSync({ '../evil.txt': enc('x'), 'najd-package.json': enc('{}') }), 'x'), { code: 'PACKAGE_ARCHIVE_INVALID' })
  await assert.rejects(packages.planFromBytes(packageBytes({ mutate: m => ({ ...m, compatibility: { ...m.compatibility, minNajd: '99.0.0' } }) }), 'x'), { code: 'PACKAGE_INCOMPATIBLE' })
  await assert.rejects(packages.planFromBytes(packageBytes(), 'x', 'b'.repeat(64)), { code: 'PACKAGE_DIGEST_MISMATCH' })
  await assert.rejects(packages.planFromUrl('https://x.example/a.zip'), { code: 'PACKAGE_DIGEST_REQUIRED' })
  const plan = await packages.planFromBytes(packageBytes(), 'x')
  await assert.rejects(packages.install(plan.planId), { code: 'PACKAGE_HEALTH_FAILED' })
  assert.deepEqual(await packages.list(), [])
  assert.deepEqual(fs.readdirSync(path.join(dir, 'staging')), [])
})

test('local workstation packages are discovered, rebranded for NAJD and installed through the verified package pipeline', async () => {
  const source = tmp(), plugin = path.join(source, 'plugin-packages', 'kimi-cu-win')
  fs.mkdirSync(path.join(plugin, 'skills', 'kimi-cu'), { recursive: true })
  fs.writeFileSync(path.join(plugin, 'kimi.plugin.json'), JSON.stringify({ name: 'kimi-cu-win', version: '0.3.13', license: 'Proprietary', skills: './skills/', interface: { displayName: 'Kimi Computer Use for Windows', shortDescription: 'Kimi desktop control', developerName: 'Source vendor' } }))
  fs.writeFileSync(path.join(plugin, 'skills', 'kimi-cu', 'SKILL.md'), '---\nname: kimi-cu\ndescription: Control the Kimi desktop.\n---\n# Kimi Computer Use\nUse the win MCP tool.')
  fs.writeFileSync(path.join(plugin, 'skills', 'kimi-cu', 'helper.js'), 'module.exports = true')
  fs.writeFileSync(path.join(source, 'config.json'), JSON.stringify({ token: 'must-not-be-imported' }))

  const packages = createWorkstationPackages({ directory: tmp(), appVersion: '0.10.21' })
  const importer = createLocalPackageImporter({ roots: [source], packages })
  const discovered = await importer.discover()
  assert.equal(discovered.length, 1)
  assert.equal(discovered[0].id, 'najd-computer-use-windows')
  assert.equal(discovered[0].displayName, 'NAJD Computer Use for Windows')
  assert.equal(discovered[0].license.spdx, 'LicenseRef-Local-Source')

  const planned = await importer.plan(['najd-computer-use-windows'])
  assert.equal(planned.packages.length, 1)
  assert.equal(planned.packages[0].id, 'najd-computer-use-windows')
  const installed = await importer.install(planned.planId)
  assert.equal(installed.installed.length, 1)
  assert.equal((await packages.list())[0].id, 'najd-computer-use-windows')
  const [skill] = await packages.skillRows()
  assert.equal(skill.id, 'najd-computer-use')
  const body = (await packages.readSkill(skill.id)).text
  assert.match(body, /NAJD Computer Use/)
  assert.doesNotMatch(body, /\bKimi\b/i)
  assert.match(body, /najd_desktop_windows/)
  assert.ok(!body.includes('must-not-be-imported'))
})

test('the official compatible market is a default paginated source with verified install metadata and NAJD branding', async () => {
  const fetchImpl = async url => {
    assert.equal(String(url), OFFICIAL_MARKET_URL)
    return new Response(JSON.stringify({ plugins: [
      { id: 'kimi-cu-win', displayName: 'Kimi Computer Use for Windows', version: '0.3.13', description: 'Kimi desktop control', source: 'https://packages.example/cu.zip', sha256sum: 'a'.repeat(64), platforms: ['windows'], clients: ['desktop'], distribution: { category: 'official' } },
      { id: 'mac-only', displayName: 'Mac only', version: '1.0.0', source: 'https://packages.example/mac.zip', sha256sum: 'b'.repeat(64), platforms: ['macos'] },
      { id: 'bad', displayName: 'Bad', version: '1.0.0', source: 'http://packages.example/bad.zip', sha256sum: 'nope', platforms: ['windows'] }
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const market = createOfficialCompatibleMarket({ directory: tmp(), fetchImpl, platform: 'win32' })
  const synced = await market.sync()
  assert.equal(synced.state, 'online')
  assert.equal(synced.entries.length, 1)
  assert.equal(synced.entries[0].id, 'najd-computer-use-windows')
  assert.equal(synced.entries[0].displayName, 'NAJD Computer Use for Windows')
  assert.equal(synced.entries[0].packageUrl, 'https://packages.example/cu.zip')
  assert.equal(synced.entries[0].sha256, 'a'.repeat(64))
  assert.equal(synced.entries[0].packageFormat, 'compatible-plugin')
  assert.deepEqual((await market.snapshot()).entries, synced.entries)
})

test('the workstation catalog merges the official compatible market into matching cards without duplicates', async () => {
  const marketEntry = { id: 'najd-computer-use-windows', version: '0.4.0', kind: 'plugin', displayName: 'NAJD Computer Use', description: 'Updated', publisher: { name: 'NAJD Official Compatible' }, categories: ['featured'], permissions: [], needs: [], packageUrl: 'https://packages.example/cu.zip', sha256: 'c'.repeat(64), packageFormat: 'compatible-plugin', source: OFFICIAL_MARKET_URL }
  const officialMarket = { snapshot: async () => ({ entries: [] }), sync: async () => ({ state: 'online', entries: [marketEntry], pagesRead: 1 }) }
  const catalog = createWorkstationCatalog({ directory: tmp(), officialMarket, probes: async () => ({ windows: { installed: false, ready: false, reason: 'WINDOWS_NODE_NOT_INSTALLED' } }) })
  const result = await catalog.sync()
  const matches = result.entries.filter(item => item.id === marketEntry.id)
  assert.equal(result.state, 'online')
  assert.deepEqual(result.sources, [OFFICIAL_MARKET_URL])
  assert.equal(matches.length, 1)
  assert.equal(matches[0].latestVersion, '0.4.0')
  assert.equal(matches[0].packageFormat, 'compatible-plugin')
  assert.equal(matches[0].installable, true, 'the package can be managed without pretending it makes the native Windows dependency ready')
  assert.equal(matches[0].state, 'NOT_INSTALLED')
})

test('a verified compatible marketplace archive is converted and installed without importing its foreign runtime', async () => {
  const sourceFiles = {
    'kimi.plugin.json': enc(JSON.stringify({ name: 'kimi-cu-win', version: '0.3.13', license: 'Proprietary', skills: './skills/', interface: { displayName: 'Kimi Computer Use for Windows', shortDescription: 'Desktop control' } })),
    'skills/kimi-cu/SKILL.md': enc('---\nname: kimi-cu\ndescription: Kimi desktop control\n---\nUse win MCP.'),
    'runtime/foreign.exe': enc('MZ')
  }
  const original = zipSync(sourceFiles), digest = require('node:crypto').createHash('sha256').update(original).digest('hex')
  const packageDirectory = tmp()
  const packages = createWorkstationPackages({ directory: packageDirectory, appVersion: '0.10.21', fetchImpl: async () => new Response(original) })
  const plan = await packages.planFromUrl('https://packages.example/cu.zip', digest, 'compatible-plugin')
  assert.equal(plan.id, 'najd-computer-use-windows')
  await packages.install(plan.planId)
  const body = (await packages.readSkill('najd-computer-use')).text
  assert.match(body, /najd_desktop_windows/)
  const state = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'packages.json'), 'utf8'))
  const folder = path.join(packageDirectory, 'installed', 'najd-computer-use-windows', '0.3.13')
  assert.equal(fs.existsSync(path.join(folder, 'runtime', 'foreign.exe')), false)
  assert.equal(state.packages['najd-computer-use-windows'].manifest.provenance.kind, 'compatible-market')
})

test('cron follows the time zone, skips a nonexistent time and does not run a repeated hour twice', () => {
  assert.throws(() => parseCron('61 * * * *'), { code: 'CRON_INVALID' })
  assert.throws(() => parseCron('* * *'), { code: 'CRON_INVALID' })
  const riyadh = nextCron('0 9 * * *', 'Asia/Riyadh', Date.parse('2026-11-07T00:00:00Z'))
  assert.equal(new Date(riyadh).toISOString(), '2026-11-07T06:00:00.000Z')
  // New York, 2026-03-08: 02:30 does not exist; the next match is the following day.
  assert.equal(new Date(nextCron('30 2 * * *', 'America/New_York', Date.parse('2026-03-08T05:00:00Z'))).toISOString(), '2026-03-09T06:30:00.000Z')
  // New York, 2026-11-01: 01:30 happens twice; the run at the first one is not followed by the second.
  const first = nextCron('30 1 * * *', 'America/New_York', Date.parse('2026-11-01T04:00:00Z'))
  assert.equal(new Date(first).toISOString(), '2026-11-01T05:30:00.000Z')
  assert.equal(new Date(nextCron('30 1 * * *', 'America/New_York', first)).toISOString(), '2026-11-02T06:30:00.000Z')
})

test('a scheduled task survives a restart, records its result and an interrupted run is never replayed', async () => {
  const dir = tmp(); let time = Date.parse('2026-11-07T00:00:00Z'); const executed = []
  const make = execute => createTaskCenter({ directory: dir, execute, now: () => time, setTimer: () => 0, clearTimer: () => {} })
  let center = make(async item => { executed.push(item.id); return { state: 'COMPLETED', output: 'done' } })
  await center.start()
  const item = await center.create({ title: 'Brief', prompt: 'Summarize', schedule: { kind: 'interval', minutes: 10 } })
  center.stop()
  center = make(async entry => { executed.push(entry.id); return { state: 'COMPLETED', output: 'done' } }) // a new process
  await center.start()
  time += 11 * 60000
  await center.tick()
  await new Promise(resolve => setTimeout(resolve, 30))
  let [saved] = await center.list()
  assert.deepEqual(executed, [item.id])
  assert.equal(saved.runs[0].state, 'COMPLETED'); assert.equal(saved.runs[0].output, 'done')
  center.stop()
  // A run cut off by a crash: recorded as interrupted at the next start, not started again.
  const hung = make(() => new Promise(() => {}))
  await hung.start(); await hung.runNow(item.id); hung.stop()
  center = make(async () => { throw new Error('must not run') })
  await center.start()
  ;[saved] = await center.list()
  assert.equal(saved.runs[0].state, 'INTERRUPTED')
  center.stop()
})

test('remote pairing is one-time and scoped, revocation is immediate and tokens are not stored', async () => {
  const dir = tmp(); const received = []
  const remote = createRemoteControl({ directory: dir, handlers: { status: async () => ({ running: 0 }), instruct: async text => { received.push(text); return { accepted: true } }, resume: async () => ({ resumed: 0 }) } })
  await assert.rejects(remote.startPairing(['status']), { code: 'REMOTE_DISABLED' })
  const on = await remote.configure({ enabled: true })
  const base = 'http://127.0.0.1:' + on.port
  const post = (route, body, token) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
  try {
    const { pairing } = await remote.startPairing(['status'])
    assert.equal((await post('/api/pair', { code: '000000000' })).status, 403)
    const paired = await (await post('/api/pair', { code: pairing.code, name: 'Phone' })).json()
    assert.equal((await post('/api/pair', { code: pairing.code })).status, 403)
    const token = paired.token
    assert.equal((await fetch(base + '/api/status', { headers: { authorization: 'Bearer ' + token } })).status, 200)
    assert.equal((await fetch(base + '/api/status')).status, 401)
    assert.equal((await post('/api/instruct', { text: 'hi' }, token)).status, 403)
    assert.deepEqual(received, [])
    assert.equal((await fetch(base + '/api/resume', { method: 'POST', headers: { 'content-type': 'text/plain', authorization: 'Bearer ' + token }, body: '{}' })).status, 415)
    assert.ok(!fs.readFileSync(path.join(dir, 'remote-control.json'), 'utf8').includes(token))
    const status = await remote.status()
    assert.equal(status.devices.length, 1); assert.equal(status.devices[0].tokenHash, undefined)
    await remote.revoke(status.devices[0].id)
    assert.equal((await fetch(base + '/api/status', { headers: { authorization: 'Bearer ' + token } })).status, 401)
    assert.deepEqual((await remote.status()).audit.map(entry => entry.action).slice(0, 2), ['revoked', 'paired'])
  } finally { await remote.stop() }
})

test('a personal skill is saved as a verified package, appears on the skill surface and updates in place', async () => {
  const { personalSkillArchive, skillId } = require('../electron/workstation/personal-skill.cjs')
  const packages = createWorkstationPackages({ directory: tmp(), appVersion: '0.10.33' })
  const first = personalSkillArchive({ name: 'Weekly  report', description: 'Use when the user asks for the weekly status report.', steps: '1. Read the tasks with najd_workstation tasks_list.\n2. Summarize.' })
  assert.equal(first.id, 'my-weekly-report'); assert.equal(first.version, '1.0.0'); assert.equal(first.name, 'Weekly report')
  await packages.install((await packages.planFromBytes(first.bytes, 'personal:' + first.id)).planId)
  const rows = await packages.skillRows()
  assert.deepEqual(rows.map(row => row.id), ['my-weekly-report'])
  assert.match((await packages.readSkill('my-weekly-report')).text, /najd_workstation tasks_list/)
  const listed = (await packages.list()).find(item => item.id === 'my-weekly-report')
  assert.equal(listed.kind, 'skill'); assert.deepEqual(listed.permissions, [])
  const second = personalSkillArchive({ name: 'Weekly report', description: 'Use when the user asks for the weekly status report.', steps: '1. Read the tasks.\n2. Summarize in a table.' }, { currentVersion: listed.version })
  assert.equal(second.version, '1.0.1')
  await packages.install((await packages.planFromBytes(second.bytes, 'personal:' + second.id)).planId)
  assert.match((await packages.readSkill('my-weekly-report')).text, /in a table/)
  // Read back for editing in Settings: the purpose and the steps, without the front matter and the name heading.
  const { readPersonalSkill } = require('../electron/workstation/personal-skill.cjs')
  assert.deepEqual(readPersonalSkill((await packages.readSkill('my-weekly-report')).text, 'Weekly report'), { description: 'Use when the user asks for the weekly status report.', steps: '1. Read the tasks.\n2. Summarize in a table.' })
  assert.match(skillId('تقرير أسبوعي'), /^my-skill-[a-f0-9]{8}$/)
  // Names that share their Latin part stay apart; invisible direction marks are refused (review 2026-11-08).
  assert.notEqual(skillId('تقرير PDF'), skillId('ملخص PDF'))
  assert.match(skillId('تقرير PDF'), /^my-pdf-[a-f0-9]{8}$/)
  assert.notEqual(skillId('a'.repeat(41) + ' one'), skillId('a'.repeat(41) + ' two'))
  assert.throws(() => personalSkillArchive({ name: 'Safe‮evil', description: 'Use when the user asks for it.', steps: 'Step one and step two here.' }), /INVALID_INPUT/)
  assert.throws(() => personalSkillArchive({ name: 'x', description: 'short', steps: 'too short' }), /INVALID_INPUT/)
})
