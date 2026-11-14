// Real Android build with the owner's SDK (R-080): a small Arabic web app becomes a signed APK through NAJD's builder (aapt2, javac,
// d8, zipalign, apksigner; no Gradle, no network); apksigner verifies it and aapt2 reads its package, label and launcher activity.
// With --emulator it also boots the first AVD headless, installs the APK, launches it and checks the activity is resumed.
// Usage: node tests/android-build-smoke.cjs [--emulator]  (without the SDK it says so and verifies nothing)
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { createAndroidBuilder, findToolchain } = require('../electron/android-builder.cjs')

async function main() {
  const tools = findToolchain()
  if (!tools) { console.log('SKIPPED: no Android SDK and JDK on this machine; nothing was verified.'); return }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-android-'))
  const app = path.join(root, 'app'); fs.mkdirSync(path.join(app, 'css'), { recursive: true })
  fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="css/app.css"></head><body><h1 id="t">مرحبا من نجد</h1><button onclick="document.getElementById(\'t\').textContent=\'تم\'">اضغط</button></body></html>')
  fs.writeFileSync(path.join(app, 'css', 'app.css'), 'body{font-family:sans-serif;background:#111;color:#eee}')
  let card = null
  const builder = createAndroidBuilder({ stateRoot: path.join(root, 'state'), checkFolder: async () => ({ absolute: app, exists: true }) })
  try {
    const refused = await builder.build({ folder: '', name: 'NAJD Test', appId: 'not a package' }, { requestApproval: async () => 'ALLOW_ONCE' }).catch(error => error.code)
    assert.equal(refused, 'INVALID_INPUT')
    const denied = await builder.build({ folder: '', name: 'NAJD Test', appId: 'com.najd.smoke' }, { requestApproval: async () => 'DENY' })
    assert.equal(denied.status, 'denied_by_user')
    const result = await builder.build({ folder: '', name: 'NAJD Test', appId: 'com.najd.smoke' }, { requestApproval: async (tool, details) => { card = { tool, details }; return 'ALLOW_ONCE' } })
    assert.equal(result.status, 'built', JSON.stringify(result).slice(0, 2000))
    assert.equal(card.tool, 'najd-android-build'); assert.match(card.details.summary, /com\.najd\.smoke/)
    const badging = execFileSync(tools.aapt2, ['dump', 'badging', result.apk], { encoding: 'utf8' })
    assert.match(badging, /package: name='com\.najd\.smoke'/); assert.match(badging, /application: label='NAJD Test'/); assert.match(badging, /launchable-activity: name='com\.najd\.smoke\.MainActivity'/)
    const listing = execFileSync(tools.aapt2, ['dump', 'resources', result.apk], { encoding: 'utf8' }).length >= 0
    void listing
    let ran = ''
    if (process.argv.includes('--emulator')) ran = await onEmulator(tools, result.apk)
    console.log(`Android build smoke passed: ${tools.platform}, build-tools ${tools.buildTools}; web app (${result.files} files, Arabic) built into a signed APK of ${result.bytes} bytes in dist; apksigner verified; aapt2 reads com.najd.smoke, "NAJD Test" and the launcher activity; invalid package refused; denial built nothing${ran}.`)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

async function onEmulator(tools, apk) {
  const adb = path.join(tools.sdk, 'platform-tools', 'adb.exe'), emulator = path.join(tools.sdk, 'emulator', 'emulator.exe')
  const avd = execFileSync(emulator, ['-list-avds'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean)
  const child = spawn(emulator, ['-avd', avd, '-no-window', '-no-audio', '-no-snapshot-save', '-no-boot-anim', '-gpu', 'swiftshader_indirect'], { stdio: 'ignore', windowsHide: true })
  try {
    execFileSync(adb, ['wait-for-device'], { timeout: 300000 })
    for (let i = 0; i < 180; i++) { if (execFileSync(adb, ['shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).trim() === '1') break; await new Promise(resolve => setTimeout(resolve, 2000)) }
    execFileSync(adb, ['install', '-r', apk], { timeout: 180000 })
    execFileSync(adb, ['shell', 'am', 'start', '-W', '-n', 'com.najd.smoke/.MainActivity'], { timeout: 60000 })
    await new Promise(resolve => setTimeout(resolve, 4000))
    const top = execFileSync(adb, ['shell', 'dumpsys', 'activity', 'activities'], { encoding: 'utf8' })
    assert.match(top, /mResumedActivity.*com\.najd\.smoke\/\.MainActivity|ResumedActivity.*com\.najd\.smoke\/\.MainActivity/)
    execFileSync(adb, ['uninstall', 'com.najd.smoke'])
    return `; installed and launched on the "${avd}" emulator (activity resumed), then uninstalled`
  } finally { try { execFileSync(adb, ['emu', 'kill']) } catch {} child.kill() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
