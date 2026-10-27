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

async function jsonRequest(fetchImpl, url, options = {}, signal, timeoutMs = 30000, maxBytes = 1024 * 1024) {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (response.status === 401) throw providerError('AUTH_REQUIRED')
    if (response.status === 429) throw providerError('PROVIDER_RATE_LIMIT')
    if (!response.ok) throw providerError('PROVIDER_REJECTED')
    try {
      const body = await boundedBody(response, maxBytes)
      if (signal?.aborted) throw providerError('CANCELLED')
      return JSON.parse(body)
    }
    catch (error) { if (error.code) throw error; throw providerError('INVALID_MODEL_OUTPUT') }
  } catch (error) {
    if (signal?.aborted) throw providerError('CANCELLED')
    if (timeout.aborted) throw providerError('PROVIDER_TIMEOUT')
    if (['AUTH_REQUIRED', 'PROVIDER_RATE_LIMIT', 'PROVIDER_REJECTED', 'INVALID_MODEL_OUTPUT'].includes(error?.code)) throw error
    throw providerError('PROVIDER_ERROR')
  }
}

function validateSystemPrompt(value) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 400000)) throw providerError('INVALID_INPUT')
  return value
}
module.exports = { providerError, jsonRequest, outputTokenLimit, validateSystemPrompt }
