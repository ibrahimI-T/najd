const { verifyManifest, verifyInstaller, newer, failure } = require('./update-manifest.cjs')

async function fetchManifest(url, fetchImpl = fetch, signal) {
  const response = await fetchImpl(url, { signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]), cache: 'no-store' })
  if (response.status === 404) throw failure('UPDATE_NOT_PUBLISHED')
  if (!response.ok) throw failure('UPDATE_UNAVAILABLE')
  let size = 0; const chunks = []
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 32768) throw failure('UPDATE_INVALID')
    chunks.push(chunk)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}

// The newest public release's version from the GitHub API. Used only when a release carries no signed manifest: NAJD then
// tells the user a newer version exists and opens the releases page; it never installs an unsigned file by itself.
async function fetchLatestVersion(url, fetchImpl = fetch, signal) {
  const response = await fetchImpl(url, { signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]), cache: 'no-store', headers: { accept: 'application/vnd.github+json' } })
  if (response.status === 404) throw failure('UPDATE_NOT_PUBLISHED')
  if (!response.ok) throw failure('UPDATE_UNAVAILABLE')
  let size = 0; const chunks = []
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 1024 * 1024) throw failure('UPDATE_INVALID')
    chunks.push(chunk)
  }
  let release
  try { release = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw failure('UPDATE_INVALID') }
  const match = typeof release?.tag_name === 'string' && /^v?(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(release.tag_name)
  if (!match || release.draft || release.prerelease) throw failure('UPDATE_NOT_PUBLISHED')
  newer(match[1], '0.0.0')
  return match[1]
}

function createUpdateService({ config, version, enabled, createUpdater, getManifest, getLatestVersion = null, notify = () => {}, beforeInstall = async () => {}, installationFailed = () => {} }) {
  let state = enabled ? 'idle' : 'disabled', record = null, percent = 0, errorCode = null, checkedAt = null
  let active = null, updater = null, cancellation = null, downloaded = null, epoch = 0, disposed = false, timer, checkAbort, notified = null
  // A new version is announced once (a Windows notification), however often the periodic check finds it again.
  function announce() { if (record?.version && record.version !== notified) { notified = record.version; try { notify({ version: record.version, manual: state === 'manual' }) } catch {} } }
  const status = () => ({ state, currentVersion: version, version: record?.version || null, notes: record?.notes || '', channel: config.channel, percent, errorCode, checkedAt })
  const publicErrors = new Set(['UPDATE_NOT_PUBLISHED','UPDATE_UNAVAILABLE','UPDATE_INVALID','UPDATE_SIGNATURE_INVALID','UPDATE_BUSY','UPDATE_CANCELLED'])
  function fail(error) { state = 'error'; errorCode = publicErrors.has(error?.code) ? error.code : 'UPDATE_UNAVAILABLE'; return status() }
  function adapter() {
    if (updater) return updater
    updater = createUpdater()
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false; updater.allowPrerelease = false
    updater.disableWebInstaller = true; updater.disableDifferentialDownload = false
    updater.logger = { info() {}, warn() {}, error() {}, debug() {} }
    updater.on('error', () => { if (state === 'installing') { fail(failure('UPDATE_UNAVAILABLE')); installationFailed() } })
    updater.on('download-progress', progress => {
      if (state !== 'downloading') return
      if (!Number.isFinite(progress.transferred) || progress.transferred > record.file.size) { cancellation?.cancel(); return }
      percent = Math.max(0, Math.min(100, Number(progress.percent) || 0))
    })
    return updater
  }
  function operation(work) {
    if (disposed || !enabled) return Promise.resolve(status())
    if (active || state === 'installing') return Promise.reject(failure('UPDATE_BUSY'))
    active = Promise.resolve().then(work).catch(fail).finally(() => { active = null })
    return active
  }
  function check() {
    if (['downloading', 'ready', 'installing'].includes(state)) return Promise.resolve(status())
    return operation(async () => {
      state = 'checking'; errorCode = null; percent = 0; downloaded = null
      const generation = epoch
      checkAbort = new AbortController()
      let raw
      try { raw = await getManifest(checkAbort.signal) }
      catch (error) {
        if (error?.code !== 'UPDATE_NOT_PUBLISHED' || !getLatestVersion) throw error
        // The latest release has no signed manifest: report a newer version for a manual install from the releases page.
        // A repository with no published release yet has nothing newer to offer.
        const latest = await getLatestVersion(checkAbort.signal).catch(inner => { if (inner?.code === 'UPDATE_NOT_PUBLISHED') return null; throw inner })
        if (disposed || generation !== epoch) return status()
        checkedAt = new Date().toISOString()
        if (latest === null || !newer(latest, version)) { record = null; state = 'current'; return status() }
        record = { version: latest, notes: '' }; state = 'manual'; announce()
        return status()
      }
      const candidate = verifyManifest(raw, config)
      if (disposed || generation !== epoch) return status()
      checkedAt = new Date().toISOString()
      if (!newer(candidate.version, version)) { record = null; state = 'current'; return status() }
      const result = await adapter().checkForUpdates()
      if (disposed || generation !== epoch) return status()
      const info = result?.updateInfo, file = info?.files?.[0]
      if (info?.version !== candidate.version || !Array.isArray(info.files) || info.files.length !== 1 || file.url !== candidate.file.name ||
          file.sha512 !== candidate.file.sha512 || file.size !== candidate.file.size) throw failure('UPDATE_SIGNATURE_INVALID')
      record = candidate; cancellation = result.cancellationToken; state = 'available'; announce()
      return status()
    })
  }
  function download() {
    if (state !== 'available' || !record) return Promise.reject(failure('UPDATE_INVALID'))
    return operation(async () => {
      state = 'downloading'; errorCode = null
      const generation = epoch
      const files = await adapter().downloadUpdate(cancellation)
      if (disposed || generation !== epoch) return status()
      if (!Array.isArray(files) || files.length !== 1 || typeof files[0] !== 'string') throw failure('UPDATE_INVALID')
      await verifyInstaller(files[0], record)
      downloaded = files[0]; percent = 100; state = 'ready'
      return status()
    })
  }
  async function cancel() {
    if (state !== 'downloading') return status()
    epoch++; cancellation?.cancel()
    await active
    downloaded = null; percent = 0; state = 'cancelled'; errorCode = 'UPDATE_CANCELLED'
    return status()
  }
  function install() {
    if (state !== 'ready' || !downloaded || !record) return Promise.reject(failure('UPDATE_INVALID'))
    return operation(async () => {
      await verifyInstaller(downloaded, record)
      await beforeInstall()
      state = 'installing'
      try { adapter().quitAndInstall(true, true) }
      catch (error) { installationFailed(); throw error }
      return status()
    })
  }
  function start() {
    if (!enabled || timer || disposed) return
    timer = setTimeout(async function poll() {
      if (!['checking', 'downloading', 'ready', 'installing'].includes(state)) await check().catch(() => {})
      if (!disposed) { timer = setTimeout(poll, 2 * 60 * 60 * 1000); timer.unref?.() }
    }, 30000)
    timer.unref?.()
  }
  async function dispose() { disposed = true; epoch++;clearTimeout(timer);checkAbort?.abort();cancellation?.cancel();await active }
  return { status, check, download, cancel, install, start, dispose }
}
module.exports = { createUpdateService, fetchManifest, fetchLatestVersion }
