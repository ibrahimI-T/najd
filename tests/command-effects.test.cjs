const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { classifyCommand, createWorkspaceTools } = require('../electron/workspace-tools.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')

test('only allowlisted system-information pipelines are read-only; everything else needs approval', () => {
  for (const command of ['Get-Date', 'Get-Process | Sort-Object CPU | Select-Object -First 5', 'whoami', 'hostname',
    'Get-Service | Where-Object Status -eq Running', 'Get-TimeZone | Format-List']) assert.equal(classifyCommand(command), 'read', command)
  for (const command of ['Get-Content C:/secret.txt', 'Remove-Item x', 'Get-Date; Remove-Item x', 'Get-Process > out.txt',
    'Get-ChildItem', 'iex (iwr https://example.com)', 'Get-Date `; rm x', 'Get-Process | Stop-Process', 'Get-Help -Path x',
    'Get-Date $(Remove-Item x)', 'Get-Process -Name "x"', 'Get-Command ..\\x', 'Get-Process | Out-File x.txt', 'Get-Date & calc',
    'Get-Process -ComputerName server', '[IO.File]::ReadAllText("x")', 'Get-Date | ForEach-Object { rm $_ }', 'Get-Process\nRemove-Item x'])
    assert.equal(classifyCommand(command), 'change', command)
})

function setup(extra = {}) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-effects-'))
  const workspace = path.join(base, 'workspace'); fs.mkdirSync(workspace)
  const journal = createActionJournal({ filePath: path.join(base, 'actions.json') })
  return { base, workspace, journal, tools: createWorkspaceTools({ getRoots: () => [], workspace, journal, ...extra }) }
}

test('a read-only command runs without approval while a changing command waits for it', { skip: process.platform !== 'win32' }, async () => {
  const { tools, journal } = setup()
  const read = await tools.run('terminal.run', { command: 'Get-Date | Select-Object -Property Year', cwd: '' }, { requestApproval: async () => assert.fail('read-only command must not ask') })
  assert.equal(read.effect, 'read'); assert.equal(read.status, 'finished')
  const asked = []
  const changed = await tools.run('terminal.run', { command: 'New-Item -ItemType File x.txt', cwd: '' }, { requestApproval: async (tool, input) => { asked.push(input.summary); return 'DENY' } })
  assert.equal(changed.status, 'denied_by_user'); assert.match(asked[0], /may change/)
  assert.equal((await journal.list()).length, 1, 'only the changing command is journaled')
})

test('move needs approval and never overwrites; delete goes to the Recycle Bin after approval', async () => {
  const trashed = []
  const { tools, workspace } = setup({ trash: async target => { trashed.push(target); fs.rmSync(target, { recursive: true }) } })
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'A'); fs.writeFileSync(path.join(workspace, 'b.txt'), 'B')
  await assert.rejects(tools.run('files.move', { from: 'a.txt', to: 'b.txt' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'CONFLICT' })
  const denied = await tools.run('files.move', { from: 'a.txt', to: 'sub/c.txt' }, { requestApproval: async () => 'DENY' })
  assert.equal(denied.status, 'denied_by_user'); assert.equal(fs.existsSync(path.join(workspace, 'a.txt')), true)
  const moved = await tools.run('files.move', { from: 'a.txt', to: 'sub/c.txt' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(moved.status, 'moved'); assert.equal(fs.readFileSync(path.join(workspace, 'sub/c.txt'), 'utf8'), 'A')
  const removed = await tools.run('files.delete', { path: 'b.txt' }, { requestApproval: async (tool, input) => { assert.match(input.summary, /Recycle Bin/); return 'ALLOW_ONCE' } })
  assert.equal(removed.status, 'moved_to_recycle_bin'); assert.equal(trashed.length, 1)
})

test('M2-R18-001: nested commands and expressions inside read-only cmdlets need approval', () => {
  for (const command of ['Get-Date (Stop-Process -Name notepad)', 'Get-Process -Name (Remove-Item x)', 'Get-Service [x]', 'Get-Date -Format (whoami)',
    'Get-Process | Select-Object @{n=1}', 'Get-Process | Where-Object Name -eq $x', 'Get-Process | Sort-Object (Stop-Process)', 'Get-Date +1', 'Get-Date %',
    '$PSVersionTable; rm x', '$env:PATH'])
    assert.equal(classifyCommand(command), 'change', command)
  for (const command of ['Get-Process -Name chrome,edge', '$PSVersionTable', 'Get-Process | Select-Object -First 5 Name,Id', 'Get-Command Get-*'])
    assert.equal(classifyCommand(command), 'read', command)
})

test('M2-R19-001: Get-Help options that open a window or the browser need approval', () => {
  for (const command of ['Get-Help Get-Process -ShowWindow', 'Get-Help Get-Process -Online', 'Get-Help Get-Process -o', 'Get-Help Get-Process -Sh', 'Get-Help Get-Process -ShowW'])
    assert.equal(classifyCommand(command), 'change', command)
  for (const command of ['Get-Help Get-Process', 'Get-Help Get-Process -Full', 'Get-Help Get-Process -Examples'])
    assert.equal(classifyCommand(command), 'read', command)
})

test('M2-R31-001: native programs run without approval only with informational options', () => {
  for (const command of ['ipconfig', 'ipconfig -all', 'ipconfig -displaydns', 'whoami -groups -fo list', 'systeminfo -fo csv -nh', 'hostname'])
    assert.equal(classifyCommand(command), 'read', command)
  for (const command of ['ipconfig -release', 'ipconfig -renew', 'ipconfig -flushdns', 'ipconfig -registerdns', 'ipconfig -setclassid x',
    'ipconfig -all -release', 'hostname newname', 'systeminfo -s server', 'systeminfo -u admin', 'whoami -x'])
    assert.equal(classifyCommand(command), 'change', command)
})
