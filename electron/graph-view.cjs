// What the graph window shows: the memory map (notes, the stars they share, and NAJD's soul with its sections) and the
// tool map (toolsets and what usually follows what). Pure functions over data the main process already holds.
const { viewOf } = require('./memory-graph.cjs')
const { EDGES, LEAN_START } = require('./tool-graph.cjs')
const { TOOLSETS, LOADABLE, profiles } = require('./agent-toolsets.cjs')

// Sections of the soul (the personality instructions): lines written as a heading ("WHO YOU ARE", "# Style").
function soulSections(instructions) {
  const sections = []
  let current = null
  for (const line of String(instructions || '').split(/\r?\n/)) {
    const heading = /^#{1,3}\s+(.{2,60})$/.exec(line.trim())?.[1] || (/^[A-Z][A-Z0-9 &,'/-]{3,58}$/.test(line.trim()) ? line.trim() : null)
    if (heading) { current = { title: heading.replace(/\s+/g, ' '), text: '' }; sections.push(current); continue }
    if (current) current.text += (current.text ? '\n' : '') + line
  }
  return sections.slice(0, 20).map((section, index) => ({ id: 'soul-' + index, title: section.title, text: section.text.trim().slice(0, 600) }))
}

// notes: [{ id, kind: 'preference' | 'experience' | 'note', title, text, updatedAt }]; soul: { name, instructions, enabled } | null
// At most this many notes are drawn (the newest); the stats say how many there are. This keeps the layout and the drawing light for a very large memory.
const MAX_SHOWN = 500

function memoryView({ notes, soul }) {
  const shown = notes.length > MAX_SHOWN ? [...notes].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_SHOWN) : notes
  const view = viewOf(shown)
  const nodes = view.nodes.map(node => node.type === 'note' ? { ...node, source: node.kind } : node)
  const edges = [...view.edges]
  if (soul) {
    nodes.push({ id: 'soul', type: 'soul', label: soul.name || 'NAJD', weight: 6, enabled: soul.enabled !== false })
    for (const section of soulSections(soul.instructions)) {
      nodes.push({ id: 'soul:' + section.id, type: 'section', label: section.title, text: section.text, weight: 2 })
      edges.push({ from: 'soul', to: 'soul:' + section.id, kind: 'part', weight: 1 })
    }
    // What the soul and the learned preferences have in common: preferences hang from the soul.
    for (const node of nodes) if (node.type === 'note' && node.kind === 'preference') edges.push({ from: 'soul', to: node.id, kind: 'shapes', weight: 1 })
  }
  return { nodes, edges, stats: { ...view.stats, total: notes.length, sections: nodes.filter(node => node.type === 'section').length } }
}

// The tool map: toolsets with their tools; an edge is "usually needed next". `start` marks what a lean run begins with.
function toolsView({ ready = () => true } = {}) {
  const startSets = new Set(['core', 'memory', ...Object.values(LEAN_START).flat()])
  const names = [...new Set([...Object.keys(TOOLSETS)])]
  const nodes = names.map(name => ({ id: name, type: 'toolset', label: name, tools: TOOLSETS[name].length, toolNames: TOOLSETS[name].slice(0, 12), loadable: LOADABLE.includes(name), start: startSets.has(name), ready: ready(name) !== false,
    profiles: Object.entries(profiles).filter(([, profile]) => profile.toolsets.includes(name)).map(([key]) => key), weight: TOOLSETS[name].length }))
  const edges = []
  for (const [from, list] of Object.entries(EDGES)) for (const to of list) if (TOOLSETS[from] && TOOLSETS[to]) edges.push({ from, to, kind: 'next', weight: 1 })
  return { nodes, edges, stats: { toolsets: nodes.length, tools: new Set(Object.values(TOOLSETS).flat()).size, links: edges.length } }
}

module.exports = { memoryView, toolsView, soulSections }
