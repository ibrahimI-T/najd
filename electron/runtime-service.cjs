// Connects the main-owned runtime setup lifecycle to the application: fixed catalog
// location on the public binary release channel, fixed health probes, activation
// gated on idle work, and a status view the renderer can display. The renderer can
// only start, cancel or retry the fixed component set; it never supplies URLs or paths.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRuntimeSetup } = require('./runtime-setup.cjs')
const { fetchManifest } = require('./updates.cjs')
const { checkComponent } = require('./runtime-health.cjs')

// bundledEngine: the engine shipped inside the installer. When present it is the active
// core and nothing is downloaded; the signed catalog remains for later component updates.
function createRuntimeService({ root, updateConfig, runtimeConfig, appVersion, canActivate, fetchImpl = globalThis.fetch,
  getManifest, health = checkComponent, bundledEngine = null, bundleStatus = null, prepareBundle = null }) {
  const engineDirectory = () => typeof bundledEngine === 'function' ? bundledEngine() : bundledEngine
  // Runtime packs stay on their own release repository; app releases follow updateConfig.repo.
  const config = { publicKey: updateConfig.publicKey, owner: updateConfig.owner, repo: updateConfig.runtimeRepo || updateConfig.repo,
    channel: runtimeConfig.channel, catalogVersion: runtimeConfig.catalogVersion, appVersion }
  const url = `https://github.com/${config.owner}/${config.repo}/releases/download/runtime-v${config.catalogVersion}/najd-runtime.json`
  let notPublished = false
  const setup = createRuntimeSetup({ root, config, fetchImpl, health, canActivate,
    getManifest: async signal => {
      try { const raw = await (getManifest || (s => fetchManifest(url, fetchImpl, s)))(signal); notPublished = false; return raw }
      catch (error) { notPublished = error?.code === 'UPDATE_NOT_PUBLISHED'; throw error }
    } })
  async function active() {
    if (bundledEngine && !engineDirectory()) return null
    if (bundledEngine) return { generation: 'bundled', catalogVersion: 'bundled', components: [...runtimeConfig.components] }
    try {
      const value = JSON.parse(await fs.readFile(path.join(root, 'active.json'), 'utf8'))
      return { generation: value.generation, catalogVersion: value.catalogVersion, components: value.components }
    } catch { return null }
  }
  let last = null
  async function status() {
    const current = setup.status()
    if (bundledEngine) {
      const bundle = bundleStatus?.() || { state: engineDirectory() ? 'ready' : 'preparing' }
      return { ...current, state: bundle.state === 'ready' ? 'ready' : bundle.state === 'failed' ? 'failed' : 'preparing', error: bundle.error || null,
        component: bundle.component || null, downloaded: bundle.done || 0, total: bundle.total || 0, canCancel: false, bundled: true, notPublished: false, active: await active(),
        catalogVersion: config.catalogVersion, components: [...runtimeConfig.components] }
    }
    return { ...current, bundled: false, notPublished: current.state === 'failed' && notPublished, active: await active(),
      catalogVersion: config.catalogVersion, components: [...runtimeConfig.components] }
  }
  function prepare() {
    if (bundledEngine) { void prepareBundle?.().catch(() => {}); return status() }
    last = setup.prepare([...runtimeConfig.components])
    last.catch(() => {})
    return status()
  }
  // Directories of the active generation for internal engine adapters only.
  async function directories() {
    if (bundledEngine) { const directory = engineDirectory(); return directory ? { 'agent-core': directory } : null }
    const value = await active()
    if (!value || value.catalogVersion !== config.catalogVersion) return null
    return Object.fromEntries(value.components.map(id => [id, path.join(root, 'generations', value.generation, id)]))
  }
  return { status, prepare, cancel: () => setup.cancel(), shutdown: () => setup.shutdown(), busy: () => setup.hasActive(), directories,
    // First run: start automatically when nothing is active; failures are visible, never retried in a loop.
    autoStart: async () => { if (!bundledEngine && !(await active())) prepare() } }
}
module.exports = { createRuntimeService }
