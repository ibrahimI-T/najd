function providerError(code) { return Object.assign(new Error(code), { code }) }
function outputTokenLimit(value = 0, fallback) {
  if (!Number.isInteger(value) || value < 0 || value > 16384 || value > 0 && value < 128) throw providerError('INVALID_INPUT')
  return value || fallback
}

async function boundedBody(response, maxBytes = 1024 * 1024) {
  if (!response.body) throw providerError('INVALID_MODEL_OUTPUT')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > maxBytes) throw providerError('INVALID_MODEL_OUTPUT')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// A rejection that says the request was larger than the model's window becomes CONTEXT_LIMIT, with the window when the server states it
// (llama.cpp: exceed_context_size_error with n_ctx; OpenAI and compatible servers: context_length_exceeded / "maximum context length is N";
// LM Studio and others: "context length" wording). Only a bounded start of the body is read. The provider's own short reason is kept on
// the error as `detail` (at most 300 characters, never shown to the model) so NAJD's error log can say why a request was refused (live
// 2026-11-09: a Kimi refusal reached the owner only as PROVIDER_ERROR). Any refusal stays PROVIDER_REJECTED (llama.cpp refuses tools with a 500).
const CONTEXT_WORDS = /exceed_context_size|context_length_exceeded|exceeds? the (?:available )?context|maximum context length|context (?:length|window|size) (?:of|is|exceeded)|too many tokens|n_ctx/i
function reasonOf(text) {
  let value = ''
  try { const data = JSON.parse(text); value = data?.error?.message ?? data?.error ?? data?.message ?? data?.detail ?? '' } catch { value = text }
  return String(typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s+/g, ' ').trim().slice(0, 300)
}
async function rejection(response) {
  let text = ''
  try { text = (await boundedBody(response, 16 * 1024)).slice(0, 16 * 1024) } catch {}
  const detail = { status: response.status, detail: reasonOf(text) }
  if (!CONTEXT_WORDS.test(text)) return Object.assign(providerError('PROVIDER_REJECTED'), detail)
  const stated = Number((/"n_ctx"\s*:\s*(\d+)/.exec(text) || /maximum context length is (\d+)/i.exec(text) || /context (?:size|length|window) \((\d+) tokens\)/i.exec(text) || [])[1])
  return Object.assign(providerError('CONTEXT_LIMIT'), detail, Number.isInteger(stated) && stated >= 1024 && stated <= 20000000 ? { window: stated } : {})
}

async function jsonRequest(fetchImpl, url, options = {}, signal, timeoutMs = 30000, maxBytes = 1024 * 1024) {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (response.status === 401) throw providerError('AUTH_REQUIRED')
    if (response.status === 429) throw providerError('PROVIDER_RATE_LIMIT')
    if (!response.ok) throw await rejection(response)
    try {
      const body = await boundedBody(response, maxBytes)
      if (signal?.aborted) throw providerError('CANCELLED')
      return JSON.parse(body)
    }
    catch (error) { if (error.code) throw error; throw providerError('INVALID_MODEL_OUTPUT') }
  } catch (error) {
    if (signal?.aborted) throw providerError('CANCELLED')
    if (timeout.aborted) throw providerError('PROVIDER_TIMEOUT')
    if (['AUTH_REQUIRED', 'PROVIDER_RATE_LIMIT', 'PROVIDER_REJECTED', 'CONTEXT_LIMIT', 'INVALID_MODEL_OUTPUT'].includes(error?.code)) throw error
    throw providerError('PROVIDER_ERROR')
  }
}

function validateSystemPrompt(value) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 400000)) throw providerError('INVALID_INPUT')
  return value
}
module.exports = { providerError, jsonRequest, rejection, outputTokenLimit, validateSystemPrompt }
