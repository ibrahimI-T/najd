// Dashboards and canvases: small versioned documents, written atomically; a corrupt store is kept aside and never overwritten.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { replaceFile } = require('../atomic-file.cjs')
const error = code => Object.assign(new Error(code), { code })
const MAX_DOCUMENTS = 500, MAX_WIDGETS = 60
const KINDS = ['dashboard', 'canvas'], TYPES = ['metric', 'note', 'list', 'chart']

function checkWidget(widget) {
  if (!widget || !TYPES.includes(widget.type) || typeof widget.title !== 'string' || typeof widget.value !== 'string' || widget.title.length > 120 || widget.value.length > 20000) throw error('INVALID_INPUT')
  return { id: typeof widget.id === 'string' && widget.id ? widget.id.slice(0, 40) : randomUUID(), type: widget.type, title: widget.title, value: widget.value, column: [1, 2, 3].includes(widget.column) ? widget.column : 1 }
}
function createDocumentStore({ directory }) {
  if (!path.isAbsolute(directory || '')) throw error('INVALID_INPUT')
  const filename = path.join(directory, 'documents.json')
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  async function load() {
    let raw
    try { raw = await fs.readFile(filename, 'utf8') } catch (reason) { if (reason.code === 'ENOENT') return { version: 1, documents: [] }; throw reason }
    try { const value = JSON.parse(raw); if (value?.version === 1 && Array.isArray(value.documents)) return value } catch {}
    await fs.rename(filename, filename + '.corrupt-' + Date.now()).catch(() => {})
    return { version: 1, documents: [] }
  }
  async function write(state) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx' })
    await replaceFile(temporary, filename)
  }
  return {
    list: kind => serial(async () => (await load()).documents.filter(item => item.kind === kind)),
    save: input => serial(async () => {
      if (!KINDS.includes(input.kind) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || !Array.isArray(input.widgets) || input.widgets.length > MAX_WIDGETS) throw error('INVALID_INPUT')
      const state = await load()
      const value = { id: typeof input.id === 'string' && input.id ? input.id.slice(0, 40) : randomUUID(), kind: input.kind, title: input.title.trim(), template: typeof input.template === 'string' ? input.template.slice(0, 40) : undefined, projectId: typeof input.projectId === 'string' ? input.projectId : null, widgets: input.widgets.map(checkWidget), updatedAt: new Date().toISOString() }
      const index = state.documents.findIndex(item => item.id === value.id)
      if (index >= 0) state.documents[index] = value
      else { if (state.documents.length >= MAX_DOCUMENTS) throw error('DOCUMENT_LIMIT'); state.documents.push(value) }
      await write(state); return value
    }),
    remove: id => serial(async () => { const state = await load(), before = state.documents.length; state.documents = state.documents.filter(item => item.id !== id); if (state.documents.length !== before) await write(state); return state.documents.length !== before })
  }
}
module.exports = { createDocumentStore }
