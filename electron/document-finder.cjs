const fs = require('node:fs/promises')
const path = require('node:path')
const { contains, isSensitiveName } = require('./file-tools.cjs')
const extensions = new Set(['.txt', '.md', '.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.rtf', '.odt'])
const fail = code => { throw Object.assign(new Error(code), { code }) }

function createDocumentFinder({ getRoots, getProtectedRoots = () => [], audit } = {}) {
  return async ({ input, signal } = {}) => {
    let directory = typeof input?.path === 'string' ? input.path.trim() : ''
    const query = typeof input?.query === 'string' ? input.query.trim() : ''
    try {
      if (!path.isAbsolute(directory) || directory.length > 1024 || !query || query.length > 80 || /[\x00-\x1f|]/.test(query)) fail('INVALID_INPUT')
      directory = path.resolve(directory)
      const check = () => {
        if (signal?.aborted) fail('CANCELLED')
        const roots = getRoots?.()
        if (!Array.isArray(roots) || !roots.length) fail('NO_ROOTS')
        if (!roots.some(root => typeof root === 'string' && path.isAbsolute(root) && contains(root, directory))) fail('PATH_NOT_ALLOWED')
        return roots
      }
      const root = check().find(root => contains(root, directory))
      const realRoot = await fs.realpath(root)
      const target = await fs.realpath(directory)
      if (!contains(realRoot, target)) fail('PATH_NOT_ALLOWED')
      if (path.relative(realRoot, target).split(path.sep).some(part => part.startsWith('.') || isSensitiveName(part))) fail('SENSITIVE_FILE')
      if (!(await fs.stat(target)).isDirectory()) fail('INVALID_INPUT')
      const protectedRoots = getProtectedRoots()
      if (!Array.isArray(protectedRoots)) fail('SENSITIVE_FILE')
      const protectedPaths = []
      for (const item of protectedRoots) {
        if (typeof item !== 'string' || !path.isAbsolute(item)) fail('SENSITIVE_FILE')
        protectedPaths.push(path.resolve(item))
        try { protectedPaths.push(await fs.realpath(item)) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      const protectedPath = value => protectedPaths.some(root => contains(root, value))
      if (protectedPath(directory) || protectedPath(target)) fail('SENSITIVE_FILE')
      const paths = []
      let visited = 0, limited = false
      const walk = async (current, depth) => {
        check()
        // Do not traverse reparse-point directories below the granted root.
        if ((await fs.lstat(current)).isSymbolicLink()) fail('PATH_NOT_ALLOWED')
        const before = await fs.realpath(current)
        if (!contains(realRoot, before) || protectedPath(before)) fail('PATH_NOT_ALLOWED')
        const handle = await fs.opendir(current)
        for await (const entry of handle) {
          check()
          if (++visited > 1000 || paths.length >= 12) { limited = true; break }
          if (entry.isSymbolicLink() || entry.name.startsWith('.') || isSensitiveName(entry.name) || ['node_modules', '$RECYCLE.BIN'].includes(entry.name)) continue
          const candidate = path.join(current, entry.name)
          if (candidate.length > 1024 || protectedPath(candidate)) continue
          if (entry.isDirectory()) {
            if (depth >= 3) { limited = true; continue }
            try { await walk(candidate, depth + 1) }
            catch (error) { if (['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) limited = true; else throw error }
          } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && entry.name.toLowerCase().includes(query.toLowerCase())) {
            const realFile = await fs.realpath(candidate)
            if (contains(realRoot, realFile) && !protectedPath(realFile)) paths.push(candidate)
          }
        }
        if (await fs.realpath(current) !== before) fail('PATH_NOT_ALLOWED')
      }
      await walk(target, 0)
      check()
      try { audit?.record({ action: 'find-documents', decision: 'allowed', path: directory }) } catch { /* Logging cannot break the tool. */ }
      return JSON.stringify({ paths, limited })
    } catch (error) {
      const code = ['INVALID_INPUT', 'CANCELLED', 'NO_ROOTS', 'PATH_NOT_ALLOWED', 'SENSITIVE_FILE'].includes(error.code) ? error.code : 'READ_FAILED'
      try { audit?.record({ action: 'find-documents', decision: 'denied', path: directory, reason: code }) } catch { /* Logging cannot grant access. */ }
      fail(code)
    }
  }
}
module.exports = { createDocumentFinder }
