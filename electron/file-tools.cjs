const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

function coreError(code) {
  return Object.assign(new Error(code), { code })
}

function isSensitiveName(basename) {
  const name = basename.toLowerCase()
  if (name === '.env' || name.startsWith('.env.')) return true
  if (name.startsWith('id_rsa') || name.startsWith('credentials')) return true
  return ['.pem', '.key', '.pfx', '.p12', '.kdbx'].some(extension => name.endsWith(extension))
}

function contains(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function createFileTool({ getRoots, getProtectedRoots = () => [], audit, maxBytes = 65536 } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) throw coreError('INVALID_INPUT')
  return async ({ name, input, signal } = {}) => {
    let requested = typeof input?.path === 'string' ? input.path.trim() : ''
    let resolved = requested
    const deny = code => {
      try { audit?.record({ action: 'read-file', decision: 'denied', path: resolved, reason: code }) } catch { /* audit must never break the tool */ }
      throw coreError(code)
    }
    try {
      if (signal?.aborted) deny('CANCELLED')
      if (name !== 'read-file') deny('INVALID_INPUT')
      if (!requested || requested.length > 1024) deny('INVALID_INPUT')
      const roots = typeof getRoots === 'function' ? getRoots() : []
      if (!Array.isArray(roots) || roots.length === 0) deny('NO_ROOTS')
      let match = null
      for (const root of roots) {
        if (typeof root !== 'string' || !path.isAbsolute(root)) continue
        const candidate = path.resolve(root, requested)
        if (!contains(root, candidate)) continue
        match = { root, candidate }
        break
      }
      if (!match) deny('PATH_NOT_ALLOWED')
      resolved = match.candidate
      // A Windows alternate data stream must not bypass basename checks.
      if (process.platform === 'win32' && path.relative(match.root, resolved).includes(':')) deny('SENSITIVE_FILE')
      let realCandidate = null
      try {
        const realRoot = fs.realpathSync(match.root)
        realCandidate = fs.realpathSync(match.candidate)
        if (!contains(realRoot, realCandidate)) realCandidate = null
      } catch { /* missing file: realpath fails; the read below reports READ_FAILED */ }
      if (realCandidate) resolved = realCandidate
      else if (fs.existsSync(match.candidate)) deny('PATH_NOT_ALLOWED')
      // Internal engine credentials cannot be read through a broad user folder grant.
      const protectedRoots = getProtectedRoots()
      if (!Array.isArray(protectedRoots)) deny('SENSITIVE_FILE')
      for (const protectedRoot of protectedRoots) {
        if (typeof protectedRoot !== 'string' || !path.isAbsolute(protectedRoot)) deny('SENSITIVE_FILE')
        let realProtected = protectedRoot
        try { realProtected = fs.realpathSync(protectedRoot) }
        catch (error) { if (error.code !== 'ENOENT') deny('SENSITIVE_FILE') }
        if (contains(realProtected, resolved)) deny('SENSITIVE_FILE')
      }
      if (isSensitiveName(path.basename(resolved))) deny('SENSITIVE_FILE')
      let handle
      let buffer
      try {
        handle = await fsp.open(resolved, 'r')
        const stats = await handle.stat()
        if (!stats.isFile()) deny('NOT_A_FILE')
        if (stats.size > maxBytes) deny('FILE_TOO_LARGE')
        const bounded = Buffer.alloc(maxBytes + 1)
        let size = 0
        while (size < bounded.length) {
          if (signal?.aborted) deny('CANCELLED')
          const { bytesRead } = await handle.read(bounded, size, bounded.length - size, size)
          if (!bytesRead) break
          size += bytesRead
        }
        if (size > maxBytes) deny('FILE_TOO_LARGE')
        buffer = bounded.subarray(0, size)
      } catch (error) {
        if (['NOT_A_FILE', 'FILE_TOO_LARGE', 'CANCELLED'].includes(error?.code)) throw error
        deny('READ_FAILED')
      } finally { if (handle) await handle.close().catch(() => {}) }
      if (signal?.aborted) deny('CANCELLED')
      if (buffer.includes(0)) deny('BINARY_FILE')
      let text
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
      catch { deny('BINARY_FILE') }
      try { audit?.record({ action: 'read-file', decision: 'allowed', path: resolved }) } catch { /* audit must never break the tool */ }
      return text
    } catch (error) {
      if (error?.code && /^[A-Z_]+$/.test(error.code)) throw error
      deny('READ_FAILED')
    }
  }
}

module.exports = { createFileTool, contains, isSensitiveName }
