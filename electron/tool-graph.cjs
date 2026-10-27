// The tool graph: toolsets are nodes, an edge means "tools that are usually needed next". A lean run starts with a
// small anchor set per profile and grows along these edges only when a tool of a toolset is actually used.
// Nothing here grants anything: every tool keeps its own policy, readiness and approvals (agent-toolsets.cjs).

// What a lean run loads first, after core and memory (in order, while the start size allows).
const LEAN_START = {
  general: ['files-read', 'web'],
  coding: ['files-read', 'terminal'],
  research: ['web', 'files-read'],
  design: ['files-read', 'media'],
  office: ['files-read', 'office'],
  delegated: []
}

// What a balanced run (any window above the small tier) starts with: the profile's toolsets that most tasks of that kind need.
// The rest stay one step away (najd_tools_load, or a call to a tool by name loads its toolset), so nothing is withheld.
const BALANCED_START = {
  general: null, // already compact: the whole profile
  coding: ['core', 'memory', 'files', 'terminal', 'web', 'skills'],
  research: ['core', 'memory', 'web', 'browser', 'library', 'files-read', 'toolbox', 'skills'],
  design: ['core', 'memory', 'files', 'web', 'media', 'library', 'skills'],
  office: ['core', 'memory', 'files', 'library', 'web', 'skills', 'python', 'office', 'toolbox']
}

// toolset -> toolsets used right after it, most likely first.
const EDGES = {
  'files-read': ['files', 'toolbox', 'terminal'],
  files: ['files-manage', 'toolbox', 'terminal'],
  'files-manage': ['files'],
  terminal: ['process', 'python', 'files-read'],
  process: ['logs', 'terminal'],
  python: ['files-read', 'terminal'],
  web: ['browser', 'webpreview'],
  browser: ['web'],
  webpreview: ['files', 'process'],
  office: ['python', 'files'],
  media: ['library'],
  knowledge: ['library'],
  library: ['files-read'],
  chats: ['memory'],
  desktop: ['screen', 'process'],
  screen: ['desktop'],
  extensions: ['skills'],
  mcp: [],
  skills: []
}

// The toolsets that follow `toolset`, skipping those already loaded.
const neighborsOf = (toolset, loaded = []) => (EDGES[toolset] || []).filter(name => !loaded.includes(name))

// The toolset a tool belongs to (the narrowest first, so a read tool maps to files-read before files).
function ownerOf(toolName, toolsets) {
  return Object.keys(toolsets).find(name => name !== 'files' && toolsets[name].includes(toolName)) || Object.keys(toolsets).find(name => toolsets[name].includes(toolName)) || null
}

// One-line tool description for small windows: the first sentence, at most 110 characters; parameter notes dropped.
function briefSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const first = String(schema.description || '').split(/(?<=[.!?])\s/)[0]
  const description = first.length > 110 ? first.slice(0, 107).trimEnd() + '...' : first
  const parameters = schema.parameters && schema.parameters.properties
    ? { ...schema.parameters, properties: Object.fromEntries(Object.entries(schema.parameters.properties).map(([key, value]) => {
      const note = String(value?.description || '').split(/(?<=[.!?])\s/)[0]
      const { description: _long, ...rest } = value || {}
      if (note) rest.description = note.length > 60 ? note.slice(0, 57).trimEnd() + '...' : note
      return [key, rest]
    })) } : schema.parameters
  return { ...schema, description, parameters }
}

module.exports = { BALANCED_START, LEAN_START, EDGES, neighborsOf, ownerOf, briefSchema }
