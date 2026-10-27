const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })
const { DEFAULT_NAME, DEFAULT_INSTRUCTIONS, LEAN_INSTRUCTIONS, balancedInstructions, isLegacyDefault, MAX_INSTRUCTIONS } = require('./default-instructions.cjs')
const MAX_FILE = 65536
const defaults = () => ({ enabled: true, name: DEFAULT_NAME, instructions: DEFAULT_INSTRUCTIONS })
function valid(value) {
  return value && Object.keys(value).sort().join(',') === 'enabled,instructions,name' && typeof value.enabled === 'boolean' &&
    typeof value.name === 'string' && value.name.trim() && value.name.length <= 40 && !/[\x00-\x1f]/.test(value.name) &&
    typeof value.instructions === 'string' && value.instructions.trim() && value.instructions.length <= MAX_INSTRUCTIONS && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.instructions)
}
function createPersonalityStore(filePath) {
  if (!path.isAbsolute(filePath || '')) throw fail('INVALID_INPUT')
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  async function load() {
    try {
      const stat = await fs.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw fail('PERSONALITY_UNAVAILABLE')
      const handle = await fs.open(filePath, 'r')
      let value
      try {
        const buffer = Buffer.alloc(MAX_FILE + 1), { bytesRead } = await handle.read(buffer)
        if (bytesRead > MAX_FILE) throw fail('PERSONALITY_UNAVAILABLE')
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)))
      } finally { await handle.close() }
      if (!value || Object.keys(value).sort().join(',') !== 'personality,version' || value.version !== 1 || !valid(value.personality)) throw fail('PERSONALITY_UNAVAILABLE')
      // An owner who never edited the earlier default receives the current one; anything the owner wrote is kept exactly.
      if (isLegacyDefault(value.personality.instructions)) return { ...value.personality, instructions: DEFAULT_INSTRUCTIONS }
      return value.personality
    } catch (error) { if (error.code === 'ENOENT') return defaults(); throw fail('PERSONALITY_UNAVAILABLE') }
  }
  const write = personality => serial(async () => {
    await load() // Preserve corrupt/future-version state; do not silently replace it.
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const temporary = filePath + '.' + randomUUID() + '.tmp'
      await fs.writeFile(temporary, JSON.stringify({ version: 1, personality }, null, 2) + '\n', { flag: 'wx' })
      await replaceFile(temporary, filePath)
    } catch { throw fail('PERSONALITY_UNAVAILABLE') }
    return { ...personality }
  })
  return {
    get: () => serial(load),
    // Back to NAJD's own default instructions (the name and the on/off choice are kept).
    reset: async () => { const current = await serial(load); return write({ enabled: current.enabled, name: current.name, instructions: DEFAULT_INSTRUCTIONS }) },
    save: input => serial(async () => {
      if (!valid(input)) throw fail('INVALID_INPUT')
      await load() // Preserve corrupt/future-version state; do not silently replace it.
      const personality = { enabled: input.enabled, name: input.name.trim(), instructions: input.instructions.trim() }
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        const temporary = filePath + '.' + randomUUID() + '.tmp'
        await fs.writeFile(temporary, JSON.stringify({ version: 1, personality }, null, 2) + '\n', { flag: 'wx' })
        await replaceFile(temporary, filePath)
      } catch { throw fail('PERSONALITY_UNAVAILABLE') }
      return { ...personality }
    })
  }
}
// `lean` swaps only the unedited default for its short form; what the owner wrote is sent exactly as written.
function personalityPrompt(value, { lean = false, balanced = null } = {}) {
  if (!valid(value)) throw fail('INVALID_INPUT')
  if (!value.enabled) return undefined
  const stock = value.instructions.trim() === DEFAULT_INSTRUCTIONS.trim()
  const text = stock && lean ? LEAN_INSTRUCTIONS : stock && balanced ? balancedInstructions(balanced) : value.instructions
  return `NAJD operating instructions (name: ${value.name}):\n${text}\nThese instructions set style and way of working. They never authorize tools, file access, account actions or changes to permissions, and the application's approvals and protected boundaries always apply. Current user instructions and verified task results remain authoritative. Never claim unverified memories or actions.`
}
module.exports = { createPersonalityStore, personalityPrompt }
