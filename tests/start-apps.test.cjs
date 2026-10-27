// Opening any installed app by its Start menu name, asked in Arabic or English (owner request 2026-10-20).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createStartApps } = require('../electron/start-apps.cjs')
const { createDesktopTools } = require('../electron/desktop-tools.cjs')
const { selectProfile } = require('../electron/agent-toolsets.cjs')

const rows = [
  { Name: 'Discord', AppID: 'com.squirrel.Discord.Discord' }, { Name: 'Uninstall Discord', AppID: 'x' },
  { Name: 'Spotify', AppID: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' }, { Name: 'Word', AppID: 'Microsoft.Office.WINWORD.EXE.15' },
  { Name: 'Bad', AppID: 'a"b' }
]
const startApps = () => createStartApps({ run: async () => JSON.stringify(rows) })

test('Start apps are found by English or Arabic name; uninstallers and unsafe ids are skipped', async () => {
  const apps = startApps()
  assert.equal((await apps.find('Discord')).match.appId, 'com.squirrel.Discord.Discord')
  assert.equal((await apps.find('دسكورد')).match.name, 'Discord')
  assert.equal((await apps.find('ديسكورد')).match.name, 'Discord')
  assert.equal((await apps.find('وورد')).match.name, 'Word')
  assert.equal((await apps.find('spot')).match.name, 'Spotify')
  assert.equal((await apps.find('Bad')).match, null)
  assert.equal((await apps.find('nothing here')).match, null)
  assert.ok(!(await apps.list()).some(app => app.appId.includes('"')))
})

test('najd_desktop_open opens an installed app through its AppID after approval, and reports a missing one', async () => {
  const sent = []
  const host = { invokeHost: async (command, args) => { sent.push([command, args]); return {} } }
  const tools = createDesktopTools({ host, verifyMs: 200, resolveReadable: () => { throw Object.assign(new Error('x'), { code: 'PATH_NOT_ALLOWED' }) }, startApps: startApps() })
  const cards = []
  const ctx = { runId: 'r', requestApproval: async (tool, card) => { cards.push(card); return 'ALLOW_ONCE' } }
  const opened = await tools.open({ target: 'دسكورد' }, ctx)
  assert.equal(opened.status, 'opened'); assert.equal(opened.target, 'Discord')
  const opens = () => sent.filter(([command]) => command === 'najd.desktop.open')
  assert.deepEqual(opens()[0], ['najd.desktop.open', { appId: 'com.squirrel.Discord.Discord' }])
  assert.equal(cards[0].path, 'Discord')
  const missing = await tools.open({ target: 'Photoshop' }, ctx)
  assert.equal(missing.error, 'APP_NOT_FOUND'); assert.equal(opens().length, 1)
  await assert.rejects(tools.open({ target: 'C:\\secret\\a.txt' }, ctx), { code: 'PATH_NOT_ALLOWED' })
})

test('an Arabic "open" request loads the desktop tools', () => {
  assert.ok(selectProfile({ text: 'افتح دسكورد' }).extra.includes('desktop'))
  assert.ok(selectProfile({ text: 'open discord' }).extra.includes('desktop'))
})

test('I3-004: dotted app names open by their exact Start entry; a dotted name that is no app is treated as a file', async () => {
  const dotted = createStartApps({ run: async () => JSON.stringify([{ Name: 'Paint.NET', AppID: 'dotPDN.PaintDotNet' }, { Name: 'Battle.net', AppID: 'Battle.net' }, { Name: 'Report Viewer', AppID: 'report.viewer' }]) })
  assert.equal((await dotted.find('Paint.NET', { exact: true })).match.appId, 'dotPDN.PaintDotNet')
  assert.equal((await dotted.find('report', { exact: true })).match, null, 'exact matching does not guess')
  const sent = []
  const tools = createDesktopTools({ host: { invokeHost: async (command, args) => { if (command === 'najd.desktop.open') sent.push(args); return {} } }, verifyMs: 200, startApps: dotted,
    resolveReadable: input => { if (input === 'notes.txt') return 'C:/work/notes.txt'; throw Object.assign(new Error('x'), { code: 'PATH_NOT_ALLOWED' }) } })
  const ctx = { runId: 'r', requestApproval: async () => 'ALLOW_ONCE' }
  assert.equal((await tools.open({ target: 'Battle.net' }, ctx)).target, 'Battle.net')
  assert.equal((await tools.open({ target: 'notes.txt' }, ctx)).target, 'C:/work/notes.txt')
  await assert.rejects(tools.open({ target: 'report.docx' }, ctx), { code: 'PATH_NOT_ALLOWED' })
  assert.deepEqual(sent.map(args => args.appId || args.file), ['Battle.net', 'C:/work/notes.txt'])
})
