// NAJD presentation benchmark (docs/AGENT-PLATFORM-M3-PLAN.md, M3-10; docs/research/2026-10-18-agent-capabilities/
// M3-PRESENTATION-ACCEPTANCE.md). A fixed script (not a model) builds a ten-slide mixed Arabic/English deck from a new
// brief with the NAJD Office kit (tests/office-benchmark-deck.py), then najd_office_review checks it: lint, all slide
// previews from PowerPoint, the animation sequence and per-effect playback. The deck and previews are kept in a temporary
// folder (printed) for human review; nothing goes into the repository. Without PowerPoint it reports SKIPPED for the
// Office part and does not claim the benchmark.
// Usage: electron tests/office-benchmark-smoke.cjs   (npm run smoke:office-benchmark)
const { app, protocol, BrowserWindow, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { registerVideoScheme, createVideoFrames } = require('../electron/video-frames.cjs')
registerVideoScheme(protocol)
// A slide picture as the gray grid the playback check compares (BGRA bitmap from Electron's nativeImage).
const grayFromImage = image => { const sized = image.resize({ width: 256, height: 144, quality: 'good' }), bgra = sized.toBitmap(), gray = new Uint8Array(256 * 144); for (let p = 0; p < gray.length; p++) gray[p] = Math.round(0.114 * bgra[p * 4] + 0.587 * bgra[p * 4 + 1] + 0.299 * bgra[p * 4 + 2]); return gray }
app.on('window-all-closed', () => {})

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-office-benchmark-'))
  const work = path.join(root, 'deck'); fs.mkdirSync(work)
  const kitPath = path.join(__dirname, '../electron/packs')
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'host') })
  const pack = createOfficePack({ root: path.join(root, 'packs'), lockText: fs.readFileSync(path.join(kitPath, 'office-pack.lock.txt'), 'utf8'), getEngine: async () => engine, host: node,
    hostPid: () => node.hostPid(), lifecycle: createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json') }), logs: createExecLogs({ directory: path.join(root, 'logs') }) })
  const frames = createVideoFrames({ protocol, BrowserWindow })
  try {
    await pack.start()
    assert.equal((await pack.install()).state, 'ready')
    const lease = await pack.acquire()
    const built = Date.now()
    const run = spawnSync(python, ['-I', '-B', '-X', 'utf8', path.join(__dirname, 'office-benchmark-deck.py'), lease.sitePackages, kitPath, work], { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, TEMP: work, TMP: work, MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(root, 'mpl') } })
    lease.release()
    const buildMs = Date.now() - built
    assert.equal(run.status, 0, run.stderr)
    const deckReport = JSON.parse(run.stdout.trim().split('\n').pop())
    assert.deepEqual(deckReport.lint.issues, [], 'kit lint finds nothing to fix')
    assert.equal(deckReport.lint.slides.length, 10)
    const declared = deckReport.lint.slides.reduce((sum, slide) => sum + slide.animations, 0)
    const scriptBytes = fs.statSync(path.join(__dirname, 'office-benchmark-deck.py')).size
    if (!await defaultAppInstalled('powerpoint')) { console.log(`SKIPPED Office part: PowerPoint is not installed. Built and linted: 10 slides, ${declared} declared animations (not played). Deck: ${path.join(work, 'benchmark.pptx')}`); return }
    const review = createOfficeReview({ stateRoot: path.join(root, 'review'), scriptPath: path.join(__dirname, '../electron/office/office-review.ps1'), kitPath, host: node,
      resolveReadable: input => path.resolve(work, input), extractFrames: (file, options) => frames.extract(file, options), loadGrid: async file => grayFromImage(nativeImage.createFromPath(file)), pack, getPython: async () => python, maxImages: 12,
      prepareImage: async file => { const image = nativeImage.createFromPath(file); return image.isEmpty() ? null : 'data:image/png;base64,' + image.toPNG().toString('base64') } })
    const began = Date.now()
    const result = await review.review({ path: 'benchmark.pptx', playback: true })
    const reviewMs = Date.now() - began
    assert.equal(result.officeRoute.state, 'done', JSON.stringify(result.officeRoute))
    assert.equal(result.slideCount, 10); assert.equal(result.previews, 10); assert.equal(result.imageUrls.length, 10)
    const previews = path.join(root, 'previews'); fs.mkdirSync(previews)
    result.imageUrls.forEach((url, index) => fs.writeFileSync(path.join(previews, `slide-${String(index + 1).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64')))
    const sequence = result.slides.reduce((sum, slide) => sum + slide.effects.length, 0)
    assert.equal(sequence, declared, 'PowerPoint reads back every declared animation')
    const effects = result.playback.slides.flatMap(slide => slide.effects || [])
    const verified = effects.filter(effect => effect.status === 'verified').length
    const ordered = result.playback.slides.filter(slide => slide.effects).every(slide => slide.orderVerified)
    const summary = { slides: 10, declaredAnimations: declared, readBack: sequence, playbackVerified: verified, playbackChecked: effects.length, orderVerifiedOnAllSlides: ordered,
      notVisible: effects.filter(effect => effect.status === 'not visible').map(effect => effect.shape), unverified: effects.filter(effect => effect.status === 'unverified').length,
      buildSeconds: Math.round(buildMs / 100) / 10, reviewSeconds: Math.round(reviewMs / 100) / 10, scriptBytes, reviewResultBytes: JSON.stringify({ ...result, imageUrls: undefined }).length,
      originalUnchanged: result.originalUnchanged }
    fs.writeFileSync(path.join(root, 'benchmark-result.json'), JSON.stringify({ summary, playback: result.playback, slides: result.slides }, null, 1))
    assert.equal(summary.unverified, 0)
    assert.equal(verified, effects.length, 'every animation plays (measurable motion in its own region)')
    assert.equal(ordered, true, 'effects play in order on every slide')
    assert.equal(result.originalUnchanged, true)
    console.log('Presentation benchmark passed: ' + JSON.stringify(summary))
    console.log('Deck and previews kept for review in ' + root)
  } finally {
    await node.stop().catch(() => {})
  }
}

app.whenReady().then(() => main()).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
