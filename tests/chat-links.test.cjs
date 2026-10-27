const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createChatLinkOpener, openWorkspaceFile } = require('../electron/chat-links.cjs')

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-links-'))
  const workspace = path.join(base, 'NAJD'); fs.mkdirSync(path.join(workspace, 'site'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'site', 'index.html'), '<p>hi</p>'); fs.writeFileSync(path.join(workspace, 'tool.exe'), 'x')
  fs.writeFileSync(path.join(base, 'secret.html'), 'secret')
  const opened = []
  const shell = { openExternal: async url => opened.push(['web', url]), openPath: async file => opened.push(['file', file]) }
  return { base, workspace, opened, open: createChatLinkOpener({ shell, workspaceRoot: workspace }) }
}
const fileUrl = file => 'file:///' + file.split(path.sep).join('/')

test('web links open in the browser, a workspace page opens as a file', async () => {
  const { open, opened, workspace } = setup()
  assert.equal(await open('https://example.com/a?b=1'), true)
  assert.equal(await open(fileUrl(path.join(workspace, 'site', 'index.html'))), true)
  assert.deepEqual(opened.map(item => item[0]), ['web', 'file'])
})

test('programs, other folders, traversal, network shares and other schemes never open', async () => {
  const { open, opened, workspace, base } = setup()
  for (const url of [fileUrl(path.join(workspace, 'tool.exe')), fileUrl(path.join(base, 'secret.html')), fileUrl(path.join(workspace, '..', 'secret.html')),
    fileUrl(path.join(workspace, 'site', '..', '..', 'secret.html')), 'file://server/share/a.html', 'javascript:alert(1)', 'ftp://x/a', 'not a url', fileUrl(path.join(workspace, 'missing.html'))]) {
    assert.equal(await open(url), false, url)
  }
  assert.deepEqual(opened, [])
})

test('a file path written in a reply opens or is shown in its folder only inside the workspace', async () => {
  const { workspace, base } = setup()
  const opened = []
  const shell = { openPath: async file => { opened.push(['open', file]); return '' }, showItemInFolder: file => opened.push(['reveal', file]) }
  const page = path.join(workspace, 'site', 'index.html')
  assert.equal(await openWorkspaceFile({ shell, workspaceRoot: workspace }, page, 'open'), true)
  assert.equal(await openWorkspaceFile({ shell, workspaceRoot: workspace }, path.join(workspace, 'tool.exe'), 'reveal'), true, 'a program can be shown, never run')
  for (const [target, mode] of [[path.join(workspace, 'tool.exe'), 'open'], [path.join(base, 'secret.html'), 'open'], [path.join(base, 'secret.html'), 'reveal'],
    [path.join(workspace, '..', 'secret.html'), 'reveal'], ['site\\index.html', 'open'], [path.join(workspace, 'missing.html'), 'open'], [42, 'open']]) {
    assert.equal(await openWorkspaceFile({ shell, workspaceRoot: workspace }, target, mode), false, String(target))
  }
  assert.deepEqual(opened.map(item => item[0]), ['open', 'reveal'])
})
