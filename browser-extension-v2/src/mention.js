// "@" in the side panel: the owner names other open tabs to send with the question (like the tab mentions of other browser assistants).
// Only the tabs the owner picks are read, when the question is sent; nothing is read while choosing.
export const MAX_MENTIONS = 3

// The "@word" being typed just before the caret: at the start of the box or after a space, with no space inside it.
export function mentionAt(text, caret) {
  const before = String(text || '').slice(0, caret)
  const match = /(^|\s)@([^\s@]{0,40})$/u.exec(before)
  return match ? { start: before.length - match[2].length - 1, query: match[2] } : null
}

// Web tabs other than the page already beside the chat and the tabs already picked, matching the typed word in the title or address.
export function mentionChoices(tabs, { query = '', exclude = [], limit = 8 } = {}) {
  const fold = value => String(value || '').toLocaleLowerCase().replace(/[ً-ٰٟـ]/g, '')
  const needle = fold(query)
  return (Array.isArray(tabs) ? tabs : [])
    .filter(tab => tab && Number.isInteger(tab.id) && /^https?:\/\//.test(tab.url || '') && !exclude.includes(tab.id))
    .filter(tab => !needle || fold(tab.title).includes(needle) || fold(tab.url).includes(needle))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .slice(0, limit)
}

// "/" at the very start of the box names a skill (the same as Use on a skill in NAJD): the word typed after it, with no space inside.
export function slashAt(text, caret) {
  const match = /^\/([^\s/]{0,40})$/u.exec(String(text || '').slice(0, caret))
  return match ? { start: 0, query: match[1] } : null
}

// Skills matching the typed word in the id, the name or the description; a match in the id or name comes first.
export function skillChoices(skills, { query = '', limit = 8 } = {}) {
  const fold = value => String(value || '').toLocaleLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  const needle = fold(query)
  const rows = (Array.isArray(skills) ? skills : []).filter(skill => skill && typeof skill.id === 'string')
  if (!needle) return rows.slice(0, limit)
  const strong = rows.filter(skill => fold(skill.id).includes(needle) || fold(skill.name).includes(needle))
  const weak = rows.filter(skill => !strong.includes(skill) && fold(skill.description).includes(needle))
  return [...strong, ...weak].slice(0, limit)
}

// The opening NAJD's own Use button writes for a skill (RouteView.vue), in the panel's language.
export function skillPrompt(skill, arabic) {
  return arabic ? `استخدم مهارة «${skill.name || skill.id}» (${skill.id}) في: ` : `Use the skill "${skill.name || skill.id}" (${skill.id}) for: `
}

// Removes the "@word" just typed once a tab is chosen, so the question keeps only the owner's own words.
export function dropMention(text, mention, caret) {
  const value = String(text || '')
  return value.slice(0, mention.start) + value.slice(caret).replace(/^ /, '')
}
