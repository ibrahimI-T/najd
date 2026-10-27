// Renders the installer's artwork (Windows NSIS) in NAJD's default graphite night look: the welcome/finish sidebar
// (164x314) and the inner pages' header (150x57), written as 24-bit BMP files in build/. Run with Electron:
//   npx electron scripts/render-installer-art.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const logo = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(root, 'src/assets/najd-logo.jpg')).toString('base64')

// A fixed pseudo-random star field, so the artwork is the same on every run.
function stars(width, height, count, seed) {
  let value = seed
  const next = () => (value = (value * 16807) % 2147483647) / 2147483647
  return Array.from({ length: count }, () => {
    const size = next() < 0.85 ? 1 : 1.6
    return `<i style="left:${(next() * width).toFixed(1)}px;top:${(next() * height).toFixed(1)}px;width:${size}px;height:${size}px;opacity:${(0.25 + next() * 0.6).toFixed(2)}"></i>`
  }).join('')
}

const base = `*{margin:0;box-sizing:border-box}html,body{background:#121212;overflow:hidden}
  .art{position:relative;overflow:hidden;background:radial-gradient(120% 70% at 50% 38%,#232323 0%,#151515 55%,#0d0d0d 100%)}
  .art i{position:absolute;border-radius:50%;background:#fff}
  .logo{position:absolute;border-radius:50%;filter:grayscale(1) contrast(1.08) brightness(1.05);box-shadow:0 0 0 1px rgba(255,255,255,.14),0 6px 22px rgba(0,0,0,.65)}
  .word{position:absolute;left:0;right:0;text-align:center;color:#ececec;font-family:Georgia,'Times New Roman',serif;letter-spacing:.32em}
  .rule{position:absolute;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)}`

const pages = {
  installerSidebar: { width: 164, height: 314, html: `<div class="art" style="width:164px;height:314px">${stars(164, 314, 70, 7)}
    <img class="logo" src="${logo}" style="left:32px;top:62px;width:100px;height:100px">
    <div class="word" style="top:182px;font-size:17px;padding-left:.32em">NAJD</div>
    <div class="word" style="top:205px;font-size:9px;letter-spacing:.55em;padding-left:.55em;color:#a8a8a8">AGENT</div>
    <div class="rule" style="left:30px;right:30px;top:228px"></div>
    <div class="word" style="top:238px;font-size:9.5px;letter-spacing:.08em;color:#8f8f8f;font-family:'Segoe UI',Tahoma,sans-serif">najdagent.si</div></div>` },
  installerHeader: { width: 150, height: 57, html: `<div class="art" style="width:150px;height:57px">${stars(150, 57, 18, 11)}
    <img class="logo" src="${logo}" style="left:10px;top:9px;width:39px;height:39px">
    <div class="word" style="left:58px;text-align:left;top:14px;font-size:13px;letter-spacing:.26em">NAJD</div>
    <div class="word" style="left:59px;text-align:left;top:32px;font-size:7.5px;letter-spacing:.5em;color:#a8a8a8">AGENT</div></div>` },
  // The README banner (PNG, docs/assets/banner.png).
  banner: { width: 1280, height: 360, png: 'docs/assets/banner.png', html: `<div class="art" style="width:1280px;height:360px;background:radial-gradient(60% 90% at 30% 50%,#262626 0%,#141414 55%,#0b0b0b 100%)">${stars(1280, 360, 260, 23)}
    <img class="logo" src="${logo}" style="left:170px;top:70px;width:220px;height:220px">
    <div class="word" style="left:450px;text-align:left;top:92px;font-size:76px;letter-spacing:.2em">NAJD</div>
    <div class="word" style="left:456px;text-align:left;top:184px;font-size:24px;letter-spacing:.78em;color:#a8a8a8">AGENT</div>
    <div class="rule" style="left:450px;width:640px;top:232px;background:linear-gradient(90deg,rgba(255,255,255,.45),transparent)"></div>
    <div class="word" style="left:452px;text-align:left;top:248px;font-size:22px;letter-spacing:.02em;color:#d6d6d6;font-family:'Segoe UI',Tahoma,sans-serif">Your AI assistant for Windows &nbsp;·&nbsp; <span dir="rtl">مساعدك الذكي على ويندوز</span></div></div>` }
}

// 24-bit bottom-up BMP from Electron's BGRA bitmap.
function bmp(bitmap, width, height) {
  const row = Math.ceil(width * 3 / 4) * 4, size = 54 + row * height, out = Buffer.alloc(size)
  out.write('BM', 0); out.writeUInt32LE(size, 2); out.writeUInt32LE(54, 10); out.writeUInt32LE(40, 14)
  out.writeInt32LE(width, 18); out.writeInt32LE(height, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28)
  out.writeUInt32LE(row * height, 34); out.writeInt32LE(2835, 38); out.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = ((height - 1 - y) * width + x) * 4, to = 54 + y * row + x * 3
    out[to] = bitmap[from]; out[to + 1] = bitmap[from + 1]; out[to + 2] = bitmap[from + 2]
  }
  return out
}

app.on('window-all-closed', () => {}) // each page's window closes before the next opens
app.whenReady().then(async () => {
  for (const [name, page] of Object.entries(pages)) {
    const window = new BrowserWindow({ show: false, width: page.width, height: page.height, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: 1 } })
    const page_file = path.join(app.getPath('temp'), `najd-installer-art-${name}.html`)
    fs.writeFileSync(page_file, `<!doctype html><meta charset="utf-8"><style>${base}</style>${page.html}`)
    await window.loadFile(page_file)
    fs.rmSync(page_file, { force: true })
    await new Promise(resolve => setTimeout(resolve, 400))
    const image = (await window.webContents.capturePage({ x: 0, y: 0, width: page.width, height: page.height })).resize({ width: page.width, height: page.height, quality: 'best' })
    if (page.png) { fs.mkdirSync(path.dirname(path.join(root, page.png)), { recursive: true }); fs.writeFileSync(path.join(root, page.png), image.toPNG()) }
    else {
      fs.writeFileSync(path.join(root, 'build', name + '.bmp'), bmp(image.toBitmap(), page.width, page.height))
      fs.writeFileSync(path.join(root, 'release', name + '-preview.png'), image.toPNG())
    }
    window.destroy()
  }
  fs.copyFileSync(path.join(root, 'build', 'installerSidebar.bmp'), path.join(root, 'build', 'uninstallerSidebar.bmp'))
  app.quit()
})
