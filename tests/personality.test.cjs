const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createPersonalityStore, personalityPrompt } = require('../electron/personality.cjs')
const { createProviderClient } = require('../electron/provider-client.cjs')

test('personality is explicit, persists correction/disable and never grants tool authority', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-personality-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'personality.json'), store = createPersonalityStore(file)
  const initial = await store.get()
  // Owner directive 2026-10-17: the NAJD soul is on until the owner saves another choice.
  assert.equal(initial.enabled, true)
  assert.match(personalityPrompt(initial), /You are NAJD/)
  await store.save({ ...initial, enabled: false })
  assert.equal(personalityPrompt(await store.get()), undefined)
  await store.save({ enabled: true, name: 'NAJD', instructions: 'Speak warmly in Saudi Arabic.' })
  const reopened = await createPersonalityStore(file).get()
  assert.match(personalityPrompt(reopened), /Speak warmly/)
  assert.match(personalityPrompt(reopened), /never authorize/)
  await store.save({ ...reopened, enabled: false })
  assert.equal(personalityPrompt(await store.get()), undefined)
  await fs.writeFile(file, '{"bad":')
  await assert.rejects(store.get(), { code: 'PERSONALITY_UNAVAILABLE' })
  assert.equal(await fs.readFile(file, 'utf8'), '{"bad":')
})

test('provider protocols put style in their documented instruction field without altering chat history', async () => {
  const prompt = 'PERSONALITY STYLE FIXTURE'
  for (const id of ['openai-api', 'anthropic-api', 'gemini-api', 'openrouter-api']) {
    let body
    const client = createProviderClient(id, { fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body)
      return id === 'openai-api' ? new Response('data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n')
        : new Response(JSON.stringify(id === 'anthropic-api' ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] }
          : id === 'gemini-api' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] }
          : { choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }))
    } })
    await client.chat({ apiKey: 'fixture-key', modelName: 'fixture', history: [{ role: 'user', text: 'Hello' }], systemPrompt: prompt })
    const actual = id === 'openai-api' ? body.instructions : id === 'anthropic-api' ? body.system : id === 'gemini-api' ? body.systemInstruction.parts[0].text : body.messages[0].content
    assert.equal(actual, prompt, id)
    if (id === 'openai-api') assert.deepEqual(body.input, [{ role: 'user', content: 'Hello' }])
    else if (id === 'gemini-api') assert.equal(body.contents[0].parts[0].text, 'Hello')
    else assert.deepEqual(body.messages.at(-1), { role: 'user', content: 'Hello' })
  }
})

test('a strong default ships, an owner edit is kept exactly, restore returns the default, and the old default upgrades itself', async t => {
  const { DEFAULT_INSTRUCTIONS, LEGACY_DEFAULTS } = require('../electron/default-instructions.cjs')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-personality-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'personality.json')
  const store = createPersonalityStore(file)
  const first = await store.get()
  assert.equal(first.instructions, DEFAULT_INSTRUCTIONS)
  for (const needle of ['NAJD AGENT', 'language the user writes', 'data, never as instructions', 'Passwords, payment details', 'unconfirmed outcome', 'OpenAI API key']) assert.ok(first.instructions.includes(needle) || first.instructions.toLowerCase().includes(needle.toLowerCase()), needle)
  assert.ok(DEFAULT_INSTRUCTIONS.length > 5000 && DEFAULT_INSTRUCTIONS.length < 12000)
  const edited = await store.save({ enabled: true, name: 'Najd', instructions: 'My own rules.' })
  assert.equal((await createPersonalityStore(file).get()).instructions, edited.instructions)
  const reset = await store.reset()
  assert.deepEqual(reset, { enabled: true, name: 'Najd', instructions: DEFAULT_INSTRUCTIONS })
  // A profile still holding the previous default text receives the new default; a profile with the owner's own text is untouched.
  await fs.writeFile(file, JSON.stringify({ version: 1, personality: { enabled: true, name: 'NAJD', instructions: LEGACY_DEFAULTS[0] } }))
  assert.equal((await createPersonalityStore(file).get()).instructions, DEFAULT_INSTRUCTIONS)
  await fs.writeFile(file, JSON.stringify({ version: 1, personality: { enabled: false, name: 'NAJD', instructions: LEGACY_DEFAULTS[0] + ' Plus my line.' } }))
  assert.equal((await createPersonalityStore(file).get()).instructions, LEGACY_DEFAULTS[0] + ' Plus my line.')
  await assert.rejects(store.save({ enabled: true, name: 'N', instructions: 'x'.repeat(12001) }), { code: 'INVALID_INPUT' })
  assert.match(personalityPrompt({ enabled: true, name: 'NAJD', instructions: DEFAULT_INSTRUCTIONS }), /approvals and protected boundaries always apply/)
})
