// Publisher-only: derive optimized brand assets from the owner's master logo with
// Electron's image codec. Run with the Electron binary:
//   node_modules/electron/dist/electron.exe scripts/prepare-brand-assets.cjs <master-logo.png>
const { app, nativeImage } = require('electron')
const fs = require('node:fs'), path = require('node:path')
app.whenReady().then(() => {
  try {
    const master = nativeImage.createFromPath(path.resolve(process.argv.at(-1)))
    if (master.isEmpty()) throw Error('Master logo unreadable')
    const { width } = master.getSize(), unit = width / 1254
    const root = path.resolve(__dirname, '..')
    // Medallion only (no wordmark) for the rail, brand and application icon.
    const medallion = master.crop({ x: Math.round(190 * unit), y: Math.round(100 * unit), width: Math.round(874 * unit), height: Math.round(874 * unit) })
    // Welcome-state medallion; the wordmark is live text so it stays crisp in both languages.
    fs.writeFileSync(path.join(root, 'src/assets/najd-logo.jpg'), medallion.resize({ width: 480, quality: 'best' }).toJPEG(88))
    fs.writeFileSync(path.join(root, 'src/assets/najd-medallion.jpg'), medallion.resize({ width: 160, quality: 'best' }).toJPEG(90))
    fs.writeFileSync(path.join(root, 'build/icon.png'), medallion.resize({ width: 256, quality: 'best' }).toPNG())
    console.log('Brand assets written')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
  app.quit()
})
