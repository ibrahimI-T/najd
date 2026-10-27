// najd_office_review (docs/AGENT-PLATFORM-M3-PLAN.md, M3-8): checks a .pptx, .docx or .xlsx without changing it. The
// NAJD Office kit's lint/inspect always run (with the pack). The Office route renders slides/pages, reads PowerPoint's
// animation sequence, verifies playback and recalculates workbooks, but only when the matching Microsoft Office
// application is installed and every safety condition holds; otherwise it says why. The user's file is never opened by
// Office: a private copy is, after the fail-closed scan (office-scan.cjs).
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const { scanOffice, LIMITS, UNCHECKED } = require('./office-scan.cjs')

const fail = code => Object.assign(new Error(code), { code })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const quote = value => "'" + String(value).replace(/'/g, "''") + "'"
const APPS = { '.pptx': 'powerpoint', '.docx': 'word', '.xlsx': 'excel' }
const EXECUTABLES = { powerpoint: 'POWERPNT.EXE', word: 'WINWORD.EXE', excel: 'EXCEL.EXE' }
const NAMES = { powerpoint: 'Microsoft PowerPoint', word: 'Microsoft Word', excel: 'Microsoft Excel' }
const EFFECTS = { 1: 'appear', 2: 'fly', 10: 'fade', 22: 'wipe', 23: 'zoom', 59: 'grow' }
const TRIGGERS = { 1: 'click', 2: 'with', 3: 'after' }
const GRID = { width: 256, height: 144 }

// Installed means registered under App Paths (machine or user), the way Windows finds the application.
function defaultAppInstalled(app) {
  const keys = ['HKLM', 'HKCU'].map(root => `${root}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${EXECUTABLES[app]}`)
  return Promise.all(keys.map(key => new Promise(resolve => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', key],
    { windowsHide: true, timeout: 10000 }, error => resolve(!error))))).then(found => found.some(Boolean))
}

// Hashes a regular file of at most maxBytes through one open handle, optionally copying it on the way (M3-I017): the
// size is checked on the handle before reading, and reading stops past the limit, so a large or growing file never
// fills memory. Returns the hash and the handle's stat.
async function hashFile(file, maxBytes, copyTo = null) {
  const handle = await fsp.open(file, 'r')
  let target = null
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw fail('NOT_A_FILE')
    if (stat.size > maxBytes) throw fail('FILE_TOO_LARGE')
    if (copyTo) target = await fsp.open(copyTo, 'wx')
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024)
    let total = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      total += bytesRead
      if (total > maxBytes) throw fail('FILE_TOO_LARGE')
      hash.update(buffer.subarray(0, bytesRead))
      if (target) await target.write(buffer, 0, bytesRead)
    }
    return { hash: hash.digest('hex'), stat }
  } finally {
    await target?.close().catch(() => {})
    await handle.close().catch(() => {})
  }
}
// Which previews are attached, as ranges of slide or page numbers the model can act on.
function previewNote(indexes, total) {
  if (!total) return undefined
  if (!indexes.length) return `No previews are attached (${total} in all); review again with from set to a slide or page to see them.`
  const ranges = []
  for (const index of indexes) {
    const last = ranges[ranges.length - 1]
    if (last && index === last[1] + 1) last[1] = index; else ranges.push([index, index])
  }
  const text = ranges.map(([a, b]) => a === b ? String(a) : a + '-' + b).join(', ')
  return `Previews ${text} of ${total} are attached` + (indexes.length < total ? '; review again with from set to see others.' : '.')
}
const readJson = async file => JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, ''))

// Mean absolute gray difference of two frames inside a grid rectangle.
function difference(a, b, rect) {
  let sum = 0, count = 0
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) { sum += Math.abs(a[y * GRID.width + x] - b[y * GRID.width + x]); count++ }
  return count ? sum / count : 0
}
// How much a region changed, fair to sparse text in a large box: the larger of the mean difference and 150 times the
// share of cells that changed clearly (more than 15 gray levels). Static regions of real PowerPoint videos measured
// under 1.5 (video noise); 2 or more is a visible change (small text in a wide box measured 2.0 to 2.5).
function change(a, b, rect, skip = []) {
  let sum = 0, clear = 0, count = 0
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) { if (skip.some(r => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) continue; const d = Math.abs(a[y * GRID.width + x] - b[y * GRID.width + x]); sum += d; if (d > 15) clear++; count++ }
  return count ? Math.max(sum / count, 150 * clear / count) : 0
}

// Per-effect playback evidence from the exported video (M3-012). The video is sampled once every 0.1 s, at most
// MAX_SAMPLES times (the first 60 s): each sample is a 256x144 gray grid, so the samples stay near 22 MB; effects later
// in a longer video are reported unverified with that reason. Each slide's
// start is measured, not added up (PowerPoint's video drifts by about 0.1 s per slide): the first frame whose
// non-animated area matches that slide's exported picture, after the previous slide. Each effect's shape region is then
// compared just before its start, in its middle and just after its end, relative to that measured start.
const STEP = 0.1, MAX_SAMPLES = 600
async function analysePlayback(result, extract, { loadGrid = null } = {}) {
  const [slideW, slideH] = result.slideSize
  const toGrid = box => {
    const x0 = Math.max(0, Math.floor(box[0] / slideW * GRID.width) - 1), y0 = Math.max(0, Math.floor(box[1] / slideH * GRID.height) - 1)
    const x1 = Math.min(GRID.width, Math.ceil((box[0] + box[2]) / slideW * GRID.width) + 1), y1 = Math.min(GRID.height, Math.ceil((box[1] + box[3]) / slideH * GRID.height) + 1)
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null
  }
  const slidesByIndex = new Map(result.slides.map(slide => [slide.index, slide]))
  const planned = result.timeline.reduce((sum, slide) => sum + slide.transitionDuration + slide.advance, 0)
  const count = Math.min(MAX_SAMPLES, Math.ceil((planned * 1.1 + 3) / STEP))
  const times = Array.from({ length: count }, (_, index) => Math.round(index * STEP * 1000) / 1000)
  const sampledS = (count - 1) * STEP
  const frames = (await extract(result.video, { times, gray: GRID })).frames
  const nearest = time => { const index = Math.round(time / STEP); return index >= 0 && index < frames.length ? frames[index].gray : null }
  const full = [0, 0, GRID.width, GRID.height]

  // Measured content starts. Slides of one deck share their background, so a slide is recognised only on the cells
  // that tell it apart from the slide before (its own title, layout and static content; animated shapes excluded). The
  // start is the first frame, after the previous slide's start, in which those cells match this slide's picture.
  // Without slide pictures, or when a slide cannot be told apart, the planned times are used and reported as planned.
  const starts = new Map()
  let measured = false
  if (typeof loadGrid === 'function') {
    measured = true
    // Compared as 4x4 block averages: text edges differ between a rendered picture and a compressed video frame, so single
    // cells are noisy, while block averages still tell slides apart.
    const BW = GRID.width / 4, BH = GRID.height / 4
    const blocks = gray => { const out = new Float32Array(BW * BH); for (let y = 0; y < GRID.height; y++) for (let x = 0; x < GRID.width; x++) out[(y >> 2) * BW + (x >> 2)] += gray[y * GRID.width + x] / 16; return out }
    const frameBlocks = frames.map(frame => blocks(frame.gray))
    let from = 0, previous = new Float32Array(BW * BH), previousSpan = 0 // before slide 1: a black frame
    for (const slide of result.timeline) {
      const info = slidesByIndex.get(slide.index)
      const grid = info?.image ? await loadGrid(info.image).catch(() => null) : null
      if (!grid) { measured = false; break }
      const picture = blocks(grid)
      const animated = new Uint8Array(BW * BH)
      for (const effect of info.effects) { const rect = toGrid(effect.box); if (rect) for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) animated[(y >> 2) * BW + (x >> 2)] = 1 }
      const cells = []
      for (let p = 0; p < picture.length; p++) if (!animated[p] && Math.abs(picture[p] - previous[p]) > 8) cells.push(p)
      if (cells.length < 3) { measured = false; break }
      const close = values => { let sum = 0; for (const p of cells) sum += Math.abs(values[p] - picture[p]); return sum / cells.length }
      // The best match inside the window where this slide can start sets the bar (rendered pictures and video frames
      // differ slightly); the start is the first frame that comes close to it.
      const first = Math.round(from / STEP), last = Math.min(frames.length, first + Math.ceil(((previousSpan + slide.transitionDuration) * 1.5 + 2) / STEP))
      let best = Infinity
      for (let index = first; index < last; index++) best = Math.min(best, close(frameBlocks[index]))
      let found = null
      if (best < 25) for (let index = first; index < last; index++) if (close(frameBlocks[index]) <= best + Math.max(1, best * 0.15)) { found = index * STEP; break }
      if (found === null) { measured = false; break }
      starts.set(slide.index, found)
      from = found + STEP
      previous = picture
      previousSpan = slide.advance
    }
  }
  let clock = 0
  return result.timeline.map(slide => {
    const content = measured ? starts.get(slide.index) : clock + slide.transitionDuration
    const end = content + slide.advance
    clock = (measured ? content : clock + slide.transitionDuration) + slide.advance
    const timing = measured ? 'measured slide start' : 'planned slide start'
    const anchor = { startS: Math.round(content * 100) / 100 }
    if (!slide.effects.length) {
      const a = nearest(content + 0.1), b = nearest(end - 0.15)
      return { slide: slide.index, timing, ...anchor, elementMotion: a && b ? (difference(a, b, full) >= 3 ? 'unexpected change' : 'none') : 'unverified' }
    }
    const boxes = new Map((slidesByIndex.get(slide.index)?.effects || []).map(effect => [effect.shape, effect.box]))
    const effectTypes = new Map((slidesByIndex.get(slide.index)?.effects || []).map(effect => [effect.shape, effect.type]))
    const first = Math.min(...slide.effects.map(effect => effect.start))
    const base = nearest(Math.max(content + 0.05, content + first - 0.15))
    const plans = slide.effects.map(effect => ({ shape: effect.shape, start: content + effect.start, finish: content + effect.end, duration: effect.end - effect.start,
      rect: toGrid(boxes.get(effect.shape) || [0, 0, 0, 0]), moves: (effectTypes.get(effect.shape) || 0) === 2 }))
    // Two shapes share an area when their boxes (without the sampling margin) overlap by at least a tenth of the smaller.
    const area = rect => Math.max(0, rect[2] - rect[0] - 2) * Math.max(0, rect[3] - rect[1] - 2)
    const overlaps = (x, y) => {
      if (!x.rect || !y.rect) return false
      const w = Math.min(x.rect[2] - 1, y.rect[2] - 1) - Math.max(x.rect[0] + 1, y.rect[0] + 1), h = Math.min(x.rect[3] - 1, y.rect[3] - 1) - Math.max(x.rect[1] + 1, y.rect[1] + 1)
      return w > 0 && h > 0 && w * h >= 0.1 * Math.max(1, Math.min(area(x.rect), area(y.rect)))
    }
    const effects = plans.map(effect => {
      // An earlier effect on the same area that ends just before this one starts moves the 'before' picture to its end.
      const earlierEnd = Math.max(-Infinity, ...plans.filter(other => other !== effect && overlaps(other, effect) && other.finish <= effect.start + 0.001).map(other => other.finish))
      const backToBack = earlierEnd > effect.start - 0.15
      const beforeAt = backToBack ? Math.min(effect.start, earlierEnd + 0.05) : Math.max(content + 0.05, effect.start - 0.15), afterAt = Math.min(end - 0.05, effect.finish + 0.25)
      // Another effect changing the same area while this one is measured makes the change unattributable (M3-I006).
      const concurrent = plans.some(other => other !== effect && overlaps(other, effect) && other.start < effect.finish && other.finish > effect.start)
      const before = nearest(beforeAt), after = nearest(afterAt)
      const middles = [0.35, 0.5, 0.65].map(share => nearest(effect.start + share * (effect.finish - effect.start))).filter(Boolean)
      // Past the sampled part of the video nothing is claimed (M3-R6-01).
      if (afterAt > sampledS) return { shape: effect.shape, status: 'unverified', reason: `after the first ${Math.round(sampledS)} s of video that were sampled` }
      if (!effect.rect || !base || !before || !middles.length || !after) return { shape: effect.shape, status: 'unverified', reason: 'frames missing' }
      if (concurrent) return { shape: effect.shape, status: 'unverified', reason: 'overlaps another effect that runs at the same time' }
      const changed = change(before, after, effect.rect)
      // Unchanged before its start: compared from the slide's reference picture, or from the end of the last earlier
      // effect on the same area.
      const reference = Number.isFinite(earlierEnd) ? nearest(Math.min(beforeAt, earlierEnd + 0.15)) : base
      // Back to back with an earlier effect there is no quiet moment to check, so the check does not apply.
      // Areas of effects that already ran are left out: a connector's box can touch the node that appeared before it.
      const ran = plans.filter(other => other !== effect && other.finish <= effect.start + 0.001 && other.rect).map(other => other.rect)
      const stillBefore = backToBack || !reference ? null : change(reference, before, effect.rect, ran) < 1.5
      // Taking time: a picture inside the effect lies between the two ends (each side at least a tenth of the whole change; an
      // instant change puts it at one end). A moving shape is judged on the whole slide, since it travels into its box.
      const region = effect.moves ? full : effect.rect, whole = effect.moves ? change(before, after, full) : changed
      const tookTime = effect.duration >= 0.4 ? middles.some(middle => change(before, middle, region) >= whole * 0.1 && change(middle, after, region) >= whole * 0.1) : null
      // Verified only when every applicable condition holds (M3-I006).
      const status = changed < 2 ? 'not visible' : stillBefore === false ? 'changed before its start' : tookTime === false ? 'did not take its duration' : 'verified'
      return { shape: effect.shape, status, change: Math.round(changed * 10) / 10, startS: Math.round(effect.start * 100) / 100, durationS: Math.round(effect.duration * 100) / 100,
        ...(stillBefore === null ? {} : { unchangedBeforeStart: stillBefore }), ...(tookTime === null ? {} : { tookTime }) }
    })
    const orderVerified = effects.every(effect => effect.status === 'verified')
    return { slide: slide.index, timing, ...anchor, effects, orderVerified }
  })
}

function createOfficeReview({ stateRoot, scriptPath, kitPath = '', host, hostReady = async () => true, resolveReadable, extractFrames = null, pack = null, getPython = async () => null,
  prepareImage = null, loadGrid = null, appInstalled = defaultAppInstalled, scan = scanOffice, stepTimeoutMs = 90000, timeoutMs = 180000, playbackTimeoutMs = 420000, maxImages = 8, testHooks = false }) {
  if (!path.isAbsolute(stateRoot || '') || !path.isAbsolute(scriptPath || '') || typeof host?.invokeHost !== 'function' || typeof resolveReadable !== 'function') throw fail('INVALID_INPUT')
  const records = path.join(stateRoot, 'records'), reviews = path.join(stateRoot, 'reviews')
  const locks = new Map()
  const lock = (app, work) => { const next = (locks.get(app) || Promise.resolve()).catch(() => {}).then(work); locks.set(app, next.catch(() => {})); return next }

  // Runs one fixed NAJD script through the desktop host's Job; a step that does not move for stepTimeoutMs is a stall.
  // cancelFile: asked first (the worker then closes its copy itself); the job is ended only if it has not stopped within
  // 20 s.
  // Returns the host job's id and whether its whole family was seen closed (familyClosed false: it may still run).
  async function hosted(command, { work, env, limitMs, signal, stepFile = null, cancelFile = null, onStarted = null }) {
    const log = path.join(work, 'worker-' + randomUUID() + '.log')
    const started = await host.invokeHost('najd.process.start', { command, cwd: work, log, env, timeoutMs: Math.min(limitMs, 3600000) }, 20000, { signal })
    onStarted?.(started)
    let outcome = 'running', exitCode = null, lastStep = null, lastMove = Date.now()
    const deadline = Date.now() + limitMs + 10000
    while (outcome === 'running') {
      if (signal?.aborted) {
        if (cancelFile) {
          await fsp.writeFile(cancelFile, '').catch(() => {})
          const grace = Date.now() + 20000
          while (Date.now() < grace) {
            const list = await host.invokeHost('najd.process.list', {}, 20000).catch(() => null)
            const live = Array.isArray(list) ? list.find(item => item.id === started.id) : null
            if (Array.isArray(list) && (!live || !live.running)) break
            await sleep(300)
          }
        }
        outcome = 'cancelled'; break
      }
      if (Date.now() > deadline) { outcome = 'timeout'; break }
      await sleep(300)
      if (stepFile) {
        const stat = await fsp.stat(stepFile).catch(() => null)
        if (stat && stat.mtimeMs !== lastStep) { lastStep = stat.mtimeMs; lastMove = Date.now() }
        if (Date.now() - lastMove > stepTimeoutMs) { outcome = 'stalled'; break }
      }
      const list = await host.invokeHost('najd.process.list', {}, 20000).catch(() => null)
      const live = Array.isArray(list) ? list.find(item => item.id === started.id) : null
      if (live?.timedOut) outcome = 'timeout'
      else if (live && !live.running) { outcome = 'finished'; exitCode = live.exitCode }
      else if (Array.isArray(list) && !live) outcome = 'lost'
    }
    const stopped = await host.invokeHost('najd.process.stop', { id: started.id }).catch(() => null)
    const familyClosed = outcome === 'finished' || outcome === 'lost' || stopped?.familyClosed === true
    const output = await fsp.readFile(log, 'utf8').catch(() => '')
    return { outcome, exitCode, output, id: started.id, familyClosed }
  }
  const workerCommand = requestPath => '& ([ScriptBlock]::Create([IO.File]::ReadAllText(' + quote(scriptPath) + ', [Text.Encoding]::UTF8))) -RequestPath ' + quote(requestPath)
  const workerEnv = work => ({ TEMP: work, TMP: work })

  // Finishes ended reviews (M3-I010): only records of reviews that are not running now; each application under its own
  // lock, so a cleanup never overlaps a review of the same application. A finished review cleans only its own record.
  const active = new Set()
  // Working folders of reviews whose kit job may still run (M3-I021), kept for that job.
  const retained = new Set()
  async function cleanupRecords(app, list, signal) {
    let pending = 0
    {
      const work = path.join(reviews, 'cleanup-' + randomUUID())
      await fsp.mkdir(work, { recursive: true })
      const requestPath = path.join(work, 'request.json')
      await fsp.writeFile(requestPath, JSON.stringify({ mode: 'cleanup', app, outDir: work, records: list }))
      await hosted(workerCommand(requestPath), { work, env: workerEnv(work), limitMs: 60000, signal }).catch(() => null)
      const result = await readJson(path.join(work, 'result.json')).catch(() => null)
      for (const record of list) {
        const state = result?.records?.find(row => row.id === record.id)?.state
        if (['resolved', 'quit'].includes(state)) await fsp.rm(path.join(records, record.file), { force: true })
        else pending++
      }
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {})
    }
    return { pending }
  }
  async function cleanup(signal) {
    const files = (await fsp.readdir(records).catch(() => [])).filter(name => name.endsWith('.json') && !active.has(name.slice(0, -5)))
    if (!files.length || !await hostReady().catch(() => false)) return { pending: files.length }
    const byApp = new Map()
    for (const name of files) {
      const record = await readJson(path.join(records, name)).catch(() => null)
      if (!record || !APPS['.' + (record.copy || '').split('.').pop()]) { await fsp.rm(path.join(records, name), { force: true }); continue }
      if (!byApp.has(record.app)) byApp.set(record.app, [])
      byApp.get(record.app).push({ ...record, file: name })
    }
    let pending = 0
    for (const [app, list] of byApp) pending += (await lock(app, () => cleanupRecords(app, list.filter(record => !active.has(record.id)), signal))).pending
    return { pending }
  }

  // Kit lint/inspect with the pack, as a fixed NAJD script. The pack lease is bound to the host job and released only
  // once its family is closed (M3-I021); otherwise it stays bound (the pack's sweep releases it when the host no longer
  // runs the job) and the review keeps its working folder for that family.
  async function kitReport(file, work, signal, keep) {
    const python = await getPython().catch(() => null)
    const lease = python && pack ? await pack.acquire().catch(() => null) : null
    if (!lease) return { unavailable: 'Office and design pack not installed' }
    let closed = false
    try {
      const script = path.join(kitPath, 'kit_report.py')
      const run = await hosted('& ' + quote(python) + ' -I -B -X utf8 ' + [script, lease.sitePackages, kitPath, file].map(quote).join(' '),
        { work, env: { ...workerEnv(work), MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(work, 'mpl') }, limitMs: 120000, signal, onStarted: started => lease.bind(started.id) })
      closed = run.familyClosed
      if (run.outcome === 'cancelled') throw fail('CANCELLED')
      const line = run.output.split(/\r?\n/).find(text => text.startsWith('NAJD-KIT '))
      return line ? JSON.parse(line.slice(9)) : { unavailable: 'kit report failed', detail: run.output.slice(-400) }
    } catch (error) {
      // A start the host refused never ran; anything else may have.
      if (error?.dispatched === false) closed = true
      throw error
    } finally {
      if (closed) lease.release()
      else keep.add(work)
    }
  }

  async function officeRoute(app, copy, work, { playback, from = 1, signal, testPause, exportPdf = false }) {
    if (!await appInstalled(app).catch(() => false)) return { state: 'unavailable', reason: NAMES[app] + ' is not installed on this computer' }
    if (!await hostReady().catch(() => false)) return { state: 'unavailable', reason: 'the local Windows companion is not connected' }
    return lock(app, async () => {
      const out = path.join(work, 'office'), recordId = randomUUID(), stepFile = path.join(out, 'step.json'), cancelFile = path.join(out, 'cancel')
      const recordFile = path.join(records, recordId + '.json')
      active.add(recordId)
      let run = null, failure = null, result = null, cleaned = null
      try {
        await fsp.mkdir(out, { recursive: true }); await fsp.mkdir(records, { recursive: true })
        const requestPath = path.join(work, 'request.json')
        // Structure for up to maxSlides; pictures only for the requested previews and, with playback, the slides it checks.
        await fsp.writeFile(requestPath, JSON.stringify({ mode: 'review', app, copy, outDir: out, recordPath: recordFile, recordId,
          slideWidth: 1280, maxSlides: 300, playbackSlides: 60, imageFrom: from, imageCount: maxImages, playback: !!playback, gapMs: 600, holdMs: 1000, videoHeight: 540, fps: 10,
          videoSeconds: Math.round(playbackTimeoutMs / 1000) - 30, exportPdf: !!exportPdf, ...(testHooks && testPause ? { testPause } : {}) }))
        run = await hosted(workerCommand(requestPath), { work, env: workerEnv(work), limitMs: playback ? playbackTimeoutMs : timeoutMs, signal, stepFile, cancelFile })
      } catch (error) {
        // An uncertain start (M3-I013): the worker may be running. It is asked to stop and given time to close its copy
        // itself (until its step file stops moving), then its record is finished like any other.
        failure = error
        await fsp.writeFile(cancelFile, '').catch(() => {})
        let last = null, quietSince = Date.now()
        for (const end = Date.now() + 20000; Date.now() < end && Date.now() - quietSince < 3000;) {
          await sleep(300)
          const stat = await fsp.stat(stepFile).catch(() => null)
          if (stat && stat.mtimeMs !== last) { last = stat.mtimeMs; quietSince = Date.now() }
        }
      }
      try {
        result = await readJson(path.join(out, 'result.json')).catch(() => null)
        // Whatever happened, a review-started instance and its copy are finished by the cleanup worker (never killed).
        // A record that cannot be finished now stays for the general cleanup, which runs once this review is no longer active.
        const own = fs.existsSync(recordFile) ? await readJson(recordFile).catch(() => null) : null
        if (own && result?.instance === 'quit' && run?.outcome === 'finished') await fsp.rm(recordFile, { force: true })
        else if (own) cleaned = await cleanupRecords(app, [{ ...own, file: recordId + '.json' }]).catch(() => ({ pending: 1 }))
      } finally { active.delete(recordId) }
      if (failure) throw failure
      const step = (await readJson(path.join(out, 'step.json')).catch(() => null))?.step
      if (run.outcome === 'cancelled') throw fail('CANCELLED')
      if (run.outcome === 'stalled' || run.outcome === 'timeout')
        return { state: 'unavailable', reason: `${NAMES[app]} did not finish (${step || 'starting'})` + (app === 'word' && step === 'exporting' ? '; Office may need activation' : ''),
          ...(cleaned?.pending ? { note: NAMES[app] + ' did not respond; NAJD left it open and will retry closing its copy later' } : {}) }
      if (!result) return { state: 'unavailable', reason: 'the Office worker did not report' }
      if (result.unavailable) return { state: 'unavailable', reason: result.unavailable === 'powerpoint-running' ? 'PowerPoint is open; close it to get previews and playback checks'
        : 'a separate ' + NAMES[app] + ' instance could not be started' }
      if (!result.ok) return { state: 'failed', reason: String(result.error || 'Office reported an error').slice(0, 300) }
      return { state: 'done', result, out }
    })
  }

  // testPause ({step, ms}) is honoured only when NAJD created this module with testHooks (smoke tests); the model's
  // arguments never reach it.
  // from: first slide or page of the previews; 0 (the tool's 'does not apply') means the first.
  // pdf: also make a PDF of the scanned private copy with Office; savePdf (from the runtime) saves it next to the source after the
  // owner approves the write. Nothing is converted when the scan found external content or Office is not available.
  async function review({ path: requested, playback = false, from = 1, pdf = false } = {}, { signal, testPause = null, savePdf = null } = {}) {
    if (!Number.isInteger(from) || from < 0 || from > 500) throw fail('INVALID_INPUT')
    from = from || 1
    if (typeof requested !== 'string' || !requested.trim()) throw fail('INVALID_INPUT')
    const absolute = await resolveReadable(requested)
    const extension = path.extname(absolute).toLowerCase()
    if (['.pptm', '.docm', '.xlsm', '.ppsm', '.potm', '.dotm', '.xltm'].includes(extension)) throw fail('MACRO_FILE')
    const app = APPS[extension]
    if (!app) throw fail('UNSUPPORTED_FORMAT')
    if (playback && app !== 'powerpoint') throw fail('INVALID_INPUT')
    if (pdf && typeof savePdf !== 'function') throw fail('INVALID_INPUT')
    const work = path.join(reviews, randomUUID())
    await fsp.mkdir(work, { recursive: true })
    const copy = path.join(work, 'review-' + randomUUID() + extension)
    try {
      // The size limit holds before anything is read; the hash and the private copy come from the same open file.
      const { hash: originalHash, stat: before } = await hashFile(absolute, LIMITS.maxInput, copy)
      const reasons = await scan(copy, { signal })
      if (signal?.aborted) throw fail('CANCELLED')
      // The kit opens the package in Python only after the scan has read all of it within its budgets (parts, part size,
      // total expanded size): a package the scan could not check (too large when expanded, damaged, encrypted, timed out)
      // is not handed to Python either (M3-R5-01).
      const unchecked = reasons.find(reason => UNCHECKED.has(reason))
      const kit = unchecked ? { unavailable: 'the kit did not open the file: ' + unchecked } : await kitReport(copy, work, signal, retained)
      const route = reasons.length ? { state: 'unavailable', reason: 'external content present: ' + reasons.slice(0, 6).join('; ') } : await officeRoute(app, copy, work, { playback, from, signal, testPause, exportPdf: !!pdf })
      const output = { status: 'reviewed', file: path.basename(absolute), kind: extension.slice(1), kit, officeRoute: { state: route.state, ...(route.reason ? { reason: route.reason } : {}), ...(route.note ? { note: route.note } : {}) } }
      const images = []
      let total = 0
      if (route.state === 'done') {
        const result = route.result
        if (app === 'powerpoint') {
          output.slides = result.slides.map(slide => ({ slide: slide.index, transition: slide.transition ? { office: slide.transition, durationS: Math.round(slide.transitionDuration * 100) / 100 } : null,
            effects: slide.effects.map(effect => ({ shape: effect.shape, effect: EFFECTS[effect.type] || 'effect-' + effect.type, trigger: TRIGGERS[effect.trigger] || String(effect.trigger),
              delayS: Math.round(effect.delay * 100) / 100, durationS: Math.round(effect.duration * 100) / 100 })) }))
          output.slideCount = result.slideCount
          // Every slide's structure is read up to maxSlides; say so when a deck is longer (M3-I014).
          if (result.slides.length < result.slideCount) output.structureNote = `Animations and transitions were read for slides 1-${result.slides.length} of ${result.slideCount}.`
          images.push(...result.slides.filter(slide => slide.image && slide.preview).map(slide => ({ index: slide.index, image: slide.image })))
          total = result.slideCount
          if (playback) {
            if (typeof extractFrames !== 'function' || !result.video) output.playback = { state: 'unverified', reason: 'video frames could not be read' }
            else output.playback = { state: 'checked', note: 'clicks were replaced by a fixed 0.6 s gap for the check', ...((result.timeline || []).length < result.slideCount ? { checkedSlides: [1, (result.timeline || []).length], slideCount: result.slideCount } : {}), slides: await analysePlayback(result, extractFrames, { loadGrid }).catch(error => [{ status: 'unverified', reason: error?.code || 'frames' }]) }
          }
        } else if (app === 'word') {
          output.pages = result.pages
          images.push(...(result.pageImages || []).filter(page => page && typeof page.image === 'string'))
          total = Number(result.pageCount) || result.pages || images.length
        } else {
          output.calculation = result.calculation
          output.sheets = (result.sheets || []).map(sheet => ({ name: sheet.name, errors: sheet.errors, formulas: sheet.formulas.slice(0, 10) }))
          // Only a calculation that ran is claimed (M3-I025).
          output.note = result.calculation === 'done' ? 'Values were recalculated by Excel in a private copy; the file itself was not changed.'
            : `Excel did not recalculate (${String(result.calculation || 'not run')}); values and errors are as last saved and were not verified. The file itself was not changed.`
        }
      } else if (app === 'powerpoint' && Array.isArray(kit?.inspect?.slides)) {
        output.declaredMotion = kit.inspect.slides.map(slide => ({ slide: slide.slide, animations: slide.animations.length, transition: slide.transition?.kind || null }))
        output.motionNote = 'declared in the file, not played'
      }
      // Previews (M3-I007/I014): Office rendered only slides or pages from..from+maxImages-1; imageUrls and previewIndexes
      // stay aligned, so the runtime can report exactly which ones reach the model.
      output.previews = total
      if (images.length && typeof prepareImage === 'function') {
        output.imageUrls = []; output.previewIndexes = []
        for (const { index, image } of images.slice(0, maxImages)) {
          const url = await prepareImage(image).catch(() => null)
          if (url) { output.imageUrls.push(url); output.previewIndexes.push(index) }
        }
        output.previewNote = previewNote(output.previewIndexes, total)
      }
      if (pdf) {
        const made = route.state === 'done' && typeof route.result?.pdf === 'string' ? path.resolve(route.result.pdf) : null
        // Only the file the worker wrote inside this review's own output folder, read as a regular file.
        const inside = made && path.dirname(made) === path.resolve(route.out) ? await fsp.lstat(made).catch(() => null) : null
        if (!inside?.isFile() || inside.size > 100 * 1024 * 1024) output.pdf = { state: 'unavailable', reason: route.state === 'done' ? 'Office did not make a PDF' : route.reason || 'the Office route did not run' }
        else {
          const saved = await savePdf(await fsp.readFile(made), absolute)
          output.pdf = saved?.status === 'written' ? { state: 'saved', path: saved.path, bytes: saved.bytes } : { state: saved?.status || 'not saved', ...(saved?.note ? { note: saved.note } : {}) }
        }
      }
      const after = await hashFile(absolute, LIMITS.maxInput).catch(() => null)
      output.originalUnchanged = !!after && after.stat.mtimeMs === before.mtimeMs && after.stat.size === before.size && after.hash === originalHash
      return output
    } finally {
      // Previews were read into the result; the private copy and its folder go (the cleanup record, if any, stays).
      if (!retained.has(work)) await fsp.rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
    }
  }

  return { review, cleanup, available: async () => true }
}

module.exports = { createOfficeReview, analysePlayback, difference, defaultAppInstalled, previewNote, GRID }
