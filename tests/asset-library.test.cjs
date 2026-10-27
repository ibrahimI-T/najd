const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { zipSync, strToU8 } = require('fflate')
const { createAssetLibrary } = require('../electron/asset-library.cjs')

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-library-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'library')
  return { root, directory, library: createAssetLibrary({ directory, ...options }) }
}

test('library deduplicates, persists and returns bounded verified excerpts without source paths', async t => {
  const { root, directory, library } = await fixture(t)
  const source = path.join(root, 'notes.txt')
  await fs.writeFile(source, 'Hello NAJD\n'.repeat(1000))
  const item = await library.importFile(source)
  assert.match(item.id, /^[a-f0-9]{64}$/)
  assert.equal(item.status, 'ready')
  assert.equal(JSON.stringify(item).includes(root), false)
  assert.equal((await library.importFile(source)).id, item.id)
  assert.equal((await library.list()).length, 1)
  const reopened = createAssetLibrary({ directory })
  const excerpt = await reopened.read(item.id, { offset: 5, limit: 50 })
  assert.equal(excerpt.text.length, 50)
  assert.equal(excerpt.hasMore, true)
  assert.equal((await reopened.search('NAJD', [item.id]))[0].id, item.id)
  await assert.rejects(reopened.read('../../credentials'), { code: 'INVALID_INPUT' })
  await assert.rejects(reopened.read(item.id, { limit: 8001 }), { code: 'INVALID_INPUT' })
  assert.equal(await fs.readFile(source, 'utf8'), 'Hello NAJD\n'.repeat(1000))
})

test('library rejects sensitive files, protected roots, symlinks and unsupported formats', async t => {
  const { root, library } = await fixture(t, { protectedRoots: [path.join(os.tmpdir(), 'hermes-private')] })
  for (const name of ['.env.txt', 'credentials.json', 'id_rsa.txt', 'secret.pem', 'payload.exe']) {
    const file = path.join(root, name)
    await fs.writeFile(file, 'do not import')
    await assert.rejects(library.importFile(file))
  }
  const file = path.join(root, 'plain.txt')
  await fs.writeFile(file, 'safe')
  const protectedLibrary = createAssetLibrary({ directory: path.join(root, 'other'), protectedRoots: [root] })
  await assert.rejects(protectedLibrary.importFile(file), { code: 'PROTECTED_RESOURCE' })
  const link = path.join(root, 'linked.txt')
  try { await fs.symlink(file, link) } catch (error) { if (error.code === 'EPERM') return; throw error }
  await assert.rejects(library.importFile(link), { code: 'INVALID_INPUT' })
})

test('library preserves corrupt index and detects modified extracted content', async t => {
  const { root, directory, library } = await fixture(t)
  const source = path.join(root, 'memo.md')
  await fs.writeFile(source, 'original text')
  const item = await library.importFile(source)
  await fs.writeFile(path.join(directory, `${item.id}.txt`), 'tampered text')
  await assert.rejects(library.read(item.id), { code: 'LIBRARY_CORRUPT' })
  await fs.writeFile(path.join(directory, 'index.json'), '{broken')
  await assert.rejects(createAssetLibrary({ directory }).list(), { code: 'LIBRARY_CORRUPT' })
  assert.equal(await fs.readFile(path.join(directory, 'index.json'), 'utf8'), '{broken')
})

test('worker extracts DOCX text and rejects entity declarations', async t => {
  const { root, library } = await fixture(t)
  const source = path.join(root, 'document.docx')
  await fs.writeFile(source, zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Hello &amp; NAJD</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:document>') }))
  const item = await library.importFile(source)
  assert.match((await library.read(item.id)).text, /Hello & NAJD\nSecond line/)
  await fs.writeFile(source, zipSync({ 'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///private">]><w:t>&secret;</w:t>') }))
  await assert.rejects(library.importFile(source), { code: 'EXTRACTION_FAILED' })
})

const { minimalPdf } = require('./fixtures/library-documents.cjs')

test('worker extracts a real PDF locally without rendering or model requests', async t => {
  const { root, library } = await fixture(t)
  const source = path.join(root, 'report.pdf')
  await fs.writeFile(source, minimalPdf('NAJD local PDF extraction'))
  const item = await library.importFile(source)
  assert.match((await library.read(item.id)).text, /NAJD local PDF extraction/)
})

test('concurrent imports serialize index changes and enforce limits', async t => {
  const { root, library } = await fixture(t)
  const files = await Promise.all(['one', 'two', 'three'].map(async text => {
    const file = path.join(root, `${text}.txt`)
    await fs.writeFile(file, text)
    return file
  }))
  await Promise.all(files.map(file => library.importFile(file)))
  assert.equal((await library.list()).length, 3)
  const large = path.join(root, 'large.txt')
  await fs.writeFile(large, 'x'.repeat(4000001))
  await assert.rejects(library.importFile(large), { code: 'EXTRACTION_LIMIT' })
  assert.equal((await library.list()).length, 3)
})

test('generated artifacts join the library, are searchable, deduplicated and removable', async () => {
  const os = require('node:os'), fsx = require('node:fs'), pathx = require('node:path')
  const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'najd-art-'))
  const { createAssetLibrary: make } = require('../electron/asset-library.cjs')
  const library = make({ directory: pathx.join(dir, 'lib') })
  const source = pathx.join(dir, 'out', 'report.md')
  const first = await library.addArtifact({ name: 'report.md', text: 'Quarterly UNIQUE-ARTIFACT-WORD summary', source })
  assert.equal(first.origin, 'artifact'); assert.equal(first.source, source)
  assert.equal((await library.addArtifact({ name: 'report.md', text: 'Quarterly UNIQUE-ARTIFACT-WORD summary', source })).id, first.id)
  assert.equal((await library.search('unique-artifact-word'))[0].id, first.id)
  assert.match((await library.read(first.id)).text, /Quarterly/)
  await assert.rejects(library.addArtifact({ name: 'x', text: 'y', source: 'relative.txt' }), { code: 'INVALID_INPUT' })
  const reopened = make({ directory: pathx.join(dir, 'lib') })
  assert.equal((await reopened.list()).length, 1)
  await reopened.remove(first.id)
  assert.equal((await reopened.list()).length, 0)
  await assert.rejects(reopened.remove(first.id), { code: 'NOT_FOUND' })
  fsx.rmSync(dir, { recursive: true, force: true })
})

test('images import through the injected decoder, never become text, and return a verified JPEG data URL', async () => {
  const os = require('node:os'), fsx = require('node:fs'), pathx = require('node:path')
  const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'najd-img-'))
  const { createAssetLibrary: make } = require('../electron/asset-library.cjs')
  const source = pathx.join(dir, 'photo.png'); fsx.writeFileSync(source, Buffer.from('fake-png-bytes'))
  const noVision = make({ directory: pathx.join(dir, 'a') })
  await assert.rejects(noVision.importFile(source), { code: 'UNSUPPORTED_FORMAT' })
  const library = make({ directory: pathx.join(dir, 'b'), prepareImage: async bytes => Buffer.concat([Buffer.from('JPEG:'), bytes]) })
  const item = await library.importFile(source)
  assert.equal(item.kind, 'image'); assert.equal(item.characters, 0)
  assert.equal(await library.image(item.id), 'data:image/jpeg;base64,' + Buffer.from('JPEG:fake-png-bytes').toString('base64'))
  assert.match((await library.read(item.id)).text, /image/)
  assert.deepEqual(await library.search('fake'), [])
  assert.equal((await library.importFile(source)).id, item.id)
  const broken = make({ directory: pathx.join(dir, 'c'), prepareImage: async () => { throw new Error('decode') } })
  await assert.rejects(broken.importFile(source), { code: 'UNSUPPORTED_FORMAT' })
  fsx.rmSync(dir, { recursive: true, force: true })
})

test('videos are stream-hashed, never copied, and keep only verified sampled frames', async () => {
  const os = require('node:os'), fsx = require('node:fs'), pathx = require('node:path')
  const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'najd-vid-'))
  const { createAssetLibrary: make } = require('../electron/asset-library.cjs')
  const source = pathx.join(dir, 'clip.mp4'); fsx.writeFileSync(source, Buffer.alloc(4096, 7))
  let calls = 0
  const library = make({ directory: pathx.join(dir, 'lib'), prepareImage: async b => b,
    prepareVideo: async file => { calls++; assert.equal(file, fsx.realpathSync.native(source)); return { duration: 6, width: 640, height: 360, frames: [{ time: 1.5, jpeg: Buffer.from('F1') }, { time: 4.5, jpeg: Buffer.from('F2') }] } } })
  const item = await library.importFile(source)
  assert.equal(item.kind, 'video'); assert.equal(item.size, 4096)
  assert.equal(fsx.existsSync(pathx.join(dir, 'lib', item.id + '.blob')), false, 'original video is not copied')
  const sampled = await library.video(item.id)
  assert.deepEqual(sampled.frames.map(frame => frame.time), [1.5, 4.5])
  assert.equal(sampled.frames[1].url, 'data:image/jpeg;base64,' + Buffer.from('F2').toString('base64'))
  await library.importFile(source); assert.equal(calls, 1, 'same video is not processed twice')
  fsx.rmSync(dir, { recursive: true, force: true })
})

test('a video sound track is stored locally, verified on read and removed with the video', async () => {
  const os = require('node:os'), fsx = require('node:fs'), pathx = require('node:path')
  const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'najd-vid-audio-'))
  const { createAssetLibrary: make } = require('../electron/asset-library.cjs')
  const withSound = pathx.join(dir, 'talk.mp4'), silent = pathx.join(dir, 'silent.webm')
  fsx.writeFileSync(withSound, Buffer.alloc(4096, 1)); fsx.writeFileSync(silent, Buffer.alloc(4096, 2))
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(200, 3)])
  const library = make({ directory: pathx.join(dir, 'lib'), prepareVideo: async file => ({ duration: 6, width: 64, height: 36, frames: [{ time: 1, jpeg: Buffer.from('F') }],
    audio: file.endsWith('talk.mp4') ? { seconds: 6, truncated: false, wav } : null }) })
  const talk = await library.importFile(withSound), quiet = await library.importFile(silent)
  assert.equal(talk.audioSeconds, 6); assert.equal(quiet.audioSeconds, undefined)
  assert.deepEqual((await library.audio(talk.id)).wav, wav)
  await assert.rejects(library.audio(quiet.id), { code: 'NO_AUDIO' })
  assert.match((await library.read(talk.id)).text, /najd_video_transcribe/)
  fsx.writeFileSync(pathx.join(dir, 'lib', talk.id + '.wav'), Buffer.alloc(204, 9))
  await assert.rejects(library.audio(talk.id), { code: 'LIBRARY_CORRUPT' }, 'tampered sound is refused')
  await library.remove(talk.id)
  assert.equal(fsx.existsSync(pathx.join(dir, 'lib', talk.id + '.wav')), false)
  fsx.rmSync(dir, { recursive: true, force: true })
})

// M3-001/M3-006: workbooks and decks import, persist and read back in order; formulas keep their text.
const workbook = ({ calc = '', sheet2 = true } = {}) => zipSync({
  'xl/workbook.xml': strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/>${sheet2 ? '<sheet name="ملخص" sheetId="2" r:id="rId2"/>' : ''}</sheets>${calc}</workbook>`),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'),
  'xl/sharedStrings.xml': strToU8('<sst><si><t>Item</t></si><si><r><t>Total</t></r><r><t> cost</t></r></si></sst>'),
  'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2"><v>4</v></c><c r="B2"><f>A2*2</f><v>8</v></c><c r="C2"><f>SUM(A1:A2)</f><v/></c></row>' +
    '<row r="3"><c r="A3"><f t="shared" ref="A3:A4" si="0">B2+1</f><v>9</v></c></row><row r="4"><c r="A4"><f t="shared" si="0"/><v>10</v></c><c r="B4" t="b"><v>1</v></c><c r="C4" t="inlineStr"><is><t>&amp;done</t></is></c></row></sheetData></worksheet>'),
  'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>مرحبا</v></c></row></sheetData></worksheet>')
})

test('M3-I016: sparse rows keep their columns and skipped rows are marked', async t => {
  const { root, library } = await fixture(t)
  const source = path.join(root, 'sparse.xlsx')
  await fs.writeFile(source, zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Phone</t></is></c><c r="C1" t="inlineStr"><is><t>City</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Sara</t></is></c><c r="B2"/><c r="C2" t="inlineStr"><is><t>Riyadh</t></is></c></row>' +
      '<row r="3"><c r="B3"><v>5</v></c></row><row r="7"><c r="A7"><v>1</v></c><c r="AZ7"><v>2</v></c></row></sheetData></worksheet>')
  }))
  const text = (await library.read((await library.importFile(source)).id, { limit: 8000 })).text
  assert.equal(text, 'Sheet: S\nName\tPhone\tCity\nSara\t\tRiyadh\n\t5\n[row 7] 1\t[col AZ] 2')
})

test('workbooks import with sheets in order and formulas marked cached or not calculated, and survive a reopen', async t => {
  const { root, directory, library } = await fixture(t)
  const source = path.join(root, 'budget.xlsx')
  await fs.writeFile(source, workbook())
  const item = await library.importFile(source)
  assert.equal(item.kind, 'xlsx')
  const text = (await createAssetLibrary({ directory }).read(item.id, { limit: 8000 })).text
  assert.equal(text, 'Sheet: Budget\nItem\tTotal cost\n4\t=A2*2 → 8 (cached)\t=SUM(A1:A2) → [result not calculated]\n=B2+1 (shared) → 9 (cached)\n' +
    '=B2+1 (shared) → 10 (cached)\tTRUE\t&done\n\nSheet: ملخص\nمرحبا')
  const recalc = path.join(root, 'recalc.xlsx')
  await fs.writeFile(recalc, workbook({ calc: '<calcPr fullCalcOnLoad="1"/>', sheet2: false }))
  const again = await library.read((await library.importFile(recalc)).id, { limit: 8000 })
  assert.match(again.text, /=A2\*2 → \[result not calculated\]/)
  assert.doesNotMatch(again.text, /\(cached\)/)
})

test('decks import slides in presentation order; limits, entities and SVG are refused', async t => {
  const { root, library } = await fixture(t)
  const deck = path.join(root, 'deck.pptx')
  await fs.writeFile(deck, zipSync({
    'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>'),
    'ppt/slides/slide1.xml': strToU8('<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>'),
    'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:r><a:t>عنوان </a:t></a:r><a:r><a:t>أول</a:t></a:r></a:p><a:p><a:r><a:t>Point</a:t></a:r></a:p></p:sld>')
  }))
  const item = await library.importFile(deck)
  assert.equal(item.kind, 'pptx')
  assert.equal((await library.read(item.id, { limit: 8000 })).text, 'Slide 1\nعنوان أول\nPoint\n\nSlide 2\nSecond')
  const many = { 'xl/workbook.xml': strToU8('<workbook><sheets>' + '<sheet name="s" r:id="r"/>'.repeat(51) + '</sheets></workbook>') }
  await fs.writeFile(path.join(root, 'many.xlsx'), zipSync(many))
  await assert.rejects(library.importFile(path.join(root, 'many.xlsx')), { code: 'EXTRACTION_LIMIT' })
  await fs.writeFile(path.join(root, 'entity.xlsx'), zipSync({ 'xl/workbook.xml': strToU8('<!DOCTYPE x [<!ENTITY a "b">]><workbook/>') }))
  await assert.rejects(library.importFile(path.join(root, 'entity.xlsx')), { code: 'EXTRACTION_FAILED' })
  await fs.writeFile(path.join(root, 'big.pptx'), zipSync({ 'ppt/presentation.xml': strToU8('<p/>'), 'ppt/slides/slide1.xml': new Uint8Array(2 * 1024 * 1024 + 1) }))
  await assert.rejects(library.importFile(path.join(root, 'big.pptx')), { code: 'EXTRACTION_LIMIT' })
  // Any plain UTF-8 file is read as text (an SVG's source, an unknown extension); binary data stays refused.
  await fs.writeFile(path.join(root, 'logo.svg'), '<svg/>')
  assert.equal((await library.importFile(path.join(root, 'logo.svg'))).kind, 'text')
  await fs.writeFile(path.join(root, 'notes.policy'), 'Section 4: leave requests need 7 days notice.')
  const policy = await library.importFile(path.join(root, 'notes.policy'))
  assert.equal(policy.kind, 'text'); assert.match((await library.read(policy.id, { limit: 200 })).text, /7 days/)
  await fs.writeFile(path.join(root, 'blob.bin'), Buffer.from([1, 0, 2, 255, 0]))
  await assert.rejects(library.importFile(path.join(root, 'blob.bin')), { code: 'UNSUPPORTED_FORMAT' })
})

test('the original of a library file is returned only when it matches its content id', async t => {
  const { root, directory, library } = await fixture(t)
  const source = path.join(root, 'report.txt')
  await fs.writeFile(source, 'quarterly report')
  const item = await library.importFile(source)
  const copy = await library.original(item.id)
  assert.equal(copy.name, 'report.txt'); assert.equal(copy.bytes.toString(), 'quarterly report')
  await assert.rejects(library.original('f'.repeat(64)), { code: 'NOT_FOUND' })
  await assert.rejects(library.original('../x'), { code: 'INVALID_INPUT' })
  const blob = path.join(directory, item.id + '.blob')
  await fs.chmod(blob, 0o666); await fs.writeFile(blob, 'changed on disk')
  await assert.rejects(library.original(item.id), { code: 'LIBRARY_CORRUPT' })
})