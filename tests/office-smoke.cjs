// Office and design pack, real (docs/AGENT-PLATFORM-M3-PLAN.md acceptance): installs the pack from the committed lock
// with the managed engine's uv through the real desktop host (network to PyPI), verifies it, then runs real Python
// through the real host to create a Word document (Arabic and English), a workbook with formulas and a chart, a deck
// and a matplotlib chart; reopens each with its library; checks the bootstrap keeps script semantics (__future__,
// __name__, __file__, exit codes, tracebacks); imports the documents into a temporary library; removes the pack.
// Temporary folders only. Without the engine it says so and exits without claiming a pass.
// Usage: node tests/office-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { createPythonTools } = require('../electron/python-tools.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')
const { createProcessLifecycle } = require('../electron/process-lifecycle.cjs')
const { createOfficePack } = require('../electron/office-pack.cjs')
const { createAssetLibrary } = require('../electron/asset-library.cjs')

async function main() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'NAJD AGENT', 'runtime')
  const name = fs.existsSync(base) ? fs.readdirSync(base).find(entry => entry.startsWith('engine-') && fs.existsSync(path.join(base, entry, 'najd-core.json'))) : null
  if (!name) { console.log('SKIPPED: the managed engine is not prepared on this machine; nothing was verified.'); return }
  const engineRoot = path.join(base, name)
  const receipt = JSON.parse(fs.readFileSync(path.join(engineRoot, 'najd-core.json'), 'utf8'))
  const python = path.resolve(engineRoot, receipt.python)
  const uvFolder = fs.readdirSync(path.join(engineRoot, 'tools')).find(entry => /^uv-/.test(entry))
  const engine = { python, uv: path.join(engineRoot, 'tools', uvFolder, 'uv.exe'), receiptPython: receipt.python.replace(/\\/g, '/') }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-office-smoke-'))
  const work = path.join(root, 'work'); fs.mkdirSync(work)
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state') })
  const logs = createExecLogs({ directory: path.join(root, 'logs') })
  const lifecycle = createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json') })
  const pack = createOfficePack({ root: path.join(root, 'packs', 'office'), lockText: fs.readFileSync(path.join(__dirname, '../electron/packs/office-pack.lock.txt'), 'utf8'),
    getEngine: async () => engine, host: node, hostPid: () => node.hostPid(), lifecycle, logs })
  const kitPath = path.join(__dirname, '../electron/packs')
  const tools = createPythonTools({ getPython: async () => python, host: node, logs, stateRoot: path.join(root, 'engine-state'), pack, kitPath, timeoutMs: 120000,
    checkFolder: async () => ({ absolute: work, exists: true }), createFolder: async () => work })
  const allow = { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'smoke' }
  const timings = {}
  try {
    await pack.start()
    assert.equal((await pack.status()).state, 'not-installed')
    let began = Date.now()
    const installed = await pack.install()
    timings.installMs = Date.now() - began
    assert.equal(installed.state, 'ready', JSON.stringify(installed))
    assert.equal(installed.packages.length, 18)
    assert.ok(installed.packages.every(row => row.license), 'every distribution names a license')
    began = Date.now()
    assert.equal((await pack.check()).state, 'ready')
    timings.fullCheckMs = Date.now() - began

    // Bootstrap semantics with the pack (M3-004).
    const semantics = await tools.run({ code: ['from __future__ import annotations', 'import sys', 'def f(x: Undefined) -> None: pass',
      'print("NAME", __name__)', 'print("FILE", __file__.endswith("main.py"))', 'import docx, openpyxl, pptx, xlsxwriter, matplotlib, numpy, lxml, PIL', 'print("IMPORTS ok")', 'sys.exit(3)'].join('\n'), cwd: '' }, allow)
    assert.equal(semantics.exitCode, 3)
    assert.match(semantics.output, /NAME __main__/); assert.match(semantics.output, /FILE True/); assert.match(semantics.output, /IMPORTS ok/)
    const failing = await tools.run({ code: 'def boom():\n    raise ValueError("expected failure")\nboom()\n', cwd: '' }, allow)
    assert.equal(failing.exitCode, 1)
    assert.match(failing.output, /main\.py", line 2, in boom/); assert.match(failing.output, /ValueError: expected failure/)

    // The NAJD Office kit with the real pack (M3-7 and the external-content scan): tests/office-kit-check.py.
    const kitWork = path.join(root, 'kit'); fs.mkdirSync(kitWork)
    const kitLease = await pack.acquire()
    const kitRun = require('node:child_process').spawnSync(python, ['-I', '-B', '-X', 'utf8', path.join(__dirname, 'office-kit-check.py'), kitLease.sitePackages, kitPath, kitWork],
      { encoding: 'utf8', timeout: 180000, env: { SystemRoot: process.env.SystemRoot, TEMP: kitWork, TMP: kitWork, MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(kitWork, 'mpl') } })
    kitLease.release()
    assert.equal(kitRun.status, 0, kitRun.stdout + kitRun.stderr)
    assert.match(kitRun.stdout, /KIT-OK/)
    const kitChecks = kitRun.stdout.split('\n').filter(line => line.startsWith('ok ')).length
    // The kit is importable from a normal run too.
    const kitImport = await tools.run({ code: 'import sys\nprint("PATH", sys.argv, sys.path[-3:])\nimport najd_office\nprint("KIT", najd_office.__version__)', cwd: '' }, allow)
    assert.match(kitImport.output, /KIT 1\.0\.0/)

    // Real documents.
    began = Date.now()
    const made = await tools.run({ code: `
import docx, openpyxl, matplotlib
from docx.oxml.ns import qn
from openpyxl.chart import BarChart, Reference
from pptx import Presentation
from pptx.util import Inches, Pt
import matplotlib.pyplot as plt

d = docx.Document()
d.add_heading('Quarterly report', 1)
p = d.add_paragraph('تقرير الربع الأول لمشروع نجد')
p.paragraph_format.alignment = 2
p._p.get_or_add_pPr().append(p._p.makeelement(qn('w:bidi'), {}))
d.add_paragraph('Revenue grew in every region.')
d.save('report.docx')

wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Sales'
ws.append(['Region', 'Sales'])
for row in [['Riyadh', 120], ['Jeddah', 95], ['Dammam', 70]]: ws.append(row)
ws['A5'] = 'Total'; ws['B5'] = '=SUM(B2:B4)'
chart = BarChart(); chart.add_data(Reference(ws, min_col=2, min_row=1, max_row=4), titles_from_data=True)
chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=4)); ws.add_chart(chart, 'D2')
wb.save('data.xlsx')

prs = Presentation()
s1 = prs.slides.add_slide(prs.slide_layouts[0]); s1.shapes.title.text = 'NAJD'; s1.placeholders[1].text = 'Office pack smoke'
s2 = prs.slides.add_slide(prs.slide_layouts[5]); s2.shapes.title.text = 'Plan'
box = s2.shapes.add_textbox(Inches(1), Inches(2), Inches(6), Inches(1)); box.text_frame.text = 'الخطوة الأولى'
box.text_frame.paragraphs[0].font.size = Pt(28)
prs.save('deck.pptx')

plt.figure(figsize=(4, 3)); plt.bar(['Riyadh', 'Jeddah', 'Dammam'], [120, 95, 70]); plt.title('Sales'); plt.savefig('chart.png', dpi=100)
print('MADE')
`, cwd: '' }, allow)
    timings.documentsMs = Date.now() - began
    assert.equal(made.exitCode, 0, made.output)
    assert.deepEqual(made.files.map(file => path.basename(file)).sort(), ['chart.png', 'data.xlsx', 'deck.pptx', 'report.docx'])

    // Reopen each file with its library and check what it holds.
    const read = await tools.run({ code: `
import docx, openpyxl
from pptx import Presentation
from PIL import Image
d = docx.Document('report.docx')
print('DOCX', [p.text for p in d.paragraphs])
print('BIDI', d.paragraphs[1]._p.pPr.xml.count('w:bidi'))
wb = openpyxl.load_workbook('data.xlsx')
print('XLSX', wb['Sales']['B5'].value, len(wb['Sales']._charts))
prs = Presentation('deck.pptx')
print('PPTX', len(prs.slides), [sh.text_frame.text for sh in prs.slides[1].shapes if sh.has_text_frame])
img = Image.open('chart.png'); print('PNG', img.format, img.size)
`, cwd: '' }, allow)
    assert.equal(read.exitCode, 0, read.output)
    assert.match(read.output, /DOCX \['Quarterly report', 'تقرير الربع الأول لمشروع نجد', 'Revenue grew in every region\.'\]/)
    assert.match(read.output, /BIDI 1/)
    assert.match(read.output, /XLSX =SUM\(B2:B4\) 1/)
    assert.match(read.output, /PPTX 2 \['Plan', 'الخطوة الأولى'\]/)
    assert.match(read.output, /PNG PNG \(400, 300\)/)

    // The library keeps the documents with readable text (M3-5).
    const library = createAssetLibrary({ directory: path.join(root, 'library') })
    for (const [file, kind, text] of [['report.docx', 'docx', 'تقرير الربع الأول'], ['data.xlsx', 'xlsx', '=SUM(B2:B4) → [result not calculated]'], ['deck.pptx', 'pptx', 'الخطوة الأولى']]) {
      const item = await library.importFile(path.join(work, file))
      assert.equal(item.kind, kind)
      assert.ok((await library.read(item.id, { limit: 8000 })).text.includes(text), file)
    }

    // A lease keeps the generation through removal; afterwards nothing is left.
    const lease = await pack.acquire()
    await pack.remove()
    assert.ok(fs.existsSync(lease.sitePackages))
    lease.release()
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.deepEqual(fs.readdirSync(path.join(root, 'packs', 'office')).filter(entry => entry.startsWith('g-')), [])
    console.log('Office pack smoke passed: real install from the pinned lock (' + Math.round(timings.installMs / 1000) + ' s, full check ' + Math.round(timings.fullCheckMs / 1000) +
      ' s), ' + kitChecks + ' NAJD Office kit checks, bootstrap semantics, real docx/xlsx/pptx/png created (' + Math.round(timings.documentsMs / 1000) + ' s) and read back, library import, leased removal.')
  } finally {
    await node.stop()
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch (error) { console.warn('cleanup left', root, error.code) }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
