// The context window a local server is really running with. The model list of an OpenAI-compatible server rarely says
// it (llama.cpp reports the window the model was trained for, not the one the server was started with), so the
// server's own endpoints are asked: llama.cpp `/props` (n_ctx) and LM Studio `/api/v0/models` (loaded_context_length).
// vLLM reports max_model_len in its model list, which model-window.cjs reads. Nothing here is sent anywhere but the
// local address the owner configured.
const { validWindow } = require('./model-window.cjs')

const MAX_BODY = 256 * 1024, MAX_MODELS = 500
const root = baseUrl => String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '')

async function getJson(fetchImpl, url, signal, apiKey) {
  // The saved key of the provider (main process only) is sent to the address the owner configured, as for chat, when the server asks for one.
  const response = await fetchImpl(url, { signal: AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]), redirect: 'error', ...(apiKey ? { headers: { authorization: 'Bearer ' + apiKey } } : {}) })
  if (!response.ok || !response.body) return null
  // The body is read in pieces and dropped as soon as it passes the limit, so a server that answers with something huge costs nothing.
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_BODY) { await response.body.cancel?.().catch(() => {}); return null }
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null }
}

// Returns { default: tokens | null, models: { [id]: tokens } } (both empty when the server says nothing).
async function detectLocalWindow({ baseUrl, fetchImpl = globalThis.fetch, signal, apiKey = null } = {}) {
  const base = root(baseUrl)
  // No prototype: a model called "constructor" or "toString" is just a name, never an inherited function.
  const found = { default: null, models: Object.create(null) }
  if (!base || typeof fetchImpl !== 'function') return found
  const props = await getJson(fetchImpl, base + '/props', signal, apiKey).catch(() => null)
  const nCtx = validWindow(props?.default_generation_settings?.n_ctx) ?? validWindow(props?.n_ctx)
  if (nCtx) found.default = nCtx
  const studio = await getJson(fetchImpl, base + '/api/v0/models', signal, apiKey).catch(() => null)
  if (Array.isArray(studio?.data)) for (const item of studio.data.slice(0, MAX_MODELS)) {
    const loaded = validWindow(item?.loaded_context_length)
    if (loaded && typeof item.id === 'string') found.models[item.id.slice(0, 200)] = loaded
  }
  return found
}

module.exports = { detectLocalWindow }
