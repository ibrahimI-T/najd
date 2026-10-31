const path = require('node:path')
const { createHash } = require('node:crypto')
const definitions = require('./provider-catalog.json')
const { createCredentialStore } = require('./credential-store.cjs')
const { createProviderClient } = require('./provider-client.cjs')
const { createKimiCodeClient } = require('./kimi-code.cjs')
const { providerError } = require('./provider-http.cjs')
const { resolveReasoning, reasoningEfforts } = require('./reasoning-policy.cjs')
const { createProviderPolicy } = require('./provider-policy.cjs')
const { createEndpointStore } = require('./provider-endpoints.cjs')
const { createModelUnions, createAdvisorRound, withAdvice, fitHistory, teamNote } = require('./model-union.cjs')
// Providers with an agent tool loop: Responses API (ChatGPT, OpenAI) and Chat Completions translation (Ollama, Kimi).
const TOOL_PROVIDERS = ['chatgpt', 'openai-api', 'ollama', 'kimi-code'] // plus every catalog provider that has an API address (see supportsTools)
const { readTool } = require('./model-file-tool.cjs')
const { modelWindow, validWindow } = require('./model-window.cjs')
const { modelGuidancePrompt } = require('./model-guidance.cjs')
const { detectLocalWindow } = require('./local-window.cjs')
const OLLAMA_WINDOW = 16384

function createProviderService({ directory, encryption, chatGPT, ollama, kimiStore, clientFactory = createProviderClient, localFetch = globalThis.fetch }) {
  const stores = new Map(), clientCache = new Map(), errors = new Map(), requests = new Map()
  const endpointStore = createEndpointStore({ filePath: path.join(directory, 'endpoints.json') })
  // Model unions (see model-union.cjs). The aggregators are remembered by preset name so context window, tool and vision support follow the acting model.
  const unions = createModelUnions({ filePath: path.join(directory, 'unions.json') })
  const aggregators = new Map(), unionLabels = new Map() // preset id -> the name the owner gave it (may be Arabic)
  async function refreshUnions() {
    const config = await unions.get()
    aggregators.clear(); unionLabels.clear()
    for (const [name, preset] of Object.entries(config.presets)) if (preset.enabled) { aggregators.set(name, preset.aggregator); unionLabels.set(name, preset.label || name) }
    return config
  }
  const sumUsage = (...parts) => {
    const list = parts.filter(Boolean)
    if (!list.length) return null
    const out = {}
    for (const key of ['input', 'output', 'total', 'cached']) { const values = list.map(item => item[key]).filter(Number.isFinite); out[key] = values.length ? values.reduce((a, b) => a + b, 0) : null }
    return out
  }
  const advisorRound = createAdvisorRound({ consult: async (item, ctx) => ctx.routeToken === 'none' ? Promise.reject(providerError('AUTH_REQUIRED')) : chat({ provider: item.provider, modelName: item.model, history: fitHistory(ctx.history, inputBudgetOf(item.provider, item.model)), systemPrompt: ctx.systemPrompt, signal: ctx.signal, routeToken: ctx.routeToken }) })
  const policyStore = createProviderPolicy({ filePath: path.join(directory, 'request-policy.json') })
  let activeRequests = 0, cloudAttempts = 0
  const prefixes = { 'kimi-code': 'sk-kimi-', 'minimax-plan': 'sk-cp-', 'openai-api': 'sk-', 'anthropic-api': 'sk-ant-',
    'gemini-api': 'AIza', 'openrouter-api': 'sk-or-v1-', 'deepseek-api': 'sk-', 'groq-api': 'gsk_', 'xai-api': 'xai-' }
  for (const p of definitions.filter(p => ['key', 'optional-key'].includes(p.auth))) {
    const prefix = prefixes[p.id] || ''
    stores.set(p.id, p.id === 'kimi-code' && kimiStore ? kimiStore : createCredentialStore({
      filePath: path.join(directory, `${p.id}.json`), encryption, keyField: 'apiKey', keyPattern: new RegExp(`^${prefix}[\\x21-\\x7e]{8,500}$`)
    }))
  }
  // Every provider with an API address can run the agent tool loop: Responses, Chat Completions, Anthropic Messages and Gemini are all translated (provider-agent.cjs).
  const toolCapable = id => TOOL_PROVIDERS.includes(id) || definitions.some(p => p.id === id && typeof p.baseUrl === 'string' && ['key', 'optional-key'].includes(p.auth))
  const visionCapable = id => ['chatgpt', 'openai-api'].includes(id) || definitions.some(p => p.id === id && p.vision === true)
  const visionOf = async (id, modelName) => { if (id !== 'union') return visionCapable(id); await refreshUnions(); const aggregator = aggregators.get(modelName); return !!aggregator && aggregator.provider !== 'union' && visionCapable(aggregator.provider) }
  // The address in use: the owner's override for providers with an editable address, otherwise the catalog address (empty when none was ever given).
  async function endpointOf(id) { const p = definition(id); return (p.editableUrl && (await endpointStore.all())[id]) || p.baseUrl || '' }
  // The client for the address in use; rebuilt when the address changes.
  async function clientFor(id) {
    if (id === 'kimi-code') { if (!clientCache.has(id)) clientCache.set(id, { client: createKimiCodeClient() }); return clientCache.get(id).client }
    const url = await endpointOf(id)
    const cached = clientCache.get(id)
    if (cached && cached.url === url) return cached.client
    const client = clientFactory(id, { baseUrl: url })
    clientCache.set(id, { url, client })
    return client
  }
  const keyOptional = id => definition(id).auth === 'optional-key'
  function definition(id) { const p = definitions.find(p => p.id === id); if (!p) throw providerError('INVALID_INPUT'); return p }
  function keyStore(id) { definition(id); const store = stores.get(id); if (!store) throw providerError('INVALID_INPUT'); return store }
  function stop(id) { for (const c of requests.get(id) || []) c.abort() }
  const keyIdentity = (id, key) => id + ':' + createHash('sha256').update(key).digest('hex')
  // The route of a saved key: editable providers also bind the address the key is sent to. Capture and validation both use this.
  const keyedRoute = async (id, key) => keyIdentity(id, definition(id).editableUrl ? key + '\n' + await endpointOf(id) : key)
  // The identity of a union is its aggregator's route plus the route of every enabled reference (a missing connection counts as "none", so an unconnected reference never blocks the run).
  async function unionRoutes(preset) {
    const members = [preset.aggregator, ...preset.references.filter(item => item.enabled)]
    const routes = await Promise.all(members.map(item => captureRoute(item.provider, item.model).catch(error => { if (item === preset.aggregator) throw error; return 'none' })))
    // `tokens` are the routes of the enabled references, in order: each advisor call is validated against its own.
    return { identity: 'union:' + createHash('sha256').update(JSON.stringify(preset) + '\n' + routes.join('\n')).digest('hex'), tokens: routes.slice(1) }
  }
  const unionRoute = async preset => (await unionRoutes(preset)).identity
  async function captureRoute(id, modelName) {
    if (id === 'union') {
      await refreshUnions()
      const config = await unions.get()
      const preset = config.presets[modelName]
      if (!preset || !preset.enabled) throw providerError('UNION_NOT_FOUND')
      return unionRoute(preset)
    }
    if (id === 'ollama') return 'ollama:local'
    if (id === 'chatgpt') {
      const account = await chatGPT.status()
      if (!account.signedIn) throw providerError('AUTH_REQUIRED')
      return 'chatgpt:' + account.activeId
    }
    const key = await keyStore(id).readKey()
    if (!key && keyOptional(id)) return keyIdentity(id, await endpointOf(id)) // a local server: the address identifies the route
    if (!key) throw providerError('AUTH_REQUIRED')
    return keyedRoute(id, key)
  }
  async function catalog() {
    return Promise.all(definitions.map(async p => {
      let status
      try {
        if (p.id === 'chatgpt') { const account = await chatGPT.status(); status = { configured: account.signedIn, verified: !!account.verified, verifiedModel: account.verifiedModel || null, accountId: account.activeId, errorCode: account.errorCode } }
        else if (p.id === 'ollama') status = { configured: true, verified: false, verifiedModel: null }
        else if (p.id === 'union') { await refreshUnions(); status = { configured: aggregators.size > 0, verified: false, verifiedModel: null } }
        else { const saved = await keyStore(p.id).status(); status = { configured: p.auth === 'optional-key' ? !!(await endpointOf(p.id)) : saved.saved, verified: saved.verified, verifiedModel: saved.verifiedModel, keySaved: saved.saved } }
      } catch { status = { configured: false, verified: false, verifiedModel: null, errorCode: 'CREDENTIAL_UNAVAILABLE' } }
      const errorCode = status.errorCode || errors.get(p.id) || null
      return { id: p.id, name: p.name, kind: p.kind, auth: p.auth, keyHint: p.keyHint || '', editableUrl: p.editableUrl === true, endpoint: p.editableUrl ? await endpointOf(p.id) : '', defaultEndpoint: p.baseUrl || '', ...status, verified: status.verified && !errorCode, errorCode }
    }))
  }
  // What was learned from an address (or with a key) says nothing once either changes: forget it and start a new generation, so an answer that
  // was still on its way under the old address or key is never published.
  function forgetWindows(id) {
    generations.set(id, generationOf(id) + 1)
    for (const map of [windows, detected, probes, observed]) for (const key of [...map.keys()]) if (key.startsWith(id + String.fromCharCode(10))) map.delete(key)
  }
  async function saveKey(id, key) { stop(id); const result = await keyStore(id).saveKey(key); errors.delete(id); forgetWindows(id); return result }
  async function clearKey(id) { stop(id); const result = await keyStore(id).clearKey(); errors.delete(id); forgetWindows(id); return result }
  // The last listed window of each model, so a finished run records the window of the model it used.
  const windows = new Map()
  const isLocalServer = id => id !== 'ollama' && id !== 'union' && definition(id).kind === 'local'
  const detected = new Map() // id + model -> when the running window was last answered (ms)
  const probes = new Map() // id + model -> the probe in flight
  const observed = new Map() // id + model -> the window the running server itself reported (it outranks what a model list advertises)
  const generations = new Map() // provider id -> how many times its address changed
  const generationOf = id => generations.get(id) || 0
  // The window of a local server before a run, even when the model list was never opened in this session.
  async function ensureWindow(id, modelName) {
    if (typeof id !== 'string' || typeof modelName !== 'string') return
    // A union runs on its aggregator, and its references are fitted to their own windows: every local member is probed.
    if (id === 'union') {
      await refreshUnions().catch(() => {})
      const preset = (await unions.get().catch(() => null))?.presets?.[modelName]
      if (!preset || !preset.enabled) return
      await Promise.all([preset.aggregator, ...preset.references.filter(item => item.enabled)].map(item => ensureWindow(item.provider, item.model).catch(() => {})))
      return
    }
    if (!isLocalServer(id)) return
    const key = id + String.fromCharCode(10) + modelName
    // A run that starts while the probe is still going waits for the same answer instead of choosing its budget without it
    // (this comes before the freshness check, which only describes finished probes).
    if (probes.has(key)) return probes.get(key)
    if (Date.now() - (detected.get(key) || 0) < 60000) return
    const generation = generationOf(id)
    const probe = (async () => {
      const endpoint = await endpointOf(id)
      const apiKey = await keyStore(id).readKey().catch(() => null)
      const running = await detectLocalWindow({ baseUrl: endpoint, fetchImpl: localFetch, apiKey }).catch(() => null)
      // An answer from an address the owner has since changed is dropped, never published to the new route.
      if (generationOf(id) !== generation) return
      const tokens = validWindow(running?.models?.[modelName]) ?? validWindow(running?.default)
      if (tokens) observed.set(key, tokens)
      else {
        // A server that reports its window only in its model list (vLLM: max_model_len): the list is asked at run time too, and it is
        // asked again each time this probe expires, so a restart at a smaller window is picked up.
        const client = await clientFor(id)
        const list = client.listModels ? await client.listModels(apiKey || null).catch(() => null) : null
        const advertised = Array.isArray(list) ? validWindow(list.find(item => item.id === modelName)?.contextWindow) : null
        if (advertised && generationOf(id) === generation) windows.set(key, advertised)
      }
      // Fresh only once the answer is in, and only if the address is still the one that was asked.
      if (generationOf(id) === generation) detected.set(key, Date.now())
    })().finally(() => { if (probes.get(key) === probe) probes.delete(key) })
    probes.set(key, probe)
    return probe
  }
  async function models(id) {
    definition(id)
    const generation = generationOf(id)
    let list
    try {
      if (id === 'chatgpt') list = await chatGPT.listModels()
      else if (id === 'union') { await refreshUnions(); list = [...aggregators.keys()].map(name => ({ id: name, label: unionLabels.get(name) || name, contextWindow: null })) }
      // NAJD runs Ollama with num_ctx 16384 (ollama.cjs), whatever the model could hold.
      else if (id === 'ollama') list = (await ollama.listModels()).map(name => ({ id: name, label: name, contextWindow: OLLAMA_WINDOW }))
      else {
        const key = await keyStore(id).readKey()
        if (!key && !keyOptional(id)) throw providerError('AUTH_REQUIRED')
        const client = await clientFor(id)
        list = client.listModels ? await client.listModels(key || null).catch(error => { if (definition(id).models && keyOptional(id) === false && !['AUTH_REQUIRED', 'PROVIDER_REJECTED'].includes(error?.code)) return definition(id).models.map(name => ({ id: name, label: name, contextWindow: modelWindow(null, name) })); throw error }) : definition(id).models.map(name => ({ id: name, label: name, contextWindow: modelWindow(null, name) }))
      }
      errors.delete(id)
      // A local server (llama.cpp, LM Studio...) knows the window it was started with; the list usually does not say.
      const running = isLocalServer(id) ? await detectLocalWindow({ baseUrl: await endpointOf(id), fetchImpl: localFetch, apiKey: await keyStore(id).readKey().catch(() => null) }).catch(() => null) : null
      return list.map(m => {
        const seen = validWindow(running?.models?.[m.id]) ?? validWindow(running?.default)
        const current = generationOf(id) === generation // a list fetched from an address that has since changed publishes nothing
        if (seen && current) observed.set(id + '\n' + m.id, seen)
        // A failed probe here never erases or enlarges what the running server reported before.
        const contextWindow = observed.get(id + '\n' + m.id) ?? validWindow(m.contextWindow) ?? modelWindow(null, m.id)
        if (current) windows.set(id + '\n' + m.id, contextWindow)
        return { ...m, contextWindow, efforts: reasoningEfforts(id, m.id) }
      })
    } catch (error) { const code = error?.code || 'PROVIDER_ERROR'; errors.set(id, code); throw providerError(code) }
  }
  const inputBudgetOf = (provider0, modelName0) => Math.floor((provider0 === 'union' ? 0.8 : 1) * inputBudgetRaw(provider0, modelName0))
  const UNKNOWN_WINDOW = 64000 // tokens assumed only when a model's window is not known
  const inputBudgetRaw = (provider0, modelName0) => { const { provider, model: modelName } = acting(provider0, modelName0); return Math.floor((provider === 'ollama' ? OLLAMA_WINDOW : observed.get(provider + String.fromCharCode(10) + modelName) ?? windows.get(provider + String.fromCharCode(10) + modelName) ?? modelWindow(null, modelName) ?? UNKNOWN_WINDOW) * 3) }
  // A union call: the references advise once per user turn (the first step of the turn), then the aggregator does the whole tool loop with their advice attached.
  async function unionChat({ modelName, history, signal, reasoningEffort, readPath, systemPrompt, agentTurn, routeToken, onAdvice }) {
    if (readPath !== undefined) throw providerError('TOOLS_NOT_SUPPORTED')
    await refreshUnions()
    const config = await unions.get()
    const preset = config.presets[modelName]
    if (!preset || !preset.enabled) throw providerError('UNION_NOT_FOUND')
    const aggregator = preset.aggregator
    const { identity, tokens } = await unionRoutes(preset)
    if (routeToken && routeToken !== identity) throw providerError('CREDENTIAL_CHANGED')
    // The aggregator route is fixed now, before the advisors run, and the union route is checked again afterwards.
    const aggregatorRoute = aggregator.provider === 'ollama' ? undefined : await captureRoute(aggregator.provider, aggregator.model)
    const fresh = !agentTurn || (typeof agentTurn.continuation === 'boolean' ? !agentTurn.continuation : !Array.isArray(agentTurn.input) || agentTurn.input.length === 0)
    // A delegated sub-agent sees only its own task, so nobody is consulted for it.
    const round = agentTurn?.noAdvice ? { advice: [], failed: [] } : await advisorRound(modelName, preset, history, { fresh, signal, identity, runKey: agentTurn?.runKey, routes: tokens })
    if (signal?.aborted) throw providerError('CANCELLED')
    // The advice is shown once, to the run that uses the round first.
    if (!round.shown && round.advice.length && typeof onAdvice === 'function') { round.shown = true; try { onAdvice(round.advice.map(({ provider, model, text }) => ({ provider, model, text }))) } catch {} }
    if (await unionRoute(preset) !== identity) throw providerError('CREDENTIAL_CHANGED')
    // The advice shares the aggregator's window with the conversation: it gets a bounded part of it.
    // At most 15% of the window (the union's history budget already leaves 20% free) and always within the system-prompt size rule.
    const adviceLimit = member => Math.max(0, Math.min(Math.floor(inputBudgetOf(member.provider, member.model) * 0.15), 390000 - String(systemPrompt || '').length))
    const result = await chat({ provider: aggregator.provider, modelName: aggregator.model, history, signal, reasoningEffort, systemPrompt: withAdvice(systemPrompt, round, adviceLimit(aggregator), teamNote(modelName, preset)), agentTurn, routeToken: aggregatorRoute })
    // The advisors usage is counted once: by the first run that uses the round, not again on every step.
    const owner = !round.claimed; round.claimed = true
    const usage = sumUsage(result.usage, ...(owner ? round.advice.map(item => item.usage) : []))
    return { ...result, ...(usage ? { usage } : {}), union: { preset: modelName, advisors: round.advice.map(({ provider, model, usage }) => ({ provider, model, usage })), failed: round.failed } }
  }
  async function chat({ provider, modelName, history, signal, reasoningEffort = 'auto', readPath, systemPrompt, agentTurn, routeToken, onAdvice }) {
    if (provider === 'union') return unionChat({ modelName, history, signal, reasoningEffort, readPath, systemPrompt, agentTurn, routeToken, onAdvice })
    const providerDefinition = definition(provider)
    if (agentTurn && !toolCapable(provider)) throw providerError('TOOLS_NOT_SUPPORTED')
    if (systemPrompt !== undefined && (typeof systemPrompt !== 'string' || !systemPrompt.trim() || systemPrompt.length > 400000 || readPath !== undefined)) throw providerError('INVALID_INPUT')
    if (readPath !== undefined) {
      readTool(readPath)
      if (!['chatgpt', 'openai-api', 'ollama'].includes(provider)) throw providerError('TOOLS_NOT_SUPPORTED')
    }
    if (!Array.isArray(history) || !history.length || history.some(message => typeof message?.text !== 'string') || typeof modelName !== 'string') throw providerError('INVALID_INPUT')
    // This explicit test already has a complete target in its current intent;
    // unrelated conversation/earlier approvals are not part of its model input.
    const inferenceHistory = readPath === undefined ? history : [history.at(-1)]
    if (signal?.aborted) throw providerError('CANCELLED')
    const policy = await policyStore.get()
    if (signal?.aborted) throw providerError('CANCELLED')
    const cloud = providerDefinition.kind !== 'local'
    const effort = resolveReasoning(provider, modelName, history?.at(-1)?.text, reasoningEffort)
    activeRequests++
    if (cloud) cloudAttempts++
    const controller = new AbortController()
    if (!requests.has(provider)) requests.set(provider, new Set())
    requests.get(provider).add(controller)
    const timeout = AbortSignal.timeout(policy.timeoutMs)
    const combined = AbortSignal.any([controller.signal, timeout, ...(signal ? [signal] : [])])
    let key
    try {
      let result
      if (provider === 'chatgpt') result = await chatGPT.chat({ modelName, history: inferenceHistory, signal: combined, reasoningEffort: effort, readPath, maxOutputTokens: policy.maxOutputTokens, ...(systemPrompt === undefined ? {} : { systemPrompt }), ...(agentTurn ? { agentTurn } : {}), ...(routeToken ? { expectedAccountId: routeToken.slice('chatgpt:'.length) } : {}) })
      else if (provider === 'ollama') result = await ollama.chat({ modelName, history: inferenceHistory, signal: combined, readPath, maxOutputTokens: policy.maxOutputTokens, ...(systemPrompt === undefined ? {} : { systemPrompt }), ...(agentTurn ? { agentTurn } : {}) })
      else {
        key = await keyStore(provider).readKey()
        if (routeToken && (keyOptional(provider) && !key ? keyIdentity(provider, await endpointOf(provider)) !== routeToken : (!key || await keyedRoute(provider, key) !== routeToken))) throw providerError('CREDENTIAL_CHANGED')
        result = await (await clientFor(provider)).chat({ apiKey: key, modelName, history: inferenceHistory, signal: combined, reasoningEffort, readPath, maxOutputTokens: policy.maxOutputTokens, ...(systemPrompt === undefined ? {} : { systemPrompt }), ...(agentTurn ? { agentTurn } : {}) })
        if (combined.aborted) throw providerError('CANCELLED')
        if (key) await keyStore(provider).markVerified(key, modelName, combined)
      }
      if (combined.aborted) throw providerError('CANCELLED')
      errors.delete(provider)
      return { ...result, reasoningEffort: effort }
    } catch (error) {
      const code = signal?.aborted || controller.signal.aborted ? 'CANCELLED' : timeout.aborted ? 'PROVIDER_TIMEOUT' : error?.code || 'PROVIDER_ERROR'
      errors.set(provider, code)
      if (key && ['AUTH_REQUIRED', 'PROVIDER_REJECTED'].includes(code)) await keyStore(provider).markVerified(key, null).catch(() => {})
      throw providerError(code)
    } finally { requests.get(provider).delete(controller); activeRequests-- }
  }
  // Whether NAJD can run its agent tool loop with this provider and model right now.
  async function supportsTools(provider, modelName) {
    if (provider === 'union') { await refreshUnions(); const aggregator = aggregators.get(modelName); return !!aggregator && supportsTools(aggregator.provider, aggregator.model) }
    if (!toolCapable(provider)) return false
    if (provider !== 'ollama') return true
    try { return (await ollama.capabilities(modelName)).includes('tools') } catch { return false }
  }
  async function testModel(provider, modelName) { await chat({ provider, modelName, history: [{ role: 'user', text: 'Reply with OK.' }] }); return { verified: true } }
  function previewReasoning(id, model, text, preference) {
    definition(id)
    if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) throw providerError('INVALID_INPUT')
    return resolveReasoning(id, model, text, preference)
  }
  // Main-process only: the user's OpenAI API key for services they explicitly use with it (media generation).
  async function serviceKey(id) { if (id !== 'openai-api') throw providerError('INVALID_INPUT'); return keyStore(id).readKey() }
  // The acting model: a union acts through its aggregator.
  const acting = (provider, modelName) => provider === 'union' && aggregators.has(modelName) ? aggregators.get(modelName) : { provider, model: modelName }
  const contextWindow = (provider0, modelName0) => { const { provider, model: modelName } = acting(provider0, modelName0); return contextWindowOf(provider, modelName) }
  const contextWindowOf = (provider, modelName) => provider === 'ollama' ? OLLAMA_WINDOW
    : observed.get(provider + '\n' + modelName) ?? windows.get(provider + '\n' + modelName) ?? modelWindow(null, modelName)
  // Change the address of an OpenAI-compatible provider or local server (an empty address restores the default).
  async function setEndpoint(id, value) {
    if (!definition(id).editableUrl) throw providerError('INVALID_INPUT')
    stop(id)
    try { await endpointStore.set(id, value) } catch (error) { throw providerError(error?.code === 'INVALID_ENDPOINT' ? 'INVALID_ENDPOINT' : 'ENDPOINTS_UNAVAILABLE') }
    clientCache.delete(id); errors.delete(id)
    forgetWindows(id)
    return { endpoint: await endpointOf(id) }
  }
  // Which well-known local servers answer on their default port right now (this computer only, a short timeout each).
  async function detectLocal(fetchImpl = fetch) {
    const found = []
    await Promise.all(definitions.filter(p => p.kind === 'local' && p.baseUrl).map(async p => {
      const url = await endpointOf(p.id)
      try {
        const response = await fetchImpl(url.replace(/\/+$/, '') + '/models', { signal: AbortSignal.timeout(1500), redirect: 'error' })
        if (response.ok) found.push({ id: p.id, name: p.name, endpoint: url })
      } catch { /* not running */ }
    }))
    return found.sort((a, b) => a.name.localeCompare(b.name))
  }
  return { catalog, models, contextWindow, setEndpoint, detectLocal, visionCapable: visionOf,
    modelGuidance: (provider, modelName, options) => { const target = acting(provider, modelName); return modelGuidancePrompt(target.provider, target.model, options) },
    unions: { get: () => unions.get(), save: async config => { const saved = await unions.save(config); await refreshUnions(); return saved } }, saveKey, clearKey, chat, testModel, supportsTools, captureRoute, resolveReasoning: previewReasoning, serviceKey,
    // No usage limits exist; these two stay for compatibility and report the fixed unlimited policy. inputBudget is how much history fits the model's own window.
    limits: async () => ({ policy: await policyStore.get(), cloudAttempts, activeRequests }),
    setLimits: async () => ({ policy: await policyStore.get(), cloudAttempts, activeRequests }),
    inputBudget: inputBudgetOf, ensureWindow,
    consoleUrl: id => { const p = definition(id); if (!p.consoleUrl) throw providerError('NOT_FOUND'); return p.consoleUrl },
    dispose: () => { for (const id of requests.keys()) stop(id) } }
}

module.exports = { createProviderService }
