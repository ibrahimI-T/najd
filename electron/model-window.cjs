// A model's context window as its provider reports it in the model listing, or as its name states it ("k3-256k",
// "…-1m"). Unknown stays null: the panel then shows no percentage rather than a guess.
const MIN = 1024, MAX = 20_000_000
const valid = value => Number.isSafeInteger(value) && value >= MIN && value <= MAX ? value : null

function reportedWindow(raw) {
  if (!raw || typeof raw !== 'object') return null
  return valid(raw.context_window) ?? valid(raw.context_length) ?? valid(raw.inputTokenLimit) ??
    valid(raw.max_input_tokens) ?? valid(raw.max_model_len) ?? valid(raw.top_provider?.context_length) ?? null
}

function namedWindow(id) {
  const match = typeof id === 'string' && /(?:^|[-_.:/])(\d{1,4}(?:\.\d)?)([km])(?=$|[-_.:/])/i.exec(id)
  if (!match) return null
  const value = Math.round(Number(match[1]) * (match[2].toLowerCase() === 'm' ? 1_000_000 : 1000))
  return valid(value)
}

const modelWindow = (raw, id) => reportedWindow(raw) ?? namedWindow(id)

module.exports = { modelWindow, reportedWindow, namedWindow, validWindow: valid }
