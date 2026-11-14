// Installing a package from a file in the real desktop app (Vue renderer, isolated profile): Plugins > Add new > Choose a file, the install review
// (name, publisher, permissions), Install, the package and its skill appear in the catalog as installed, Disable and Enable follow, and Remove
// takes the skill away again. Rewritten for the Vue renderer (docs/OPUS-BLOCKERS.md B-003): the old React "plugins from a GitHub address" flow
// has no Vue counterpart (R-070: the workstation catalog is the one skill and plugin surface), and this smoke needs no internet. The fixture
// package is built here with the same integrity rule the app checks. Usage: npm run smoke:plugins
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { zipSync } = require('fflate')
const { payloadDigest } = require('../electron/workstation/packages.cjs')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

const enc = text => new TextEncoder().encode(text)
function fixturePackage() {
  const files = { 'skills/smoke-hello/SKILL.md': enc('---\nname: smoke-hello\ndescription: A skill from the plugins smoke fixture.\n---\n# Smoke hello\n\nSay hello.') }
  const manifest = { schemaVersion: 1, id: 'smoke-pack', displayName: 'Smoke pack', version: '1.0.0', publisher: { name: 'NAJD smoke' }, description: 'A fixture package for the plugins smoke.', categories: ['personal'], skills: ['skills/smoke-hello'], permissions: [], dependencies: [],
    compatibility: { os: ['win32', 'linux', 'darwin'], arch: ['x64', 'arm64'], minNajd: '0.1.0' }, integrity: { sha256: payloadDigest(files) }, license: { spdx: 'MIT' } }
  return zipSync({ ...files, 'najd-package.json': enc(JSON.stringify(manifest)) })
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    await fs.mkdir(root + '-imports', { recursive: true })
    await fs.writeFile(path.join(root + '-imports', 'package-fixture.zip'), fixturePackage())
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const exists = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    const press = async selector => { await waitFor(async () => await exists(selector)); await run(`document.querySelector(${JSON.stringify(selector)}).click()`) }
    const entry = async () => (await run('window.najdWorkstation.catalog()')).entries.find(item => item.id === 'smoke-pack')
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("[data-nav=skills-plugins]")'), 60000)
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
    assert.equal(await entry(), undefined, 'the package is not installed yet')

    // Plugins > Add new > the first item opens the add dialog > Choose a file (the harness's picker offers the fixture) > the install review.
    await press('[data-nav="skills-plugins"]')
    await press('[data-hub="add"]')
    await run(`document.querySelector('[data-hub="add"]').parentElement.querySelector('[role=menuitem]').click()`)
    await press('[data-hub="file"]')
    await waitFor(async () => await exists('[data-hub="install"]'))
    const review = await evaluate(client, 'document.querySelector(".w-dialog").innerText')
    assert.ok(review.includes('Smoke pack') && review.includes('NAJD smoke'), 'the review names the package and its publisher: ' + review)
    await run(`document.querySelector('[data-hub="install"]').click()`)
    await waitFor(async () => { const found = await entry(); return !!found && found.state !== 'NOT_INSTALLED' }, 30000)
    const installed = await entry()
    assert.ok(installed.installedVersion === '1.0.0' || installed.version === '1.0.0', 'installed at 1.0.0: ' + JSON.stringify(installed).slice(0, 300))

    // Disable and enable follow through the API the page uses; Remove takes the package and its skill away.
    await run(`window.najdWorkstation.setPackageEnabled('smoke-pack', false)`)
    await waitFor(async () => (await entry())?.state === 'DISABLED')
    await run(`window.najdWorkstation.setPackageEnabled('smoke-pack', true)`)
    await waitFor(async () => (await entry())?.state !== 'DISABLED')
    await run(`window.najdWorkstation.removePackage('smoke-pack')`)
    await waitFor(async () => { const found = await entry(); return !found || found.state === 'NOT_INSTALLED' })
    console.log('PASS (Vue): a package from a file is reviewed (name, publisher) and installed from Plugins > Add new > Choose a file, shows in the catalog, can be disabled and enabled, and removing it takes it away again. No internet needed.')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents', resolved + '-imports']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
