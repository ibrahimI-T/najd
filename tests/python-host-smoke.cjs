// Real managed Python through the real NAJD desktop host (M2-R6-002): Arabic and emoji written by Python reach the
// excerpt and the paged log intact, error output is logged as Python wrote it (without PowerShell's wrapping), and
// the exit code is Python's. Uses only temporary folders. Needs the host built (node scripts/build-windows-node.cjs)
// and the managed engine prepared; without the engine it says so and exits without claiming a pass.
// Usage: node tests/python-host-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { createPythonTools } = require('../electron/python-tools.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')

async function main() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'NAJD AGENT', 'runtime')
  const engine = fs.existsSync(base) ? fs.readdirSync(base).find(name => name.startsWith('engine-') && fs.existsSync(path.join(base, name, 'najd-core.json'))) : null
  if (!engine) { console.log('SKIPPED: the managed engine is not prepared on this machine; nothing was verified.'); return }
  const python = path.resolve(base, engine, JSON.parse(fs.readFileSync(path.join(base, engine, 'najd-core.json'), 'utf8')).python)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-python-host-'))
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state') })
  const logs = createExecLogs({ directory: path.join(root, 'logs') })
  const tools = createPythonTools({ getPython: async () => python, host: node, logs, stateRoot: path.join(root, 'engine-state'), timeoutMs: 60000,
    checkFolder: async () => ({ absolute: root, exists: true }), createFolder: async () => root })
  const allow = { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'smoke' }
  try {
    const text = 'مرحبا بالعالم 😀 نجد'
    const done = await tools.run({ code: 'import sys\nfor i in range(400):\n    print(i, "' + text + '")\nprint("خطأ تجريبي", file=sys.stderr)\nsys.exit(3)', cwd: '' }, allow)
    assert.equal(done.exitCode, 3)
    assert.match(done.output, new RegExp('^0 ' + text, 'm'))
    let offset = 0, all = ''
    while (offset !== null) { const page = await logs.read({ logId: done.logId, offset, conversationId: 'smoke' }); all += page.text; offset = page.nextOffset }
    assert.ok(!all.includes('�'), 'no broken characters in the log')
    assert.match(all, new RegExp('^399 ' + text, 'm'))
    assert.match(all, /^خطأ تجريبي$/m)
    assert.doesNotMatch(all, /NativeCommandError|CategoryInfo/)
    // Trailing spaces, tabs and whitespace-only lines are kept exactly (M2-R23-003).
    const spaced = await tools.run({ code: ['print("value   ")', 'print("tab\\t")', 'print("   ")', 'print("end")'].join('\n'), cwd: '' }, allow)
    assert.equal(spaced.output, 'value   \ntab\t\n   \nend\n')
    // The host ends a run at its deadline by itself (M2-R16-002): a 3-second limit stops a script that sleeps for 60.
    const limited = createPythonTools({ getPython: async () => python, host: node, logs, stateRoot: path.join(root, 'engine-state-2'), timeoutMs: 3000,
      checkFolder: async () => ({ absolute: root, exists: true }), createFolder: async () => root })
    const began = Date.now()
    await assert.rejects(limited.run({ code: ['import time', 'print("start", flush=True)', 'time.sleep(60)', 'print("too late")'].join('\n'), cwd: '' }, allow),
      error => error.code === 'TIMEOUT' && error.familyClosed === true && error.effectUnknown === true)
    assert.ok(Date.now() - began < 20000, 'ended near its deadline')
    console.log('Python host smoke passed: Arabic and emoji intact in the excerpt and paged log, plain error output, Python exit code, exact whitespace, host-enforced deadline.')
  } finally {
    await node.stop()
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch (error) { console.warn('cleanup left', root, error.code) }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
