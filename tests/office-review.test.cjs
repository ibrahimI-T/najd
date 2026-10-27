// najd_office_review orchestration (docs/AGENT-PLATFORM-M3-PLAN.md, M3-8): refusals, the fail-closed route, results,
// stalls with cleanup, and the playback analysis on synthetic frames. A fake host plays the Office worker; the real
// worker runs against installed Office in tests/office-review-smoke.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')
const { createOfficeReview, analysePlayback, GRID } = require('../electron/office/office-review.cjs')

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-office-review-'))
const deck = file => fs.writeFileSync(file, zipSync({ 'ppt/presentation.xml': strToU8('<p:presentation/>'), 'ppt/slides/slide1.xml': strToU8('<p:sld/>') }))

// worker(request) -> result object written as result.json (or null to write nothing); steps: list of step names.
function fakeHost(worker, { steps = [], hang = false } = {}) {
  const jobs = new Map(), requests = []
  let next = 0
  return { requests, async invokeHost(name, args) {
    if (name === 'najd.process.list') return [...jobs.values()].map(job => ({ id: job.id, running: job.running, exitCode: 0 }))
    if (name === 'najd.process.stop') { const job = jobs.get(args.id); if (job) job.running = false; return { familyClosed: true } }
    const id = 'job' + ++next, job = { id, running: !!hang }
    jobs.set(id, job)
    const requestPath = (/-RequestPath '([^']+)'/.exec(args.command) || [])[1]
    if (requestPath) {
      const request = JSON.parse(fs.readFileSync(requestPath.replace(/''/g, "'"), 'utf8'))
      requests.push(request)
      if (request.mode === 'review') {
        for (const step of steps) fs.writeFileSync(path.join(request.outDir, 'step.json'), JSON.stringify({ step }))
        fs.writeFileSync(request.recordPath, JSON.stringify({ id: request.recordId, app: request.app, pid: 1, started: '1', copy: request.copy }))
      }
      // Only the review itself hangs; the cleanup worker it starts finishes.
      if (request.mode !== 'review') job.running = false
      const result = hang && request.mode === 'review' ? null : worker(request)
      if (result) fs.writeFileSync(path.join(request.outDir, 'result.json'), JSON.stringify(result))
    }
    return { id, pid: 1, created: '1' }
  } }
}

function setup(worker, options = {}) {
  const root = temp(), work = path.join(root, 'work'); fs.mkdirSync(work)
  const host = fakeHost(worker, options)
  const review = createOfficeReview({ stateRoot: path.join(root, 'state'), scriptPath: path.join(root, 'office-review.ps1'), host,
    resolveReadable: input => { const absolute = path.resolve(work, input); if (!absolute.startsWith(work)) throw Object.assign(new Error('x'), { code: 'PATH_NOT_ALLOWED' }); return absolute },
    appInstalled: async () => options.installed ?? true, prepareImage: async file => 'data:image/jpeg;base64,' + Buffer.from(path.basename(file)).toString('base64'),
    stepTimeoutMs: options.stepTimeoutMs ?? 5000, ...options.extra })
  return { root, work, host, review }
}

test('refusals: macro files, other formats, playback for non-decks and paths outside the allowed folders', async () => {
  const { work, review } = setup(() => null)
  for (const [name, code] of [['a.pptm', 'MACRO_FILE'], ['a.txt', 'UNSUPPORTED_FORMAT']]) {
    fs.writeFileSync(path.join(work, name), 'x')
    await assert.rejects(review.review({ path: name }), { code })
  }
  fs.writeFileSync(path.join(work, 'a.docx'), 'x')
  await assert.rejects(review.review({ path: 'a.docx', playback: true }), { code: 'INVALID_INPUT' })
  await assert.rejects(review.review({ path: '../outside.pptx' }), { code: 'PATH_NOT_ALLOWED' })
})

test('external content keeps Office closed before any worker starts; a missing application is reported', async () => {
  const { work, review, host } = setup(() => ({ ok: true }))
  fs.writeFileSync(path.join(work, 'linked.xlsx'), zipSync({ 'xl/workbook.xml': strToU8('<workbook/>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c><f>WEBSERVICE("https://example.com")</f></c></row></sheetData></worksheet>') }))
  const refused = await review.review({ path: 'linked.xlsx' })
  assert.equal(refused.officeRoute.state, 'unavailable'); assert.match(refused.officeRoute.reason, /external content present: formula not allowed: WEBSERVICE/)
  assert.equal(host.requests.length, 0, 'no Office worker was started')
  assert.equal(refused.originalUnchanged, true)
  const missing = setup(() => ({ ok: true }), { installed: false })
  deck(path.join(missing.work, 'd.pptx'))
  const result = await missing.review.review({ path: 'd.pptx' })
  assert.deepEqual(result.officeRoute, { state: 'unavailable', reason: 'Microsoft PowerPoint is not installed on this computer' })
})

test('a finished PowerPoint review maps the sequence, attaches previews, removes its private copy and leaves the file unchanged', async () => {
  const { root, work, review } = setup(request => {
    for (const name of ['slide-001.png', 'slide-002.png']) fs.writeFileSync(path.join(request.outDir, name), 'png')
    return { ok: true, instance: 'quit', slideSize: [960, 540], slideCount: 2, slides: [
      { index: 1, image: path.join(request.outDir, 'slide-001.png'), preview: true, transition: 0, transitionDuration: 0, effects: [{ shape: 'title', type: 10, trigger: 1, delay: 0, duration: 0.5, box: [0, 0, 100, 50] }] },
      { index: 2, image: path.join(request.outDir, 'slide-002.png'), preview: true, transition: 3849, transitionDuration: 0.7, effects: [{ shape: 'node1', type: 2, trigger: 3, delay: 0.25, duration: 0.6, box: [0, 0, 10, 10] }] }] }
  })
  deck(path.join(work, 'd.pptx'))
  const before = fs.readFileSync(path.join(work, 'd.pptx'))
  const result = await review.review({ path: 'd.pptx' })
  assert.equal(result.officeRoute.state, 'done')
  assert.deepEqual(result.slides[0].effects, [{ shape: 'title', effect: 'fade', trigger: 'click', delayS: 0, durationS: 0.5 }])
  assert.deepEqual(result.slides[1].transition, { office: 3849, durationS: 0.7 })
  assert.equal(result.slides[1].effects[0].effect, 'fly'); assert.equal(result.slides[1].effects[0].trigger, 'after')
  assert.equal(result.imageUrls.length, 2); assert.equal(result.previews, 2); assert.deepEqual(result.previewIndexes, [1, 2])
  assert.equal(result.originalUnchanged, true)
  assert.deepEqual(fs.readFileSync(path.join(work, 'd.pptx')), before)
  assert.deepEqual(fs.readdirSync(path.join(root, 'state', 'reviews')), [], 'the private copy is gone')
  assert.deepEqual(fs.readdirSync(path.join(root, 'state', 'records')), [], 'a quit instance leaves no record')
})

test('a stalled export is stopped, reported with its step, and the cleanup worker finishes the instance', async () => {
  const { work, review, host } = setup(request => request.mode === 'cleanup' ? { ok: true, records: request.records.map(record => ({ id: record.id, state: 'quit' })) } : null,
    { hang: true, steps: ['starting', 'opening', 'exporting'], stepTimeoutMs: 600 })
  fs.writeFileSync(path.join(work, 'r.docx'), zipSync({ 'word/document.xml': strToU8('<w:document/>') }))
  const result = await review.review({ path: 'r.docx' })
  assert.equal(result.officeRoute.state, 'unavailable')
  assert.equal(result.officeRoute.reason, 'Microsoft Word did not finish (exporting); Office may need activation')
  assert.equal(host.requests.at(-1).mode, 'cleanup', 'the cleanup worker ran for the ended review')
  assert.equal(host.requests.at(-1).records.length, 1)
  assert.equal((await review.cleanup()).pending, 0)
})

test('PowerPoint already open and a missing isolated instance are reported, not worked around', async () => {
  for (const [unavailable, reason] of [['powerpoint-running', 'PowerPoint is open; close it to get previews and playback checks'], ['no-isolated-instance', 'a separate Microsoft PowerPoint instance could not be started']]) {
    const { work, review } = setup(() => ({ ok: false, unavailable }))
    deck(path.join(work, 'd.pptx'))
    assert.equal((await review.review({ path: 'd.pptx' })).officeRoute.reason, reason)
  }
})

test('playback analysis: slide starts are measured, so a drifting video still verifies effects in order', async () => {
  // Slide 1: two fades in separate regions; slide 2: transition only; slide 3: an effect that changes nothing.
  // The real video runs 0.3 s late per slide (PowerPoint's drift); planned timing would sample the wrong moments.
  const result = { video: 'v.mp4', slideSize: [960, 540],
    slides: [{ index: 1, image: 's1', effects: [{ shape: 'a', box: [0, 0, 240, 135] }, { shape: 'b', box: [480, 270, 240, 135] }] }, { index: 2, image: 's2', effects: [] },
      { index: 3, image: 's3', effects: [{ shape: 'c', box: [0, 0, 240, 135] }] }],
    timeline: [{ index: 1, transitionDuration: 0, advance: 3, effects: [{ shape: 'a', start: 0.6, end: 1.1 }, { shape: 'b', start: 1.7, end: 2.2 }] },
      { index: 2, transitionDuration: 0.7, advance: 1, effects: [] }, { index: 3, transitionDuration: 0, advance: 2, effects: [{ shape: 'c', start: 0.6, end: 1.1 }] }] }
  const backgrounds = { s1: 20, s2: 90, s3: 140 }
  const plain = value => Buffer.alloc(GRID.width * GRID.height, value)
  const fill = (gray, x0, y0, x1, y1, value) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) gray[y * GRID.width + x] = value }
  // Actual starts: slide 1 at 0.3, slide 2 content at 0.3 + 3 + 0.7 + 0.3, slide 3 at that + 1 + 0.3.
  const s1 = 0.3, s2 = s1 + 3 + 0.7 + 0.3, s3 = s2 + 1 + 0.3
  const paint = time => {
    if (time < s1) return plain(0)
    if (time < s2 - 0.7) {
      const gray = plain(20)
      const level = start => time <= start ? 20 : time >= start + 0.5 ? 220 : 20 + 200 * (time - start) / 0.5
      fill(gray, 0, 0, 64, 36, level(s1 + 0.6)); fill(gray, 128, 72, 192, 108, level(s1 + 1.7))
      return gray
    }
    if (time < s2) return plain(55) // the transition
    return plain(time < s3 ? 90 : 140)
  }
  const extract = async (_file, options) => ({ frames: options.times.map(time => ({ time, gray: paint(time) })) })
  const loadGrid = async name => { const gray = plain(backgrounds[name]); if (name === 's1') { fill(gray, 0, 0, 64, 36, 220); fill(gray, 128, 72, 192, 108, 220) } return gray }
  const slides = await analysePlayback(result, extract, { loadGrid })
  assert.equal(slides[0].timing, 'measured slide start')
  assert.equal(slides[0].orderVerified, true, JSON.stringify(slides[0]))
  assert.deepEqual(slides[0].effects.map(effect => [effect.shape, effect.status, effect.unchangedBeforeStart, effect.tookTime]), [['a', 'verified', true, true], ['b', 'verified', true, true]])
  assert.deepEqual(slides[1], { slide: 2, timing: 'measured slide start', startS: 4.3, elementMotion: 'none' }, 'measured, including the 0.3 s per-slide drift')
  assert.equal(slides[2].effects[0].status, 'not visible'); assert.equal(slides[2].orderVerified, false)
  // Without slide pictures the planned times are used and said to be planned.
  const planned = await analysePlayback(result, extract)
  assert.equal(planned[0].timing, 'planned slide start')
})

test('M3-R6-01: playback sampling stays bounded and an effect after the sampled part of a long video is unverified with that reason', async () => {
  const long = { video: 'v.mp4', slideSize: [960, 540], slides: [{ index: 1, effects: [{ shape: 'early', box: [0, 0, 240, 135] }, { shape: 'late', box: [480, 270, 240, 135] }] }],
    timeline: [{ index: 1, transitionDuration: 0, advance: 90, effects: [{ shape: 'early', start: 1, end: 1.5 }, { shape: 'late', start: 75, end: 75.5 }] }] }
  let asked = 0
  const extract = async (_file, options) => { asked = options.times.length; return { frames: options.times.map(time => ({ time, gray: Buffer.alloc(GRID.width * GRID.height, 20) })) } }
  const [slide] = await analysePlayback(long, extract)
  assert.equal(asked, 600, 'at most 600 samples (60 s) however long the video')
  const late = slide.effects.find(effect => effect.shape === 'late')
  assert.equal(late.status, 'unverified'); assert.match(late.reason, /after the first 60 s of video that were sampled/)
  assert.notEqual(slide.effects.find(effect => effect.shape === 'early').reason, late.reason, 'an effect inside the sampled part is judged normally')
})

test('M3-I007/I010/I014: Office renders only the requested previews; a stalled review cleans only its own record', async () => {
  // The fake worker does what office-review.ps1 does: pictures only for slides imageFrom..imageFrom+imageCount-1.
  const { work, review, host } = setup(request => {
    const first = Math.max(1, Math.min(request.imageFrom, 3)), last = first + request.imageCount - 1
    const slides = [1, 2, 3].map(index => {
      const preview = index >= first && index <= last, image = preview ? path.join(request.outDir, `slide-00${index}.png`) : null
      if (image) fs.writeFileSync(image, 'png')
      return { index, image, preview, transition: 0, transitionDuration: 0, effects: [] }
    })
    return { ok: true, instance: 'quit', slideSize: [960, 540], slideCount: 3, slides }
  }, { extra: { maxImages: 2 } })
  deck(path.join(work, 'd.pptx'))
  const first = await review.review({ path: 'd.pptx' })
  assert.deepEqual(first.previewIndexes, [1, 2]); assert.match(first.previewNote, /Previews 1-2 of 3 are attached; review again/)
  assert.deepEqual([host.requests[0].imageFrom, host.requests[0].imageCount], [1, 2])
  const later = await review.review({ path: 'd.pptx', from: 3 })
  assert.equal(host.requests.at(-1).imageFrom, 3, 'the range reaches Office, not only the attached list')
  assert.deepEqual(later.previewIndexes, [3]); assert.equal(later.imageUrls.length, 1)
  assert.equal(Buffer.from(later.imageUrls[0].split(',')[1], 'base64').toString(), 'slide-003.png')
  await assert.rejects(review.review({ path: 'd.pptx', from: -1 }), { code: 'INVALID_INPUT' })
  assert.deepEqual((await review.review({ path: 'd.pptx', from: 0 })).previewIndexes, [1, 2], '0 means from the start')
  // Word: pages come back numbered, and the count is the document's.
  const word = setup(request => {
    const image = path.join(request.outDir, 'page-011.png'); fs.writeFileSync(image, 'png')
    return { ok: true, instance: 'quit', pages: 11, pageCount: 11, pageImages: [{ index: 11, image }] }
  })
  fs.writeFileSync(path.join(word.work, 'w.docx'), zipSync({ 'word/document.xml': strToU8('<w:document/>') }))
  const page = await word.review.review({ path: 'w.docx', from: 11 })
  assert.equal(word.host.requests[0].imageFrom, 11)
  assert.deepEqual(page.previewIndexes, [11]); assert.match(page.previewNote, /Previews 11 of 11/)

  const stalled = setup(request => request.mode === 'cleanup' ? { ok: true, records: request.records.map(record => ({ id: record.id, state: 'quit' })) } : null,
    { hang: true, steps: ['exporting'], stepTimeoutMs: 600 })
  // A record of another, unrelated review that is still pending must not be touched by this review's cleanup.
  fs.mkdirSync(path.join(stalled.root, 'state', 'records'), { recursive: true })
  fs.writeFileSync(path.join(stalled.root, 'state', 'records', 'other.json'), JSON.stringify({ id: 'other', app: 'powerpoint', pid: 9, started: '1', copy: 'C:/x/review-o.pptx' }))
  fs.writeFileSync(path.join(stalled.work, 'r.docx'), zipSync({ 'word/document.xml': strToU8('<w:document/>') }))
  await stalled.review.review({ path: 'r.docx' })
  const cleanups = stalled.host.requests.filter(request => request.mode === 'cleanup')
  assert.equal(cleanups.length, 1); assert.deepEqual(cleanups[0].records.map(record => record.app), ['word'])
  assert.ok(fs.existsSync(path.join(stalled.root, 'state', 'records', 'other.json')), 'the other review\'s record is left for its own cleanup')
})

test('M3-I013: an uncertain start asks the worker to stop, finishes its record and leaves no review marked active', async () => {
  const { root, work, review, host } = setup(request => request.mode === 'cleanup' ? { ok: true, records: request.records.map(record => ({ id: record.id, state: 'quit' })) } : null)
  const invoke = host.invokeHost.bind(host)
  let failStart = true
  host.invokeHost = async (name, args, ...rest) => {
    if (name === 'najd.process.start' && failStart && /-RequestPath/.test(args.command)) {
      failStart = false
      await invoke(name, args, ...rest) // the worker did start and wrote its ownership record
      throw Object.assign(new Error('lost'), { code: 'NOT_CONNECTED' })
    }
    return invoke(name, args, ...rest)
  }
  deck(path.join(work, 'd.pptx'))
  await assert.rejects(review.review({ path: 'd.pptx' }), { code: 'NOT_CONNECTED' })
  const cleanups = host.requests.filter(request => request.mode === 'cleanup')
  assert.equal(cleanups.length, 1, 'the leaked record was finished by the cleanup worker')
  assert.deepEqual(fs.readdirSync(path.join(root, 'state', 'records')), [])
  // A record the cleanup could not finish stays for the general cleanup, which no longer treats it as active.
  const pending = setup(request => request.mode === 'cleanup' ? { ok: true, records: request.records.map(record => ({ id: record.id, state: 'not-responding' })) } : null)
  const original = pending.host.invokeHost.bind(pending.host)
  let once = true
  pending.host.invokeHost = async (name, args, ...rest) => {
    if (name === 'najd.process.start' && once && /-RequestPath/.test(args.command)) { once = false; await original(name, args, ...rest); throw Object.assign(new Error('lost'), { code: 'TIMEOUT' }) }
    return original(name, args, ...rest)
  }
  deck(path.join(pending.work, 'd.pptx'))
  await assert.rejects(pending.review.review({ path: 'd.pptx' }), { code: 'TIMEOUT' })
  assert.equal(fs.readdirSync(path.join(pending.root, 'state', 'records')).length, 1)
  const before = pending.host.requests.filter(request => request.mode === 'cleanup').length
  assert.deepEqual(await pending.review.cleanup(), { pending: 1 })
  assert.equal(pending.host.requests.filter(request => request.mode === 'cleanup').length, before + 1, 'the general cleanup retried it')
})

test('M3-I017: the size limit holds before the file is hashed or copied; folders are refused', async () => {
  const { root, work, review, host } = setup(() => ({ ok: true }))
  const big = path.join(work, 'big.pptx')
  const handle = fs.openSync(big, 'w'); fs.ftruncateSync(handle, 100 * 1024 * 1024 + 1); fs.closeSync(handle)
  await assert.rejects(review.review({ path: 'big.pptx' }), { code: 'FILE_TOO_LARGE' })
  fs.mkdirSync(path.join(work, 'folder.pptx'))
  await assert.rejects(review.review({ path: 'folder.pptx' }), error => ['NOT_A_FILE', 'EISDIR', 'EPERM'].includes(error.code))
  assert.equal(host.requests.length, 0)
  assert.deepEqual(fs.readdirSync(path.join(root, 'state', 'reviews')), [], 'no private copy was left')
})

test('M3-I021: the kit job holds the pack until its family is closed; an open family keeps the lease and the folder', async () => {
  const leases = []
  const pack = { acquire: async () => { const lease = { sitePackages: 'C:/pack/site', hostId: null, released: false, bind(id) { lease.hostId = id }, release() { lease.released = true } }; leases.push(lease); return lease } }
  for (const familyClosed of [true, false]) {
    const { root, work, review, host } = setup(() => null, { installed: false, extra: { pack, getPython: async () => 'C:/py/python.exe', kitPath: 'C:/kit' } })
    const invoke = host.invokeHost.bind(host)
    host.invokeHost = async (name, args, ...rest) => {
      if (name === 'najd.process.start' && /kit_report\.py/.test(args.command)) { const started = await invoke(name, args, ...rest); fs.writeFileSync(args.log, 'NAJD-KIT {"lint":[]}\n'); return started }
      if (name === 'najd.process.list') return [] // the kit job is gone from the list: lost
      if (name === 'najd.process.stop') return { familyClosed }
      return invoke(name, args, ...rest)
    }
    deck(path.join(work, 'd.pptx'))
    const result = await review.review({ path: 'd.pptx' })
    const lease = leases.at(-1)
    assert.ok(lease.hostId, 'the lease was bound to the host job')
    // A job the host no longer lists is closed whatever stop says; an open family is the cancelled/timed-out case below.
    assert.equal(lease.released, true)
    assert.deepEqual(result.kit, { lint: [] })
    assert.deepEqual(fs.readdirSync(path.join(root, 'state', 'reviews')), [])
  }
  // Cancelled while the kit runs and the host cannot confirm the family closed: the lease stays bound, the folder stays.
  const { root, work, review, host } = setup(() => null, { installed: false, extra: { pack, getPython: async () => 'C:/py/python.exe', kitPath: 'C:/kit' } })
  const invoke = host.invokeHost.bind(host)
  const controller = new AbortController()
  host.invokeHost = async (name, args, ...rest) => {
    if (name === 'najd.process.start' && /kit_report\.py/.test(args.command)) { const started = await invoke(name, args, ...rest); setTimeout(() => controller.abort(), 50); return started }
    if (name === 'najd.process.list') return [{ id: 'job1', running: true }]
    if (name === 'najd.process.stop') return { familyClosed: false }
    return invoke(name, args, ...rest)
  }
  deck(path.join(work, 'd.pptx'))
  await assert.rejects(review.review({ path: 'd.pptx' }, { signal: controller.signal }), { code: 'CANCELLED' })
  const lease = leases.at(-1)
  assert.equal(lease.released, false); assert.ok(lease.hostId)
  assert.equal(fs.readdirSync(path.join(root, 'state', 'reviews')).length, 1, 'the working folder stays for the running family')
})

test('M3-R5-01: a package the scan could not read through is never opened by the kit; risky content in a read package still gets the kit report', async () => {
  const pack = { acquire: async () => ({ sitePackages: 'C:/pack/site', bind() {}, release() {} }) }
  for (const [reason, kitRuns] of [['package too large to check', false], ['not an Office Open XML package (encrypted or damaged)', false], ['package could not be checked in time', false],
    ['package could not be checked', false], ['external relationship: http://example.com/a.png', true]]) {
    const { work, review, host } = setup(() => null, { installed: false, extra: { pack, getPython: async () => 'C:/py/python.exe', kitPath: 'C:/kit', scan: async () => [reason] } })
    const invoke = host.invokeHost.bind(host)
    let kitStarted = false
    host.invokeHost = async (name, args, ...rest) => {
      if (name === 'najd.process.start' && /kit_report\.py/.test(args.command)) { kitStarted = true; const started = await invoke(name, args, ...rest); fs.writeFileSync(args.log, 'NAJD-KIT {"lint":[]}\n'); return started }
      if (name === 'najd.process.list') return []
      if (name === 'najd.process.stop') return { familyClosed: true }
      return invoke(name, args, ...rest)
    }
    deck(path.join(work, 'd.pptx'))
    const result = await review.review({ path: 'd.pptx' })
    assert.equal(kitStarted, kitRuns, reason)
    if (kitRuns) assert.deepEqual(result.kit, { lint: [] })
    else assert.equal(result.kit.unavailable, 'the kit did not open the file: ' + reason)
    assert.equal(result.officeRoute.state, 'unavailable')
  }
  // Cancelled during the scan: nothing else runs.
  const controller = new AbortController()
  const { work, review } = setup(() => null, { installed: false, extra: { pack, getPython: async () => 'C:/py/python.exe', kitPath: 'C:/kit', scan: async () => { controller.abort(); return ['scan cancelled'] } } })
  deck(path.join(work, 'd.pptx'))
  await assert.rejects(review.review({ path: 'd.pptx' }, { signal: controller.signal }), { code: 'CANCELLED' })
})

test('M3-I025: a workbook review claims recalculation only when Excel did it', async () => {
  for (const [calculation, pattern] of [['done', /^Values were recalculated by Excel/], ['unavailable-other-workbook', /^Excel did not recalculate \(unavailable-other-workbook\); values and errors are as last saved and were not verified/]]) {
    const { work, review } = setup(() => ({ ok: true, instance: 'quit', calculation, sheets: [{ name: 'S', errors: [], formulas: [] }] }))
    fs.writeFileSync(path.join(work, 'b.xlsx'), zipSync({ 'xl/workbook.xml': strToU8('<workbook/>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData/></worksheet>') }))
    const result = await review.review({ path: 'b.xlsx' })
    assert.equal(result.calculation, calculation); assert.match(result.note, pattern)
  }
})
