// Condensing older tool results: when a request passes a share of the model's window, results of earlier steps of
// the task shrink to a few lines (what ran, whether it worked, ids and cursors, a short preview). The latest results
// stay whole, and the model can ask again for anything it still needs. Deterministic: no extra model call.
const KEEP = ['status', 'error', 'id', 'logId', 'exitCode', 'effectUnknown', 'familyClosed', 'nextOffset', 'totalBytes', 'startId', 'state', 'window', 'nextFrom', 'path', 'characters', 'incomplete']
const MIN_OUTPUT = 600 // shorter results are not worth shrinking

// Mutates `input` (the transcript of one task). Returns { condensed, savedBytes }.
function condense(input, { keepLast = 2 } = {}) {
  const outputs = []
  input.forEach((item, index) => { if (item?.type === 'function_call_output' && typeof item.output === 'string') outputs.push(index) })
  const names = new Map(input.filter(item => item?.type === 'function_call').map(item => [item.call_id, item.name]))
  let condensed = 0, savedBytes = 0
  for (const index of outputs.slice(0, Math.max(0, outputs.length - keepLast))) {
    const item = input[index]
    if (item.output.length < MIN_OUTPUT) continue
    let value
    try { value = JSON.parse(item.output) } catch { value = null }
    if (value && value.condensed === true) continue
    const kept = value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(KEEP.filter(key => key in value).map(key => [key, value[key]])) : {}
    const textKey = value && typeof value === 'object' ? Object.keys(value).find(key => typeof value[key] === 'string' && value[key].length > 200) : null
    const preview = (textKey ? value[textKey] : item.output).replace(/\s+/g, ' ').slice(0, 200)
    const summary = JSON.stringify({ condensed: true, tool: names.get(item.call_id) || 'tool', ...kept, preview,
      note: 'Earlier result shortened to save space. Call the tool again if you need the full content.' })
    if (summary.length >= item.output.length) continue
    savedBytes += item.output.length - summary.length
    input[index] = { ...item, output: summary }
    condensed++
  }
  return { condensed, savedBytes }
}

module.exports = { condense }
