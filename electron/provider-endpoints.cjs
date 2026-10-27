// Addresses the owner may change for OpenAI-compatible providers and local servers (another port, another computer on the network, a self-hosted gateway).
// Only the address is stored (no secrets). A plain-http address must point at this computer or a private network; anything public must use https.
const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const fail = code => Object.assign(new Error(code), { code })

function privateHost(host) {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name === '::1') return true
  if (/^fe80:/i.test(name) || /^f[cd][0-9a-f]{2}:/i.test(name)) return true
  const parts = name.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
}

// Returns the normalized address (no trailing slash) or throws INVALID_ENDPOINT.
function validateEndpoint(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw fail('INVALID_ENDPOINT')
  let url
  try { url = new URL(value.trim()) } catch { throw fail('INVALID_ENDPOINT') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw fail('INVALID_ENDPOINT')
  if (url.protocol === 'http:' && !privateHost(url.hostname)) throw fail('INVALID_ENDPOINT')
  return (url.origin + url.pathname).replace(/\/+$/, '')
}

function createEndpointStore({ filePath }) {
  let queue = Promise.resolve()
  async function read() {
    try { const value = JSON.parse(await fs.readFile(filePath, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
    catch (error) { if (error.code === 'ENOENT') return {}; throw fail('ENDPOINTS_UNAVAILABLE') }
  }
  return {
    all: () => queue.then(read),
    // An empty address removes the override (the default applies again).
    set(id, value) {
      const next = queue.then(async () => {
        if (!/^[a-z0-9-]{2,40}$/.test(id)) throw fail('INVALID_INPUT')
        const current = await read() // a corrupt file is never replaced implicitly
        const updated = { ...current }
        if (value === '' || value === null) delete updated[id]; else updated[id] = validateEndpoint(value)
        const temporary = `${filePath}.${randomUUID()}.tmp`
        try {
          await fs.mkdir(path.dirname(filePath), { recursive: true })
          await fs.writeFile(temporary, JSON.stringify(updated) + '\n', { flag: 'wx' })
          await replaceFile(temporary, filePath)
        } catch { throw fail('ENDPOINTS_UNAVAILABLE') } finally { await fs.unlink(temporary).catch(() => {}) }
        return updated[id] || null
      })
      queue = next.catch(() => {})
      return next
    }
  }
}
module.exports = { createEndpointStore, validateEndpoint, privateHost }
