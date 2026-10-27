// NAJD sets no usage limits (owner decision 2026-10-23): no cap on concurrent requests, input size, cloud attempts or output tokens, and nothing to configure.
// This module keeps the earlier interface so callers and old profiles keep working; a stored request-policy.json from an earlier version is ignored, never rewritten.
// The only bound is a technical safety net of one hour per request, so a request that never answers cannot hang forever (the Stop button ends it sooner).
const UNLIMITED = Object.freeze({ maxConcurrent: 0, timeoutMs: 3600000, maxInputChars: 0, maxCloudAttempts: 0, maxOutputTokens: 0 })

function createProviderPolicy() {
  return { get: async () => ({ ...UNLIMITED }), set: async () => ({ ...UNLIMITED }) }
}
module.exports = { createProviderPolicy, UNLIMITED }
