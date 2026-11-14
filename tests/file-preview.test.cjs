const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { previewFile, TEXT_LIMIT } = require('../electron/file-preview.cjs')

test('a file card preview reads text and pictures within limits and leaves other files to their app', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-preview-'))
  try {
    await fs.writeFile(path.join(dir, 'notes.md'), '# مرحبا\nline')
    const text = await previewFile(path.join(dir, 'notes.md'))
    assert.equal(text.kind, 'text'); assert.equal(text.language, 'markdown'); assert.equal(text.text, '# مرحبا\nline'); assert.equal(text.truncated, false)
    await fs.writeFile(path.join(dir, 'big.txt'), 'a'.repeat(TEXT_LIMIT + 10))
    const big = await previewFile(path.join(dir, 'big.txt'))
    assert.equal(big.text.length, TEXT_LIMIT); assert.equal(big.truncated, true)
    await fs.writeFile(path.join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const pic = await previewFile(path.join(dir, 'pic.png'))
    assert.equal(pic.kind, 'image'); assert.match(pic.dataUrl, /^data:image\/png;base64,/)
    await fs.writeFile(path.join(dir, 'report.docx'), 'PK')
    assert.equal((await previewFile(path.join(dir, 'report.docx'))).kind, 'other')
    await fs.writeFile(path.join(dir, 'fake.txt'), Buffer.from([0x41, 0x00, 0x42]))
    assert.equal((await previewFile(path.join(dir, 'fake.txt'))).kind, 'other')
    await assert.rejects(previewFile(path.join(dir, 'missing.txt')), { code: 'NOT_FOUND' })
    await assert.rejects(previewFile('relative.txt'), { code: 'INVALID_INPUT' })
    await assert.rejects(previewFile(dir), { code: 'NOT_FOUND' })
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('a Word document is previewed as its text, read by the isolated document worker, never by another program', async () => {
  const { zipSync, strToU8 } = require('fflate')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-preview-'))
  try {
    const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>تقرير NAJD</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>'
    await fs.writeFile(path.join(dir, 'report.docx'), zipSync({ 'word/document.xml': strToU8(xml) }))
    const result = await previewFile(path.join(dir, 'report.docx'))
    assert.equal(result.kind, 'text'); assert.equal(result.extracted, true)
    assert.match(result.text, /تقرير NAJD/); assert.match(result.text, /Second line/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('the preview and open handlers only reach recorded outputs or workspace files', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const outputs = source.slice(source.indexOf("ipcMain.handle('najd:outputs:preview'"), source.indexOf("ipcMain.handle('najd:outputs:preview'") + 700)
  assert.match(outputs, /outputs\.some\(item => item\.path === filePath\)/)
  const session = source.slice(source.indexOf("ipcMain.handle('najd:session:previewFile'"), source.indexOf("ipcMain.handle('najd:session:previewFile'") + 600)
  assert.match(session, /insideWorkspace\(target/)
})
