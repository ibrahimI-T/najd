// Reload after a NAJD update without the owner pressing Reload. The extension is loaded unpacked from NAJD's own folder, which every NAJD
// update rewrites; the browser keeps running the old code until the extension is reloaded (owner's Chrome stayed on 2.2.0 and Edge on 2.3.0
// for a day while NAJD shipped 2.8.0, 2026-11-14). An unpacked extension reads its files from that folder, so its manifest there shows
// the version waiting; when it is newer than the running one and nothing is in progress, the extension reloads itself into it.
// A store install reads its own packaged manifest, which always matches, so this never fires there.

const parts = value => (typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null)

// true only when `waiting` is a strictly newer x.y.z than `running`.
export function isNewer(waiting, running) {
  const a = parts(waiting), b = parts(running)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

// 'current' | 'unreadable' | 'waiting' (newer, but something is in progress) | 'reloading'
export async function checkSelfUpdate({ busy = async () => false, read = defaultRead, running = () => chrome.runtime.getManifest().version, reload = () => chrome.runtime.reload() } = {}) {
  let waiting
  try { waiting = await read() } catch { return 'unreadable' }
  if (!isNewer(waiting, running())) return 'current'
  if (await busy()) return 'waiting'
  reload()
  return 'reloading'
}

async function defaultRead() {
  const response = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })
  return (await response.json()).version
}
