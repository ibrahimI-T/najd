const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createDiagnostics, createErrorLog } = require('../electron/diagnostics.cjs')

test('the bundle masks secrets, shortens profile paths and never throws on a failing component', async () => {
  const diagnostics = createDiagnostics({
    versions: { app: '1.0.0' }, platform: { os: 'win32', home: 'C:\\Users\\najduser\\AppData' }, homeDirectory: 'C:\\Users\\najduser',
    components: { gateway: async () => ({ state: 'running', url: 'http://127.0.0.1:1234', note: 'Authorization: Bearer abcdefghijklmnop12345' }), broken: async () => { throw Object.assign(new Error('x'), { code: 'BOOM' }) } },
    activityTail: () => [{ time: '2026-01-01T00:00:00Z', action: 'terminal', decision: 'allowed', reason: 'run mytool --opaque Zk9s3cr3tValue', path: 'C:\\Users\\najduser\\Documents\\a.txt', text: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456' }],
    errorTail: () => [{ kind: 'uncaughtException', message: 'failed at D:\\Users\\other\\x' }], now: () => new Date('2026-01-01T00:00:00Z') })
  const bundle = await diagnostics.bundle()
  const text = JSON.stringify(bundle)
  assert.ok(!/sk-abcdefghijklmnop|abcdefghijklmnop12345/.test(text), 'secrets are masked')
  assert.ok(!/najduser/.test(text), 'the user name is not in the bundle')
  assert.ok(!/other/.test(text), 'another profile name is not in the bundle')
  assert.deepEqual(bundle.recentActivity, [{ time: '2026-01-01T00:00:00.000Z', action: 'terminal', decision: 'allowed' }], 'only allowlisted fields and codes leave')
  assert.ok(!/Zk9s3cr3t/.test(text), 'free-form text is never exported')
  assert.deepEqual(bundle.components.broken, { error: 'BOOM' })
  assert.equal(bundle.createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(bundle.schema, 1)
})

test('the error log is capped and keeps the newest lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-diag-'))
  const log = createErrorLog({ filePath: path.join(dir, 'errors.jsonl'), limit: 2000 })
  for (let i = 0; i < 80; i++) log.record('test', new Error('error number ' + i))
  assert.ok(fs.statSync(path.join(dir, 'errors.jsonl')).size <= 2600)
  const tail = log.tail(5)
  assert.match(tail[tail.length - 1].message, /error number 79/)
})
