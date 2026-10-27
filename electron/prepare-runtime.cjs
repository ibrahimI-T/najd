// Installer-time preparation. The NSIS installer runs "NAJD AGENT.exe --najd-prepare-runtime"
// after copying files and waits for the exit code, so installation only completes once every
// bundled component is unpacked and verified. A small progress window is shown unless --silent
// (silent in-app updates). Results are appended to %LOCALAPPDATA%\NAJD AGENT\install.log.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { createBundleRuntime } = require('./bundle-runtime.cjs')
const { checkComponent } = require('./runtime-health.cjs')
const { trimFile } = require('./log-retention.cjs')
const pins = require('./runtime-pins.json')

const silent = process.argv.includes('--silent')
const base = require('./runtime-root.cjs').najdLocalRoot()
const logFile = path.join(base, 'install.log')
const log = line => { try { fs.mkdirSync(base, { recursive: true }); fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n'); trimFile(logFile) } catch {} }
const run = (file, args) => new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: 60000,
  env: { SystemRoot: process.env.SystemRoot, PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), DOTNET_CLI_TELEMETRY_OPTOUT: '1' } },
  (error, stdout) => resolve({ ok: !error, output: String(stdout || '').trim() })))

const PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>html,body{overflow:hidden}body{margin:0;box-sizing:border-box;height:100vh;font:13px 'Segoe UI',Tahoma,sans-serif;background:#12100d;color:#f5f0e8;display:grid;align-content:center;gap:10px;padding:0 22px;user-select:none}
h1{margin:0;font:400 17px Georgia,serif;letter-spacing:.14em;color:#e2c38a}p{margin:0;color:#b5ada3}
.bar{height:6px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden}.fill{height:100%;width:0;background:linear-gradient(90deg,#a0742f,#d7ac62,#f4dcaa);transition:width .3s}
.ar{direction:rtl;text-align:right}</style>
<h1>NAJD AGENT</h1><p id="en">Preparing components…</p><p id="ar" class="ar">جاري تجهيز مكونات نجد…</p><div class="bar"><div class="fill" id="fill"></div></div>`
const names = { engine: ['Agent engine', 'محرك الوكيل'], gateway: ['Gateway', 'البوابة'], node: ['Node runtime', 'بيئة Node'],
  dotnet: ['.NET runtime', 'بيئة .NET'], 'desktop-host': ['Desktop control', 'التحكم بسطح المكتب'] }

async function verify(runtime) {
  const dir = id => runtime.readyDirectory(id)
  for (const id of ['engine', 'gateway', 'node', 'dotnet', 'desktop-host']) if (!dir(id)) throw new Error('component not ready: ' + id)
  if (!await checkComponent({ component: { id: 'agent-core', version: '1.0.0' }, directory: dir('engine') })) throw new Error('engine health probe failed')
  const node = await run(path.join(dir('node'), 'najd-gateway.exe'), ['--version'])
  if (!node.ok || node.output !== 'v' + pins.node.version) throw new Error('gateway runtime version check failed')
  const dotnet = await run(path.join(dir('dotnet'), 'dotnet.exe'), ['--list-runtimes'])
  if (!dotnet.ok || !/Microsoft\.NETCore\.App 10\./.test(dotnet.output)) throw new Error('.NET runtime check failed')
  if (!fs.existsSync(path.join(dir('gateway'), 'node_modules/openclaw/openclaw.mjs'))) throw new Error('gateway package missing')
  if (!fs.existsSync(path.join(dir('desktop-host'), 'Najd.WindowsNode.dll'))) throw new Error('desktop host missing')
}

function prepareRuntimeMain() {
  app.whenReady().then(async () => {
    let window = null, code = 1
    if (!silent) {
      window = new BrowserWindow({ width: 440, height: 150, useContentSize: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        title: 'NAJD AGENT', backgroundColor: '#12100d', autoHideMenuBar: true, show: false, icon: path.join(__dirname, '../build/icon.png'),
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true } })
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.setMenu(null)
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE))
      window.show()
    }
    const show = (en, ar, percent) => {
      if (!window || window.isDestroyed()) return
      void window.webContents.executeJavaScript(`document.getElementById('en').textContent=${JSON.stringify(en)};document.getElementById('ar').textContent=${JSON.stringify(ar)};document.getElementById('fill').style.width='${percent}%'`).catch(() => {})
    }
    try {
      const source = app.isPackaged ? path.join(process.resourcesPath, 'najd-runtime') : process.env.NAJD_DEV_BUNDLE
      if (!source || !fs.existsSync(path.join(source, 'bundle.json'))) throw new Error('bundled components are missing from the installation')
      log('prepare start ' + app.getVersion())
      const runtime = createBundleRuntime({ source, target: path.join(base, 'runtime') })
      const timer = setInterval(() => {
        const s = runtime.status(), percent = s.total ? Math.round(s.done / s.total * 100) : 0, name = names[s.component] || ['', '']
        show(`Preparing components${name[0] ? ' · ' + name[0] : ''} · ${percent}%`, `تجهيز مكونات نجد${name[1] ? ' · ' + name[1] : ''} · ${percent}%`, percent)
      }, 500)
      try { await runtime.prepare() } finally { clearInterval(timer) }
      show('Verifying components…', 'التحقق من المكونات…', 100)
      await verify(runtime)
      // Only a fully verified generation is recorded as the current one; the previous generation stays available until this one proves healthy at runtime.
      try { runtime.markPrepared(app.getVersion()) } catch (error) { log('generation record not updated: ' + (error?.code || 'unknown')) }
      log('prepare ok')
      show('Components ready', 'المكونات جاهزة', 100)
      code = 0
    } catch (error) {
      log('prepare failed: ' + String(error?.message || error).slice(0, 300) + (error?.code ? ' (' + error.code + ')' : '') + (error?.component ? ' component=' + error.component : ''))
      show('Preparation failed. See install.log in %LOCALAPPDATA%\\NAJD AGENT.', 'تعذّر التجهيز. التفاصيل في install.log داخل %LOCALAPPDATA%\\NAJD AGENT.', 100)
      await new Promise(resolve => setTimeout(resolve, silent ? 0 : 2500))
    }
    app.exit(code)
  })
}
module.exports = { prepareRuntimeMain }
