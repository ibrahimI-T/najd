// Projects (owner request 2026-10-31, like projects in ChatGPT and Claude): a named place with the owner's own
// instructions, files from the library and optionally a project folder, and the chats that belong to it. A chat in a
// project gets the project's instructions and files; a chat outside any project gets none of them.
// Stored in najd-data/projects.json, written atomically; a damaged file is preserved and reported, never rewritten.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { replaceFile } = require('./atomic-file.cjs')
const fail = code => Object.assign(new Error(code), { code })
const MAX_PROJECTS = 200, MAX_FILES = 20, MAX_NAME = 80, MAX_INSTRUCTIONS = 8000, MAX_BYTES = 4 * 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const assetId = /^[a-f0-9]{64}$/
const cleanName = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().replace(/\s+/g, ' ') : ''
const validFile = item => item && assetId.test(item.id) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 160 && !/[\\/\x00-\x1f]/.test(item.name)
const validProject = item => item && uuid.test(item.id) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= MAX_NAME &&
  typeof item.instructions === 'string' && item.instructions.length <= MAX_INSTRUCTIONS && Array.isArray(item.files) && item.files.length <= MAX_FILES && item.files.every(validFile) &&
  (item.folder === null || typeof item.folder === 'string' && path.isAbsolute(item.folder) && item.folder.length <= 1000) &&
  typeof item.createdAt === 'string' && typeof item.updatedAt === 'string'

function createProjectStore({ filePath, now = () => new Date() }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw fail('INVALID_INPUT')
  let data = null, pending = Promise.resolve()
  async function load() {
    if (data) return data
    let bytes
    try { bytes = await fs.readFile(filePath) } catch (error) { if (error.code === 'ENOENT') return (data = { version: 1, projects: [], chats: {} }); throw fail('PROJECTS_UNAVAILABLE') }
    if (bytes.length > MAX_BYTES) throw fail('PROJECTS_CORRUPT')
    let value
    try { value = JSON.parse(bytes.toString('utf8')) } catch { throw fail('PROJECTS_CORRUPT') }
    if (value?.version !== 1 || !Array.isArray(value.projects) || value.projects.length > MAX_PROJECTS || !value.projects.every(validProject) ||
        !value.chats || typeof value.chats !== 'object' || Array.isArray(value.chats) ||
        Object.entries(value.chats).some(([chat, project]) => !uuid.test(chat) || !value.projects.some(item => item.id === project))) throw fail('PROJECTS_CORRUPT')
    return (data = value)
  }
  async function save(next) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporary = filePath + '.' + randomUUID() + '.tmp'
    try { await fs.writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); await replaceFile(temporary, filePath) }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    data = next
  }
  // Changes run one at a time on a copy; the stored file changes only when the whole change is valid.
  const change = work => {
    const operation = pending.then(async () => { const next = structuredClone(await load()); const result = await work(next); await save(next); return result })
    pending = operation.catch(() => {})
    return operation
  }
  const find = (state, id) => { const project = state.projects.find(item => item.id === id); if (!project) throw fail('NOT_FOUND'); return project }
  const view = (state, project) => ({ ...structuredClone(project), chats: Object.entries(state.chats).filter(([, id]) => id === project.id).map(([chat]) => chat) })
  return {
    list: async () => { await pending; const state = await load(); return state.projects.map(project => view(state, project)) },
    get: async id => { await pending; const state = await load(); return view(state, find(state, id)) },
    // name and instructions; a missing id creates a project.
    save: input => change(state => {
      const name = cleanName(input?.name).slice(0, MAX_NAME)
      const instructions = typeof input?.instructions === 'string' ? input.instructions.replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, MAX_INSTRUCTIONS) : ''
      if (!name) throw fail('INVALID_INPUT')
      const at = now().toISOString()
      if (input?.id) { const project = find(state, input.id); Object.assign(project, { name, instructions, updatedAt: at }); return view(state, project) }
      if (state.projects.length >= MAX_PROJECTS) throw fail('PROJECT_LIMIT')
      const project = { id: randomUUID(), name, instructions, files: [], folder: null, createdAt: at, updatedAt: at }
      state.projects.unshift(project)
      return view(state, project)
    }),
    setFiles: (id, files) => change(state => {
      if (!Array.isArray(files) || files.length > MAX_FILES || !files.every(validFile)) throw fail('INVALID_INPUT')
      const project = find(state, id)
      project.files = [...new Map(files.map(item => [item.id, { id: item.id, name: item.name }])).values()]
      project.updatedAt = now().toISOString()
      return view(state, project)
    }),
    setFolder: (id, folder) => change(state => {
      if (folder !== null && (typeof folder !== 'string' || !path.isAbsolute(folder) || folder.length > 1000)) throw fail('INVALID_INPUT')
      const project = find(state, id)
      project.folder = folder === null ? null : path.resolve(folder)
      project.updatedAt = now().toISOString()
      return view(state, project)
    }),
    // A chat joins one project (or none). Removing a project keeps its chats; they just leave it.
    assign: (chatId, projectId) => change(state => {
      if (!uuid.test(String(chatId))) throw fail('INVALID_INPUT')
      if (projectId === null) delete state.chats[chatId]
      else { find(state, projectId); state.chats[chatId] = projectId }
      return projectId
    }),
    remove: id => change(state => {
      find(state, id)
      state.projects = state.projects.filter(item => item.id !== id)
      for (const [chat, project] of Object.entries(state.chats)) if (project === id) delete state.chats[chat]
      return true
    }),
    forChat: async chatId => { await pending; const state = await load(); const id = state.chats[chatId]; return id ? view(state, find(state, id)) : null }
  }
}

// The project's part of the instructions for a chat in it. Instructions written by the owner are the owner's own words.
function projectPrompt(project) {
  if (!project) return ''
  return ['This chat belongs to the user\'s project "' + project.name + '".',
    project.instructions.trim() ? 'Project instructions from the user:\n' + project.instructions.trim() : '',
    project.files.length ? 'Project files are attached to this chat: ' + project.files.map(item => item.name).join(', ') + '.' : '',
    project.folder ? 'Project folder (granted for file tools): ' + project.folder + '. Work on the project files there.' : ''].filter(Boolean).join('\n')
}
module.exports = { createProjectStore, projectPrompt }
