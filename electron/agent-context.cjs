// Preserve the latest request and real tool transcript; shed older conversation
// turns only when necessary to fit the owner's configured request budget.
// Attached pictures travel as bounded data URLs; they count as a fixed text-equivalent cost
// against the owner's input budget instead of their base64 length.
const IMAGE_COST = 1500, MAX_IMAGES = 12, MAX_IMAGE_URL = 3 * 1024 * 1024
function agentTurnSize(agentTurn) {
  let images = 0
  const text = JSON.stringify(agentTurn, (key, value) => {
    if (value && value.type === 'input_image') {
      if (typeof value.image_url !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.image_url) || value.image_url.length > MAX_IMAGE_URL || ++images > MAX_IMAGES)
        throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
      return { type: 'input_image' }
    }
    return value
  })
  return text.length + images * IMAGE_COST
}

function fitAgentHistory(history, systemPrompt, agentTurn, maxInputChars, { note = false } = {}) {
  const reserved = systemPrompt.length + agentTurnSize(agentTurn)
  let selected = history.map(({ role, text }) => ({ role, text }))
  const size = () => reserved + selected.reduce((total, item) => total + item.text.length, 0)
  const dropped = []
  while (selected.length > 1 && size() > maxInputChars) {
    dropped.push(selected.shift())
    while (selected.length > 1 && selected[0].role === 'assistant') dropped.push(selected.shift())
  }
  if (size() > maxInputChars) throw Object.assign(new Error('CONTEXT_LIMIT'), { code: 'CONTEXT_LIMIT' })
  // A short reminder of what was left out (the topics of the dropped requests), carried inside the first kept message.
  if (note && dropped.length && selected[0].role === 'user') {
    const topics = dropped.filter(item => item.role === 'user').slice(-6).map(item => '"' + item.text.replace(/\s+/g, ' ').slice(0, 80) + '"')
    const reminder = '[' + dropped.length + ' earlier messages were left out to fit the model window' + (topics.length ? '; the user had asked about: ' + topics.join(', ') : '') + '.]\n\n'
    if (size() + reminder.length <= maxInputChars) selected[0] = { ...selected[0], text: reminder + selected[0].text }
  }
  return selected
}
module.exports = { fitAgentHistory, agentTurnSize, MAX_IMAGES }
