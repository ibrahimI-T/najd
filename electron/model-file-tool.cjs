const { providerError } = require('./provider-http.cjs')

function readTool(target) {
  if (typeof target !== 'string' || !target || target.length > 1024 || target !== target.trim() || /[\x00-\x1f]/.test(target)) throw providerError('INVALID_INPUT')
  return { name: 'preview_requested_file', description: 'Propose a local preview of the file already named by the user. NAJD has bound its exact target. No arguments. Reading requires separate approval.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }
}
function parseReadProposal(name, arguments_, target) {
  readTool(target)
  let input = arguments_
  if (typeof input === 'string') {
    if (input.length > 8192) throw providerError('INVALID_MODEL_OUTPUT')
    try { input = JSON.parse(input) } catch { throw providerError('INVALID_MODEL_OUTPUT') }
  }
  if (name !== 'preview_requested_file' || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0)
    throw providerError('INVALID_MODEL_OUTPUT')
  return { kind: 'tool', name: 'read-file', input: { path: target } }
}
module.exports = { readTool, parseReadProposal }
