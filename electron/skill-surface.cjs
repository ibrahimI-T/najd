// One skill surface for the model and UI (bundled NAJD/upstream guides, shipped skill packs, user-installed skills).
// The model-facing najd_skills_read schema is strict, so every call carries a file argument: an empty value, "SKILL.md",
// the guide's own file name or its listed path all mean the main guide (owner live test 2026-10-31: guides were refused
// as NOT_FOUND because the model named the main file). Other files are read only when a skill pack lists them.
const nodePath = require('node:path')
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const fail = (code, hint) => Object.assign(new Error(code), { code }, hint ? { hint } : {})

function createSkillSurface({ bundled, external, packs }) {
  const ownerOf = async id => (await external.has(id)) ? 'external' : packs.has(id) ? 'pack' : 'bundled'
  // A file name the model used for the main guide, or null when it names an auxiliary file.
  const mainAlias = (id, file, row) => {
    if (file === undefined || file === null) return true
    const value = String(file).trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!value) return true
    const lower = value.toLowerCase()
    const relative = String(row?.relativePath || '').toLowerCase()
    return ['skill.md', 'skill', 'main', 'guide', 'readme.md', 'index.md', 'main.md', 'guide.md', id.toLowerCase(), id.toLowerCase() + '.md'].includes(lower) ||
      lower === id.toLowerCase() + '/skill.md' ||
      (relative && (lower === relative || lower === nodePath.posix.basename(relative)))
  }
  const similar = (rows, id) => {
    const words = String(id || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !['najd', 'pack', 'skill'].includes(word))
    return rows.filter(row => words.some(word => row.id.includes(word))).slice(0, 8).map(row => row.id)
  }
  return {
    list: async () => [...await bundled.list(), ...await external.list()],
    setEnabled: async (id, enabled) => (await external.has(id) ? external : bundled).setEnabled(id, enabled),
    read: async (id, offset, limit, file) => withNext(await readPage(id, offset, limit, file))
  }
  async function readPage(id, offset, limit, file) {
    if (typeof id !== 'string' || !id.trim()) throw fail('INVALID_INPUT', 'Pass a skill id, for example one named in the instructions.')
    id = id.trim()
    // A saved skill's id starts with "my-"; the same name without it means that skill (owner live test 2026-10-31).
    if (!id.startsWith('my-') && !(await bundled.list()).some(row => row.id === id) && await external.has('my-' + id)) id = 'my-' + id
    const owner = await ownerOf(id)
    const rows = owner === 'external' ? await external.list() : await bundled.list()
    const row = rows.find(item => item.id === id)
    if (!row) {
      const near = similar([...await bundled.list(), ...await external.list()], id)
      throw fail('NOT_FOUND', 'No skill has this id.' + (near.length ? ' Similar ids: ' + near.join(', ') + '.' : ' Search with najd_capabilities_search.'))
    }
    const main = mainAlias(id, file, row)
    // A guide without other files answers any file value with itself (owner live test 2026-10-31: three different
    // spellings were refused before the model tried ""), and says so.
    const ignored = main ? {} : { fileIgnored: true, note: 'This guide has no other files; this is the guide itself. Pass file "" next time.' }
    if (owner === 'external') return { ...await external.read(id, offset, limit), ...ignored }
    if (owner === 'bundled') return { ...await bundled.read(id, offset, limit), ...ignored }
    const listed = packs.describe(id)
    const wanted = main ? null : String(file).trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (wanted === null) return { ...await bundled.read(id, offset, limit), ...listed }
    // The guide must be enabled before any of its files is read.
    await bundled.read(id, 0, 1)
    if (!listed.files.includes(wanted)) throw fail('NOT_FOUND', 'That file is not listed for this skill. Listed files include: ' + listed.files.slice(0, 25).join(', ') + '. Pass file "" for the main guide.')
    return packs.readFile(id, wanted, offset, limit)
  }
}
// Where the next page starts, so a long guide is continued without arithmetic.
const withNext = page => page && page.hasMore && typeof page.text === 'string' ? { ...page, nextOffset: page.offset + page.text.length } : page
// NAJD's own guides (electron/najd-skills/*.md): one row per file, its id from the front-matter name.
function najdGuideRows(directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith('.md')).sort().map(name => {
    const body = fs.readFileSync(nodePath.join(directory, name), 'utf8').replace(/\r\n/g, '\n')
    const field = key => (new RegExp('^' + key + ': (.+)$', 'm').exec(body) || [])[1] || ''
    return { id: field('name'), name: field('name'), description: field('description').slice(0, 400), source: 'najd', sourceRevision: null, relativePath: 'najd-skills/' + name,
      platforms: ['windows'], license: 'NAJD', author: 'NAJD', digest: createHash('sha256').update(body).digest('hex'), body }
  })
}
module.exports = { createSkillSurface, najdGuideRows }
