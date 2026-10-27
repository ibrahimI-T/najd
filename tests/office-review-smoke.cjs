// najd_office_review against the installed Microsoft Office (docs/AGENT-PLATFORM-M3-PLAN.md, M3-8 acceptance). Runs in
// Electron (the playback check samples video frames with NAJD's own sampler). Temporary folders only; the "user" is
// played by tests/office-review-helper.ps1 with its own documents. Office is never killed by NAJD; anything a step
// leaves is closed by the helper. Without Office or the engine it says SKIPPED for that part.
// Usage: electron tests/office-review-smoke.cjs   (npm run smoke:office-review)
const { app, protocol, BrowserWindow, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync, fork } = require('node:child_process')
const { registerVideoScheme, createVideoFrames } = require('../electron/video-frames.cjs')
registerVideoScheme(protocol)
// A slide picture as the gray grid the playback check compares (BGRA bitmap from Electron's nativeImage).
const grayFromImage = image => { const sized = image.resize({ width: 256, height: 144, quality: 'good' }), bgra = sized.toBitmap(), gray = new Uint8Array(256 * 144); for (let p = 0; p < gray.length; p++) gray[p] = Math.round(0.114 * bgra[p * 4] + 0.587 * bgra[p * 4 + 1] + 0.299 * bgra[p * 4 + 2]); return gray }
app.on('window-all-closed', () => {})

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const helperScript = path.join(__dirname, 'office-review-helper.ps1')
const pids = name => spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-Process ${name} -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','`], { encoding: 'utf8' }).stdout.trim().split(',').filter(Boolean).map(Number)
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
async function waitFor(check, ms, label) { const end = Date.now() + ms; while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(200) } throw new Error('timed out waiting for ' + label) }

function helper(mode, state, file = '', copy = '') {
  fs.mkdirSync(state, { recursive: true })
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperScript, mode, state, file, copy], { stdio: 'ignore', windowsHide: true })
  return { child, ready: () => waitFor(() => fs.existsSync(path.join(state, 'ready.json')) && readJson(path.join(state, 'ready.json')), 90000, mode + ' ready'),
    stop: async () => { fs.writeFileSync(path.join(state, 'stop'), ''); await waitFor(() => fs.existsSync(path.join(state, 'after.json')), 60000, mode + ' after'); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); return readJson(path.join(state, 'after.json')) } }
}
// The private copy a paused review opened (reviews/<id>/review-<id>.<ext>).
const findCopy = (stateRoot, extension) => waitFor(() => {
  const base = path.join(stateRoot, 'reviews')
  for (const folder of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const step = path.join(base, folder, 'office', 'step.json')
    const copy = fs.readdirSync(path.join(base, folder)).find(name => name.startsWith('review-') && name.endsWith(extension))
    let current = null
    try { current = fs.existsSync(step) ? readJson(step).step : null } catch {} // the worker may be writing it right now
    if (copy && ['exporting', 'calculating'].includes(current)) return path.join(base, folder, copy)
  }
  return null
}, 90000, 'review copy')

async function main() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'NAJD AGENT', 'runtime')
  const engineName = fs.existsSync(base) ? fs.readdirSync(base).find(entry => entry.startsWith('engine-') && fs.existsSync(path.join(base, entry, 'najd-core.json'))) : null
  if (!engineName) { console.log('SKIPPED: the managed engine is not prepared; nothing was verified.'); return }
  const { createWindowsNode } = require('../electron/windows-node.cjs')
  const { createOfficePack } = require('../electron/office-pack.cjs')
  const { createProcessLifecycle } = require('../electron/process-lifecycle.cjs')
  const { createExecLogs } = require('../electron/exec-logs.cjs')
  const { createOfficeReview, defaultAppInstalled } = require('../electron/office/office-review.cjs')
  const engineRoot = path.join(base, engineName)
  const receipt = JSON.parse(fs.readFileSync(path.join(engineRoot, 'najd-core.json'), 'utf8'))
  const python = path.resolve(engineRoot, receipt.python)
  const engine = { python, uv: path.join(engineRoot, 'tools', fs.readdirSync(path.join(engineRoot, 'tools')).find(entry => /^uv-/.test(entry)), 'uv.exe'), receiptPython: receipt.python.replace(/\\/g, '/') }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-office-review-smoke-'))
  const work = path.join(root, 'work'); fs.mkdirSync(work)
  const kitPath = path.join(__dirname, '../electron/packs')
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'host') })
  const lifecycle = createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json') })
  const logs = createExecLogs({ directory: path.join(root, 'logs') })
  const pack = createOfficePack({ root: path.join(root, 'packs'), lockText: fs.readFileSync(path.join(kitPath, 'office-pack.lock.txt'), 'utf8'), getEngine: async () => engine, host: node, hostPid: () => node.hostPid(), lifecycle, logs })
  const frames = createVideoFrames({ protocol, BrowserWindow })
  const stateRoot = path.join(root, 'review-state')
  const make = (extra = {}) => createOfficeReview({ stateRoot, scriptPath: path.join(__dirname, '../electron/office/office-review.ps1'), kitPath, host: node, resolveReadable: input => path.resolve(work, input),
    extractFrames: (file, options) => frames.extract(file, options), loadGrid: async file => grayFromImage(nativeImage.createFromPath(file)), pack, getPython: async () => python, testHooks: true,
    prepareImage: async file => { const image = nativeImage.createFromPath(file); return image.isEmpty() ? null : 'data:image/jpeg;base64,' + image.toJPEG(70).toString('base64') }, ...extra })
  const review = make()
  const summary = []
  const done = summary.push.bind(summary)
  summary.push = (...items) => { for (const item of items) console.log('step: ' + item); return done(...items) }
  try {
    await pack.start()
    assert.equal((await pack.install()).state, 'ready')
    // Fixtures built with the NAJD Office kit and the pack.
    const lease = await pack.acquire()
    const built = spawnSync(python, ['-I', '-B', '-X', 'utf8', '-c', `
import site, sys; site.addsitedir(sys.argv[1]); sys.path.append(sys.argv[2])
import os, openpyxl
from najd_office import Deck, Doc
w = sys.argv[3]
d = Deck(theme="slate")
s = d.new_slide()
d.box(s, 0.8, 1.0, 3.6, 1.6, name="a", text="Short fade"); d.box(s, 7.8, 4.4, 3.6, 1.6, name="b", text="Delayed")
s.animate("a", "fade", "click", 0, 300).animate("b", "fade", "after", 500, 600)
s2 = d.new_slide()
d.box(s2, 0.8, 1.0, 3.6, 1.6, name="c", text="First click"); d.box(s2, 7.8, 4.4, 3.6, 1.6, name="e", text="Second click")
s2.animate("c", "wipe", "click", 0, 500, "left").animate("e", "zoom", "click", 0, 500)
d.section("Static", 3).transition("fade", 700)
d.save(os.path.join(w, "motion.pptx"))
d = Deck(); d.title_slide("User deck", "kept by the user"); d.save(os.path.join(w, "user.pptx"))
b = openpyxl.Workbook(); x = b.active; x["A1"] = 2; x["A2"] = 3; x["A3"] = "=SUM(A1:A2)"; x["B1"] = "=A1/0"; b.save(os.path.join(w, "data.xlsx"))
b = openpyxl.Workbook(); b.active["A1"] = "=RAND()"; b.save(os.path.join(w, "user.xlsx")); b.save(os.path.join(w, "user2.xlsx"))
b = openpyxl.Workbook(); b.active["A1"] = '=WEBSERVICE("https://example.com/collect")'; b.save(os.path.join(w, "linked.xlsx"))
doc = Doc(); doc.heading("تقرير"); doc.paragraph("Page one."); doc.save(os.path.join(w, "report.docx"))
print("BUILT")`, lease.sitePackages, kitPath, work], { encoding: 'utf8' })
    lease.release()
    assert.match(built.stdout, /BUILT/, built.stderr)
    const hasPowerPoint = await defaultAppInstalled('powerpoint'), hasExcel = await defaultAppInstalled('excel'), hasWord = await defaultAppInstalled('word')
    if (pids('POWERPNT').length) throw new Error('Close PowerPoint before running this smoke (it checks that NAJD never uses your PowerPoint).')

    // 1. External content: refused before any Office process starts.
    const excelBefore = pids('EXCEL')
    const linked = await review.review({ path: 'linked.xlsx' })
    assert.equal(linked.officeRoute.state, 'unavailable'); assert.match(linked.officeRoute.reason, /formula not allowed: WEBSERVICE/)
    assert.deepEqual(pids('EXCEL'), excelBefore, 'no Excel process was started')
    summary.push('external content refused before Office')
    // 1b. No PDF from a file the scan refused: the save is never reached.
    const linkedPdf = await review.review({ path: 'linked.xlsx', pdf: true }, { savePdf: async () => { throw new Error('a refused file must not be saved') } })
    assert.equal(linkedPdf.pdf.state, 'unavailable')
    summary.push('no PDF from a refused file')

    if (hasPowerPoint) {
      // 2. Review with playback: previews, sequence, per-effect playback evidence, original unchanged, PowerPoint quit.
      const began = Date.now()
      const motion = await review.review({ path: 'motion.pptx', playback: true })
      const reviewMs = Date.now() - began
      assert.equal(motion.officeRoute.state, 'done', JSON.stringify(motion.officeRoute))
      assert.equal(motion.slideCount, 3); assert.equal(motion.previews, 3); assert.equal(motion.imageUrls.length, 3)
      assert.deepEqual(motion.slides[0].effects.map(effect => [effect.shape, effect.effect, effect.trigger, effect.durationS]), [['a', 'fade', 'click', 0.3], ['b', 'fade', 'after', 0.6]])
      assert.deepEqual(motion.slides[1].effects.map(effect => [effect.shape, effect.effect, effect.trigger]), [['c', 'wipe', 'click'], ['e', 'zoom', 'click']])
      const play = motion.playback.slides
      assert.equal(play[0].orderVerified, true, JSON.stringify(play[0])); assert.equal(play[1].orderVerified, true, JSON.stringify(play[1]))
      assert.equal(play[0].effects[1].tookTime, true, 'the 600 ms fade takes time')
      assert.equal(play[2].elementMotion, 'none')
      assert.equal(motion.kit.lint.issueCount, 0, JSON.stringify(motion.kit.lint.issues))
      assert.equal(motion.originalUnchanged, true)
      assert.deepEqual(pids('POWERPNT'), [], 'PowerPoint started by the review was quit')
      // 2b. PDF of the checked copy, handed to the save step (the owner's approval lives there).
      const saved = []
      const asPdf = await review.review({ path: 'motion.pptx', pdf: true }, { savePdf: async (bytes, source) => { saved.push({ bytes, source }); return { status: 'written', path: 'motion.pdf', bytes: bytes.length } } })
      assert.equal(asPdf.pdf.state, 'saved', JSON.stringify(asPdf.pdf)); assert.equal(saved[0].bytes.subarray(0, 5).toString('latin1'), '%PDF-'); assert.equal(path.basename(saved[0].source), 'motion.pptx')
      assert.equal(asPdf.originalUnchanged, true); assert.deepEqual(pids('POWERPNT'), [], 'PowerPoint quit after the PDF')
      summary.push(`PowerPoint PDF made from the checked copy (${Math.round(saved[0].bytes.length / 1024)} KB)`)
      summary.push(`PowerPoint review with playback (${Math.round(reviewMs / 1000)} s): 3 previews, sequence read back, short fade, delayed effect and two click groups verified in order, static slide without element motion`)

      // 3. PowerPoint already open: the route is refused and the user's instance is untouched.
      const holder = helper('pp-hold', path.join(root, 'h-pp'))
      const { pid: userPid } = await holder.ready()
      const busy = await review.review({ path: 'motion.pptx' })
      assert.equal(busy.officeRoute.reason, 'PowerPoint is open; close it to get previews and playback checks')
      const held = await holder.stop()
      assert.equal(held.alive, true); assert.ok(userPid)
      await waitFor(() => !pids('POWERPNT').length, 30000, 'the user PowerPoint to exit')
      summary.push('PowerPoint already open: refused, user instance untouched')

      // 4. The user opens their own deck into the review's instance, then the review is cancelled (and, separately,
      //    stalls): only the review copy is closed; the user's deck stays open with its unsaved edit.
      for (const ending of ['cancel', 'stall']) {
        const controller = new AbortController()
        const reviewer = ending === 'stall' ? make({ stepTimeoutMs: 6000 }) : review
        const running = reviewer.review({ path: 'motion.pptx' }, { signal: controller.signal, testPause: { step: 'exporting', ms: ending === 'stall' ? 30000 : 20000 } }).catch(error => error)
        const copy = await findCopy(stateRoot, '.pptx')
        const user = helper('join-pp', path.join(root, 'h-join-' + ending), path.join(work, 'user.pptx'), copy)
        await user.ready()
        if (ending === 'cancel') controller.abort()
        const outcome = await running
        if (ending === 'cancel') assert.equal(outcome.code, 'CANCELLED')
        else { assert.equal(outcome.officeRoute.state, 'unavailable'); assert.match(outcome.officeRoute.reason, /did not finish \(exporting\)/) }
        const after = await user.stop()
        assert.deepEqual([after.open, after.copyOpen, after.unsaved], [true, false, true], ending + ': ' + JSON.stringify(after))
        await waitFor(() => !pids('POWERPNT').length, 30000, 'PowerPoint closed by the user helper')
        summary.push(`user joined before ${ending}: their deck stayed open with its unsaved edit; only the review copy was closed`)
      }

      // 5. Abrupt end of the controlling process: a child process owns the host and the review; it is killed while
      //    PowerPoint has the copy open. A fresh NAJD start's cleanup closes the copy and quits the review's instance.
      const childState = path.join(root, 'child-state')
      fs.writeFileSync(path.join(root, 'child.cjs'), `
const path = require('node:path')
const { createWindowsNode } = require(${JSON.stringify(path.join(__dirname, '../electron/windows-node.cjs'))})
const { createOfficeReview } = require(${JSON.stringify(path.join(__dirname, '../electron/office/office-review.cjs'))})
const node = createWindowsNode({ runtimeRoot: ${JSON.stringify(path.resolve(__dirname, '../.runtimes'))}, stateRoot: ${JSON.stringify(path.join(root, 'child-host'))} })
const review = createOfficeReview({ stateRoot: ${JSON.stringify(childState)}, scriptPath: ${JSON.stringify(path.join(__dirname, '../electron/office/office-review.ps1'))}, host: node, testHooks: true,
  resolveReadable: input => path.resolve(${JSON.stringify(work)}, input) })
review.review({ path: 'motion.pptx' }, { testPause: { step: 'exporting', ms: 60000 } }).then(() => process.exit(0), () => process.exit(1))
`)
      const child = fork(path.join(root, 'child.cjs'), [], { stdio: 'ignore' })
      await findCopy(childState, '.pptx')
      const reviewPowerPoint = pids('POWERPNT')
      assert.equal(reviewPowerPoint.length, 1)
      child.kill('SIGKILL')
      await new Promise(resolve => child.once('exit', resolve))
      await sleep(2000)
      assert.deepEqual(pids('POWERPNT'), reviewPowerPoint, 'NAJD never kills Office: the review instance survives the abrupt end')
      const restarted = createOfficeReview({ stateRoot: childState, scriptPath: path.join(__dirname, '../electron/office/office-review.ps1'), host: node, resolveReadable: input => input })
      // After an abrupt end, Windows releases the dead process's COM references within minutes; until then PowerPoint may
      // keep the copy. The cleanup is retried (as NAJD does at each start) and never kills.
      const cleanedAt = Date.now()
      await waitFor(async () => (await restarted.cleanup()).pending === 0 && !pids('POWERPNT').length, 8 * 60000, 'review PowerPoint closed by the cleanup')
      summary.push('cleanup after the abrupt end took ' + Math.round((Date.now() - cleanedAt) / 1000) + ' s')
      summary.push('abrupt end of the controlling process: the next start closed the copy and quit the review instance')

      // 6. Cleanup never activates: a record whose copy is already closed and whose process has exited.
      fs.mkdirSync(path.join(stateRoot, 'records'), { recursive: true })
      fs.writeFileSync(path.join(stateRoot, 'records', 'old.json'), JSON.stringify({ id: 'old', app: 'powerpoint', pid: 4, started: '1', copy: path.join(work, 'gone.pptx') }))
      assert.equal((await review.cleanup()).pending, 0)
      await sleep(1500)
      assert.deepEqual(pids('POWERPNT'), [], 'cleanup started no PowerPoint')
      summary.push('cleanup with an exited process started nothing')
    } else summary.push('SKIPPED PowerPoint parts: PowerPoint is not installed')

    if (hasExcel) {
      // 7. Excel: a user's own Excel instance with a volatile workbook stays unchanged; the review recalculates its copy only.
      const user = helper('xl-user', path.join(root, 'h-xl'), path.join(work, 'user.xlsx'))
      const before = await user.ready()
      const data = await review.review({ path: 'data.xlsx' })
      assert.equal(data.officeRoute.state, 'done', JSON.stringify(data.officeRoute)); assert.equal(data.calculation, 'done')
      assert.deepEqual(data.sheets[0].errors, [{ error: '#DIV/0!', cell: 'B1' }])
      assert.ok(data.sheets[0].formulas.some(item => item.cell === 'A3' && item.value === '5'))
      const after = await user.stop()
      assert.deepEqual([after.a1, after.calculation], [before.a1, before.calculation], 'the user workbook did not recalculate')
      summary.push('Excel: #DIV/0! and SUM recalculated in the copy; the user\'s own Excel and its RAND() value untouched')

      // 8. A user workbook joins the review's Excel instance before calculation: recalculation is refused.
      const running = review.review({ path: 'data.xlsx' }, { testPause: { step: 'calculating', ms: 15000 } })
      const copy = await findCopy(stateRoot, '.xlsx')
      const joiner = helper('join-xl', path.join(root, 'h-join-xl'), path.join(work, 'user2.xlsx'), copy)
      const joined = await joiner.ready()
      const joinedResult = await running
      assert.equal(joinedResult.calculation, 'unavailable-other-workbook')
      const joinedAfter = await joiner.stop()
      assert.deepEqual([joinedAfter.open, joinedAfter.a1, joinedAfter.calculation], [true, joined.a1, joined.calculation])
      summary.push('Excel: a user workbook that joined before calculation stopped the recalculation and stayed unchanged')
    } else summary.push('SKIPPED Excel parts: Excel is not installed')

    if (hasWord) {
      // 9. Word: pages rendered, or an honest report when Word cannot export (for example when Office is not activated).
      const report = await review.review({ path: 'report.docx' })
      if (report.officeRoute.state === 'done') { assert.ok(report.previews >= 1); summary.push(`Word: ${report.pages} page(s) rendered to previews`) }
      else { assert.match(report.officeRoute.reason, /Microsoft Word did not finish/); summary.push('Word: reported "' + report.officeRoute.reason + '"') }
      await waitFor(() => !pids('WINWORD').length, 60000, 'Word started by the review closed')
    }
    console.log('Office review smoke passed:\n- ' + summary.join('\n- '))
  } finally {
    await node.stop().catch(() => {})
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch (error) { console.warn('cleanup left', root, error.code) }
  }
}

app.whenReady().then(() => main()).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
