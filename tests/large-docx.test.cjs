// R11-002: a Word reference whose XML is far above 2 MB but whose text is under the 4,000,000 character limit
// imports into the library (and so into a knowledge base).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { zipSync, strToU8 } = require('fflate')
const { createAssetLibrary } = require('../electron/asset-library.cjs')

test('a 1.5 million character Arabic DOCX with about 9 MB of XML imports whole', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-docx-large-'))
  const paragraph = '<w:p><w:pPr><w:jc w:val="right"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/><w:lang w:bidi="ar-SA"/></w:rPr><w:t>' +
    'المادة الأولى: يجب أن تكون الممرات خالية من العوائق وأن يكون عرضها مناسبًا للاستخدام الآمن. ' + '</w:t></w:r></w:p>'
  const body = paragraph.repeat(16000)
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>'
  assert.ok(Buffer.byteLength(xml) > 2 * 1024 * 1024)
  const docx = zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'word/document.xml': strToU8(xml) })
  const file = path.join(dir, 'code.docx')
  fs.writeFileSync(file, docx)
  const library = createAssetLibrary({ directory: path.join(dir, 'lib') })
  const item = await library.importFile(file)
  assert.ok(item.characters > 1_000_000 && item.characters < 4_000_000, String(item.characters))
  const read = await library.read(item.id, { offset: 1_000_000, limit: 200 })
  assert.match(read.text, /الممرات/)
})
