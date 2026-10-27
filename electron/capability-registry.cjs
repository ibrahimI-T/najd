const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const catalog = require('./capability-catalog.json')
const error = code => Object.assign(new Error(code), { code })
const digest = entry => createHash('sha256').update(JSON.stringify(entry)).digest('hex')
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{2,63}$/.test(value)

function createCapabilityRegistry({ directory, core }) {
  if (!path.isAbsolute(directory || '') || !core) throw error('INVALID_INPUT')
  const filename = path.join(directory, 'registry.json'), bindings = new Map()
  let queue = Promise.resolve(), unavailable = false
  function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result }
  function entry(id) { const found = catalog.find(value => value.id === id); if (!found) throw error('INVALID_INPUT'); return found }
  function locked(row, definition) { return row?.version === definition.version && row.digest === digest(definition) }
  async function load() {
    if (unavailable) throw error('CAPABILITY_STORE_UNAVAILABLE')
    try {
      const stat = await fs.lstat(filename)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw error('CAPABILITY_STORE_UNAVAILABLE')
      const handle = await fs.open(filename, 'r')
      let bytes
      try {
        const buffer = Buffer.alloc(65537)
        const { bytesRead } = await handle.read(buffer)
        if (bytesRead > 65536) throw error('CAPABILITY_STORE_UNAVAILABLE')
        bytes = buffer.subarray(0, bytesRead)
      } finally { await handle.close() }
      const value = JSON.parse(bytes)
      if (!value || value.version !== 1 || Object.keys(value).sort().join(',') !== 'installed,version' ||
          !value.installed || typeof value.installed !== 'object' || Array.isArray(value.installed) || Object.keys(value.installed).length > 64 ||
          Object.entries(value.installed).some(([id, row]) => !validId(id) || !row || Object.keys(row).sort().join(',') !== 'digest,enabled,version' ||
            !/^\d+\.\d+\.\d+$/.test(row.version) || !/^[a-f0-9]{64}$/.test(row.digest) || typeof row.enabled !== 'boolean')) throw error('CAPABILITY_STORE_UNAVAILABLE')
      return value
    } catch (reason) {
      // Until the user changes something, NAJD's own built-in skills start installed and enabled; each run still asks for approval.
      if (reason.code === 'ENOENT') return { version: 1, installed: Object.fromEntries(catalog.map(definition => [definition.id, { version: definition.version, digest: digest(definition), enabled: true }])) }
      unavailable = true
      throw error('CAPABILITY_STORE_UNAVAILABLE')
    }
  }
  async function save(value) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    try {
      await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
      await replaceFile(temporary, filename)
    } catch {
      unavailable = true
      throw error('CAPABILITY_STORE_UNAVAILABLE')
    }
  }
  function revoke(id) {
    for (const [taskId, binding] of bindings) if (binding.id === id) {
      core.cancelTask(taskId)
      bindings.delete(taskId)
    }
  }
  async function mutate(id, operation) {
    const definition = entry(id), value = await load(), old = value.installed[id]
    operation(value, definition, old)
    await save(value)
    return { id, installed: !!value.installed[id], enabled: value.installed[id]?.enabled === true && locked(value.installed[id], definition) }
  }
  function inputCommand(definition, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('INVALID_INPUT')
    const keys = Object.keys(input).sort().join(',')
    if (definition.tool === 'windows-apps') { if (keys) throw error('INVALID_INPUT'); return '/apps' }
    if (typeof input.path !== 'string' || !input.path.trim() || input.path.length > 1024 || /[\x00-\x1f|]/.test(input.path)) throw error('INVALID_INPUT')
    if (definition.tool === 'read-file') { if (keys !== 'path') throw error('INVALID_INPUT'); return '/read ' + input.path }
    if (keys !== 'path,query' || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 80 || /[\x00-\x1f|]/.test(input.query)) throw error('INVALID_INPUT')
    return '/find ' + input.path + ' | ' + input.query
  }
  return {
    list: () => serial(async () => { const value = await load(); return catalog.map(definition => ({ ...definition, digest: digest(definition),
      installed: !!value.installed[definition.id], enabled: value.installed[definition.id]?.enabled === true && locked(value.installed[definition.id], definition),
      updateRequired: !!value.installed[definition.id] && !locked(value.installed[definition.id], definition) })) }),
    install: id => serial(() => mutate(id, (value, definition, old) => {
      if (!old) value.installed[id] = { version: definition.version, digest: digest(definition), enabled: false }
    })),
    setEnabled: (id, enabled) => serial(() => mutate(id, (value, definition, old) => {
      if (typeof enabled !== 'boolean') throw error('INVALID_INPUT')
      if (!old) throw error('CAPABILITY_NOT_INSTALLED')
      if (enabled && !locked(old, definition)) throw error('CAPABILITY_UPDATE_REQUIRED')
      if (!enabled) revoke(id)
      old.enabled = enabled
    })),
    update: id => serial(() => mutate(id, (value, definition, old) => {
      if (!old) throw error('CAPABILITY_NOT_INSTALLED')
      revoke(id)
      value.installed[id] = { version: definition.version, digest: digest(definition), enabled: false }
    })),
    remove: id => serial(() => mutate(id, value => { revoke(id); delete value.installed[id] })),
    run: (id, input, intentId) => serial(async () => {
      const definition = entry(id), value = await load(), row = value.installed[id]
      if (!locked(row, definition) || !row.enabled) throw error('PERMISSION_DENIED')
      for (const [taskId] of bindings) if (['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(core.getTask(taskId).state)) bindings.delete(taskId)
      if (bindings.size >= 256) throw error('PROVIDER_BUSY')
      const task = core.startTask({ text: inputCommand(definition, input), intentId }, {skillId:id})
      bindings.set(task.id, { id, digest: row.digest })
      return task
    }),
    authorize: taskId => serial(async () => {
      const binding = bindings.get(taskId)
      if (!binding) return true // Existing core operations keep their existing permissions.
      const value = await load(), row = value.installed[binding.id]
      if (!row?.enabled || row.digest !== binding.digest || !locked(row, entry(binding.id))) throw error('PERMISSION_DENIED')
      return true
    })
  }
}
module.exports = { createCapabilityRegistry }
