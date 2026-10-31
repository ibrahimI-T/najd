const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWorkspaceTools } = require('../electron/workspace-tools.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

function setup() {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-ws-'))
  const workspace = path.join(base, 'workspace'), granted = path.join(base, 'granted'), secret = path.join(base, 'secret')
  for (const dir of [workspace, granted, secret]) fs.mkdirSync(dir)
  const journal = createActionJournal({ filePath: path.join(base, 'actions.json') })
  const tools = createWorkspaceTools({ getRoots: () => [granted], workspace, getProtectedRoots: () => [secret], journal })
  return { base, workspace, granted, secret, journal, tools }
}
const approve = decision => { const seen = []; const fn = async (tool, input) => { seen.push({ tool, input }); return decision }; fn.seen = seen; return fn }

test('reads, lists and searches stay inside the workspace and granted folders', async () => {
  const { base, workspace, granted, tools } = setup()
  fs.writeFileSync(path.join(granted, 'plan.md'), 'alpha\nNeedle here\nomega')
  fs.writeFileSync(path.join(base, 'outside.txt'), 'nope')
  assert.equal((await tools.run('files.read', { path: path.join(granted, 'plan.md'), offset: 0, limit: 100 })).text, 'alpha\nNeedle here\nomega')
  assert.deepEqual((await tools.run('files.list', { path: granted })).entries, [{ name: 'plan.md', type: 'file' }])
  fs.writeFileSync(path.join(workspace, 'note.txt'), 'w')
  assert.deepEqual((await tools.run('files.list', { path: '' })).entries, [{ name: 'note.txt', type: 'file' }], 'an empty path lists the workspace')
  const found = await tools.run('files.search', { path: granted, query: 'needle' }, {})
  assert.equal(found.matches[0].line, 2)
  await assert.rejects(tools.run('files.read', { path: path.join(base, 'outside.txt') }), { code: 'PATH_NOT_ALLOWED' })
  await assert.rejects(tools.run('files.read', { path: '..\\outside.txt' }), { code: 'PATH_NOT_ALLOWED' })
  assert.ok(workspace)
})

test('writes need approval; denial changes nothing and approval writes once with a verified journal record', async () => {
  const { workspace, journal, tools } = setup()
  const target = path.join(workspace, 'notes', 'a.txt')
  const denied = approve('DENY')
  const refused = await tools.run('files.write', { path: 'notes/a.txt', content: 'hello' }, { requestApproval: denied })
  assert.equal(refused.status, 'denied_by_user'); assert.equal(fs.existsSync(target), false)
  assert.equal(denied.seen[0].input.path, target)
  const allowed = approve('ALLOW_ONCE')
  const result = await tools.run('files.write', { path: 'notes/a.txt', content: 'hello' }, { requestApproval: allowed })
  assert.equal(result.status, 'written'); assert.equal(fs.readFileSync(target, 'utf8'), 'hello')
  const records = await journal.list()
  assert.deepEqual(records.map(item => item.state).sort(), ['COMPLETED', 'DENIED'])
  await assert.rejects(tools.run('files.write', { path: 'x.txt', content: 'x' }, {}), { code: 'PERMISSION_DENIED' })
})

test('protected and sensitive targets are refused before any approval is requested', async () => {
  const { secret, workspace, tools } = setup()
  const ask = approve('ALLOW_ONCE')
  await assert.rejects(tools.run('files.write', { path: path.join(secret, 'a.txt'), content: 'x' }, { requestApproval: ask }), { code: 'SENSITIVE_FILE' })
  await assert.rejects(tools.run('files.write', { path: path.join(workspace, '.env'), content: 'x' }, { requestApproval: ask }), { code: 'SENSITIVE_FILE' })
  await assert.rejects(tools.run('files.write', { path: path.join(workspace, 'nul'), content: 'x' }, { requestApproval: ask }), { code: 'PATH_NOT_ALLOWED' })
  assert.equal(ask.seen.length, 0)
})

test('edit replaces exactly one occurrence and rejects ambiguous text', async () => {
  const { workspace, tools } = setup()
  const file = path.join(workspace, 'e.txt'); fs.writeFileSync(file, 'one two two')
  await assert.rejects(tools.run('files.edit', { path: 'e.txt', find: 'two', replace: '2' }, { requestApproval: approve('ALLOW_ONCE') }), { code: 'AMBIGUOUS_MATCH' })
  await tools.run('files.edit', { path: 'e.txt', find: 'one', replace: '1' }, { requestApproval: approve('ALLOW_ONCE') })
  assert.equal(fs.readFileSync(file, 'utf8'), '1 two two')
})

test('a cancelled approval cancels the journal record and writes nothing', async () => {
  const { workspace, journal, tools } = setup()
  const cancelling = async () => { throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }) }
  await assert.rejects(tools.run('files.write', { path: 'c.txt', content: 'x' }, { requestApproval: cancelling }), { code: 'CANCELLED' })
  assert.equal(fs.existsSync(path.join(workspace, 'c.txt')), false)
  assert.equal((await journal.list())[0].state, 'CANCELLED')
})

test('terminal command runs only after approval, with bounded output and no secret environment', { skip: process.platform !== 'win32' }, async () => {
  const { tools } = setup()
  process.env.NAJD_TEST_SECRET_TOKEN = 'leak'
  const denied = await tools.run('terminal.run', { command: 'Write-Output hi', cwd: '' }, { requestApproval: approve('DENY') })
  assert.equal(denied.status, 'denied_by_user')
  const ok = await tools.run('terminal.run', { command: 'Write-Output hi; Write-Output ($env:NAJD_TEST_SECRET_TOKEN + "end")', cwd: '' }, { requestApproval: approve('ALLOW_ONCE') })
  assert.equal(ok.status, 'finished'); assert.equal(ok.exitCode, 0)
  assert.match(ok.output, /hi/); assert.doesNotMatch(ok.output, /leak/)
  delete process.env.NAJD_TEST_SECRET_TOKEN
})

test('the agent loop exposes workspace tools and a denied write is reported to the model', async () => {
  const { workspace, tools } = setup()
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) },
    library: { list: async () => [], read: async () => ({}), search: async () => [] }, workspace: tools })
  let turn = 0
  // A save request loads the full files toolset (write tools) on top of the general profile.
  const result = await runtime.run({ request: { text: 'احفظ البيانات في ملف r.txt' }, requestApproval: async () => 'DENY', respond: async request => {
    if (turn++ === 0) {
      assert.ok(request.tools.some(tool => tool.name === 'najd_files_write'))
      const args = { path: 'r.txt', content: 'data' }
      return { kind: 'agent-tools', calls: [{ name: 'najd_files_write', arguments: JSON.stringify(args), call_id: 'w1' }],
        items: [{ type: 'function_call', name: 'najd_files_write', arguments: JSON.stringify(args), call_id: 'w1' }] }
    }
    assert.match(request.input.at(-1).output, /denied_by_user/)
    return { kind: 'message', text: 'Not written' }
  } })
  assert.equal(result.text, 'Not written'); assert.equal(fs.existsSync(path.join(workspace, 'r.txt')), false)
})

test('an approved write registers the generated file in the library without making the write depend on it', async () => {
  const { workspace, journal } = setup()
  const seen = []
  const tools = createWorkspaceTools({ getRoots: () => [], workspace, journal, onArtifact: async entry => { seen.push(entry); return { id: 'f'.repeat(64) } } })
  const out = await tools.run('files.write', { path: 'doc.md', content: 'hello' }, { requestApproval: approve('ALLOW_ONCE') })
  assert.equal(out.libraryId, 'f'.repeat(64)); assert.equal(seen[0].name, 'doc.md'); assert.equal(seen[0].text, 'hello')
  const broken = createWorkspaceTools({ getRoots: () => [], workspace, onArtifact: async () => { throw new Error('x') } })
  assert.equal((await broken.run('files.write', { path: 'two.md', content: 'ok' }, { requestApproval: approve('ALLOW_ONCE') })).status, 'written')
})

test('a journal write failure after a completed effect is a warning, not a retryable failure', async () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-ws-'))
  const workspace = path.join(base, 'workspace'); fs.mkdirSync(workspace)
  const real = createActionJournal({ filePath: path.join(base, 'actions.json') })
  const journal = { ...real, prepare: real.prepare, decide: real.decide, claim: real.claim, cancel: real.cancel, abandon: real.abandon, list: real.list,
    finish: async () => { throw new Error('disk full') } }
  const tools = createWorkspaceTools({ getRoots: () => [], workspace, getProtectedRoots: () => [], journal })
  const result = await tools.run('files.write', { path: 'a.txt', content: 'done' }, { requestApproval: approve('ALLOW_ONCE') })
  assert.equal(result.status, 'written'); assert.equal(result.journalWarning, true)
  assert.equal(fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'), 'done')
})

test('a journal failure while recording a failed or unresolved effect keeps the executor failure and its uncertainty', async () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-ws-'))
  const workspace = path.join(base, 'workspace'); fs.mkdirSync(workspace)
  const real = createActionJournal({ filePath: path.join(base, 'actions.json') })
  const journal = { ...real, finish: async () => { throw new Error('disk full') } }
  const tools = createWorkspaceTools({ getRoots: () => [], workspace, getProtectedRoots: () => [], journal })
  // A command stopped mid-run leaves its effect unresolved; the journal then fails, but the executor's uncertainty must survive.
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 700)
  await assert.rejects(tools.run('terminal.run', { command: 'Start-Sleep -Seconds 20', cwd: '' }, { requestApproval: approve('ALLOW_ONCE'), signal: controller.signal }),
    failure => failure.effectStarted === true && failure.effectUnknown === true)
})

test('a PDF Office made is saved next to its source only after approval, never over an existing file, and only real PDF bytes', async () => {
  const { workspace, tools } = setup()
  const pdf = Buffer.from('%PDF-1.7\nfake body')
  const allow = approve('ALLOW_ONCE'), deny = approve('DENY')
  const denied = await tools.savePdf({ path: path.join(workspace, 'deck.pdf'), bytes: pdf, source: path.join(workspace, 'deck.pptx') }, { requestApproval: deny })
  assert.equal(denied.status, 'denied_by_user'); assert.equal(fs.existsSync(path.join(workspace, 'deck.pdf')), false)
  const saved = await tools.savePdf({ path: path.join(workspace, 'deck.pdf'), bytes: pdf, source: path.join(workspace, 'deck.pptx') }, { requestApproval: allow })
  assert.equal(saved.status, 'written'); assert.equal(fs.readFileSync(path.join(workspace, 'deck.pdf'), 'latin1'), '%PDF-1.7\nfake body')
  assert.match(allow.seen[0].input.summary, /Save the PDF Office made from deck\.pptx/)
  await assert.rejects(tools.savePdf({ path: path.join(workspace, 'deck.pdf'), bytes: pdf, source: 'deck.pptx' }, { requestApproval: allow }), { code: 'CONFLICT' })
  await assert.rejects(tools.savePdf({ path: path.join(workspace, 'x.pdf'), bytes: Buffer.from('not a pdf'), source: 'x' }, { requestApproval: allow }), { code: 'INVALID_INPUT' })
  await assert.rejects(tools.savePdf({ path: path.join(workspace, 'x.txt'), bytes: pdf, source: 'x' }, { requestApproval: allow }), { code: 'INVALID_INPUT' })
})
test('the NAJD workspace lists as empty before its first file is written', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { createWorkspaceTools } = require('../electron/workspace-tools.cjs')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-empty-workspace-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const workspace = path.join(base, 'NAJD')
  const tools = createWorkspaceTools({ getRoots: () => [], workspace })
  const listed = await tools.run('files.list', { path: '.' }, { requestApproval: async () => 'DENY' })
  assert.deepEqual(listed.entries, [])
  await assert.rejects(tools.run('files.list', { path: 'missing-folder' }, { requestApproval: async () => 'DENY' }), { code: 'READ_FAILED' })
})
