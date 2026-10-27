// Explicit engine routing shares the existing core task/intent lease and provider capture.
function createEngineRouter({ chat, hermes }) {
  return async request => {
    if (!request.modelName) throw Object.assign(new Error('MODEL_NOT_CONFIGURED'), { code: 'MODEL_NOT_CONFIGURED' })
    const planning = request.text.match(/^\/(hermes|هيرمس)(?:\s+([\s\S]*))?$/)
    if (!planning) return chat(request)
    const text = planning[2]?.trim()
    if (!text) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
    return hermes.run({ text, provider: request.provider, modelName: request.modelName,
      signal: request.signal, reasoningEffort: request.reasoningEffort })
  }
}
module.exports = { createEngineRouter }
