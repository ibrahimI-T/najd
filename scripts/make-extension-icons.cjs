// Builds the extension icons (16/32/48/128 px PNG) from the NAJD app icon (build/icon.png).
// Run with Electron so no image library is needed: node_modules/.bin/electron scripts/make-extension-icons.cjs
const { app, nativeImage } = require('electron')
const fs = require('node:fs'), path = require('node:path')

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))
  if (source.isEmpty()) { console.error('build/icon.png is missing or unreadable'); app.exit(1); return }
  const target = path.join(__dirname, '..', 'browser-extension', 'icons')
  fs.mkdirSync(target, { recursive: true })
  for (const size of [16, 32, 48, 128]) {
    const image = source.resize({ width: size, height: size, quality: 'best' })
    fs.writeFileSync(path.join(target, `icon-${size}.png`), image.toPNG())
    console.log('icon-' + size + '.png', image.toPNG().length, 'bytes')
  }
  app.quit()
})
