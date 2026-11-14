// Android app building (R-080): a web app folder (index.html with its CSS, JS and images) becomes a signed Android APK with the owner's
// installed Android SDK and Android Studio's Java, without Gradle or a network: aapt2 links the manifest and assets, javac and d8 build
// a small WebView activity, zipalign and apksigner sign it with a NAJD debug key kept in NAJD's data. The commands and their arguments
// are fixed here; the model only chooses the folder (an allowed folder), the app name and the package id, and the owner approves the
// build in chat. iOS apps need a Mac with Xcode and are not built on Windows.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { zipSync, unzipSync } = require('fflate')

const fail = code => Object.assign(new Error(code), { code })
const versionKey = name => (String(name).match(/\d+/g) || []).map(Number)
const newest = names => [...names].sort((a, b) => { const x = versionKey(a), y = versionKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0 })[0]
const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$/

// The SDK (ANDROID_HOME, ANDROID_SDK_ROOT or the Android Studio default), its newest platform with android.jar and newest build-tools
// with every tool needed, and a JDK (JAVA_HOME or Android Studio's bundled JBR).
function findToolchain({ env = process.env, exists = fs.existsSync, readdir = dir => fs.readdirSync(dir) } = {}) {
  const sdk = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android', 'Sdk')].find(dir => dir && exists(path.join(dir, 'platforms')))
  if (!sdk) return null
  const list = dir => { try { return readdir(dir) } catch { return [] } }
  const platform = newest(list(path.join(sdk, 'platforms')).filter(name => exists(path.join(sdk, 'platforms', name, 'android.jar'))))
  const tools = newest(list(path.join(sdk, 'build-tools')).filter(name => ['aapt2.exe', 'zipalign.exe', 'd8.bat', 'apksigner.bat'].every(file => exists(path.join(sdk, 'build-tools', name, file)))))
  const javaHome = [env.JAVA_HOME, env.ProgramFiles && path.join(env.ProgramFiles, 'Android', 'Android Studio', 'jbr')].find(dir => dir && exists(path.join(dir, 'bin', 'javac.exe')))
  if (!platform || !tools || !javaHome) return null
  const bt = path.join(sdk, 'build-tools', tools)
  return { sdk, platform, buildTools: tools, androidJar: path.join(sdk, 'platforms', platform, 'android.jar'), aapt2: path.join(bt, 'aapt2.exe'), zipalign: path.join(bt, 'zipalign.exe'),
    d8: path.join(bt, 'd8.bat'), apksigner: path.join(bt, 'apksigner.bat'), javac: path.join(javaHome, 'bin', 'javac.exe'), keytool: path.join(javaHome, 'bin', 'keytool.exe'), javaHome }
}

const escapeXml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function manifest(appId, name) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${appId}" android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />
  <application android:label="${escapeXml(name)}" android:allowBackup="false" android:supportsRtl="true" android:theme="@android:style/Theme.DeviceDefault.Light.NoActionBar">
    <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize|keyboardHidden">
      <intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
    </activity>
  </application>
</manifest>
`
}
// A full-screen WebView on the bundled index.html; JavaScript and local storage on, no network permission requested.
const activity = appId => `package ${appId};
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
public class MainActivity extends Activity {
  private WebView view;
  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    view = new WebView(this);
    WebSettings settings = view.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(true);
    view.setWebViewClient(new WebViewClient());
    setContentView(view);
    view.loadUrl("file:///android_asset/index.html");
  }
  @Override public void onBackPressed() { if (view.canGoBack()) view.goBack(); else super.onBackPressed(); }
}
`

function run(file, args, { cwd, env, timeout = 180000, signal } = {}) {
  return new Promise((resolve, reject) => {
    // .bat tools need a shell on Windows; their arguments are fixed paths built here, quoted, never model text.
    const bat = /\.bat$/i.test(file)
    const command = bat ? `"${file}" ${args.map(arg => `"${arg}"`).join(' ')}` : file
    execFile(bat ? process.env.ComSpec || 'cmd.exe' : command, bat ? ['/d', '/s', '/c', `"${command}"`] : args, { cwd, env, timeout, signal, windowsHide: true, windowsVerbatimArguments: bat, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(Object.assign(fail('BUILD_STEP_FAILED'), { step: path.basename(file), detail: String(stderr || stdout || error.message).slice(-2000) })) : resolve(String(stdout)))
  })
}

async function filesOf(root, base = root, out = []) {
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) { if (!['dist', 'node_modules', '.git'].includes(entry.name)) await filesOf(full, base, out) }
    else out.push(path.relative(base, full))
    if (out.length > 2000) throw fail('APP_TOO_LARGE')
  }
  return out
}

function createAndroidBuilder({ stateRoot, checkFolder, toolchain = () => findToolchain() }) {
  if (!path.isAbsolute(stateRoot || '') || typeof checkFolder !== 'function') throw fail('INVALID_INPUT')
  async function debugKey(tools) {
    const store = path.join(stateRoot, 'najd-debug.keystore')
    if (!fs.existsSync(store)) {
      await fsp.mkdir(stateRoot, { recursive: true })
      await run(tools.keytool, ['-genkeypair', '-keystore', store, '-storepass', 'android', '-keypass', 'android', '-alias', 'najddebug', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=NAJD Debug,O=NAJD,C=SA'])
    }
    return store
  }
  return {
    available: async () => !!toolchain(),
    async build({ folder, name, appId }, { requestApproval, signal } = {}) {
      const tools = toolchain()
      if (!tools) throw fail('ANDROID_SDK_NOT_FOUND')
      const label = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
      if (!label || label.length > 50 || /[\x00-\x1f<>]/.test(label) || typeof appId !== 'string' || !PACKAGE.test(appId)) throw fail('INVALID_INPUT')
      const source = await checkFolder(typeof folder === 'string' ? folder : '')
      if (!source.exists || !fs.existsSync(path.join(source.absolute, 'index.html'))) throw fail('INDEX_HTML_MISSING')
      const assets = await filesOf(source.absolute)
      if (typeof requestApproval !== 'function') throw fail('PERMISSION_DENIED')
      const decision = await requestApproval('najd-android-build', { path: source.absolute, summary: `Build the Android app "${label}" (${appId}) from ${assets.length} files in this folder with your Android SDK (${tools.platform}, build-tools ${tools.buildTools}). The APK is written to ${path.join(source.absolute, 'dist')} and signed with a NAJD debug key; nothing is installed or uploaded.` })
      if (decision !== 'ALLOW_ONCE') return { status: 'denied_by_user', note: 'Nothing was built.' }
      await fsp.mkdir(stateRoot, { recursive: true })
      const work = await fsp.mkdtemp(path.join(stateRoot, 'build-'))
      try {
        const env = { ...process.env, JAVA_HOME: tools.javaHome, PATH: path.join(tools.javaHome, 'bin') + path.delimiter + process.env.PATH }
        await fsp.writeFile(path.join(work, 'AndroidManifest.xml'), manifest(appId, label))
        const javaDir = path.join(work, 'java', ...appId.split('.')); await fsp.mkdir(javaDir, { recursive: true })
        await fsp.writeFile(path.join(javaDir, 'MainActivity.java'), activity(appId))
        await fsp.cp(source.absolute, path.join(work, 'assets'), { recursive: true, filter: item => !/[\\/](dist|node_modules|\.git)([\\/]|$)/.test(path.relative(source.absolute, item) ? '/' + path.relative(source.absolute, item) : '') })
        await run(tools.aapt2, ['link', '-o', path.join(work, 'base.apk'), '-I', tools.androidJar, '--manifest', path.join(work, 'AndroidManifest.xml'), '-A', path.join(work, 'assets'), '--min-sdk-version', '24', '--target-sdk-version', '35'], { env, signal })
        await fsp.mkdir(path.join(work, 'classes'))
        await run(tools.javac, ['-source', '8', '-target', '8', '-bootclasspath', tools.androidJar, '-classpath', tools.androidJar, '-encoding', 'UTF-8', '-nowarn', '-d', path.join(work, 'classes'), path.join(javaDir, 'MainActivity.java')], { env, signal })
        const classFiles = (await filesOf(path.join(work, 'classes'))).map(file => path.join(work, 'classes', file))
        await fsp.mkdir(path.join(work, 'dex'))
        await run(tools.d8, ['--release', '--min-api', '24', '--lib', tools.androidJar, '--output', path.join(work, 'dex'), ...classFiles], { env, signal })
        // The dex is added to the linked APK (stored as a zip entry); zipalign then apksigner finish it.
        const linked = unzipSync(await fsp.readFile(path.join(work, 'base.apk')))
        linked['classes.dex'] = await fsp.readFile(path.join(work, 'dex', 'classes.dex'))
        // resources.arsc stays stored (uncompressed) so zipalign can align it: Android 11+ refuses an APK whose resources.arsc is
        // compressed (found by installing on the emulator, android-build-smoke --emulator).
        await fsp.writeFile(path.join(work, 'unaligned.apk'), zipSync(Object.fromEntries(Object.entries(linked).map(([name, data]) => [name, name === 'resources.arsc' ? [data, { level: 0 }] : data])), { level: 6 }))
        await run(tools.zipalign, ['-p', '-f', '4', path.join(work, 'unaligned.apk'), path.join(work, 'aligned.apk')], { env, signal })
        const store = await debugKey(tools)
        const outDir = path.join(source.absolute, 'dist'); await fsp.mkdir(outDir, { recursive: true })
        const apk = path.join(outDir, label.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') + '.apk')
        await run(tools.apksigner, ['sign', '--ks', store, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'najddebug', '--out', apk, path.join(work, 'aligned.apk')], { env, signal })
        await run(tools.apksigner, ['verify', apk], { env, signal })
        return { status: 'built', apk, bytes: (await fsp.stat(apk)).size, appId, name: label, files: assets.length, platform: tools.platform, note: 'Signed with a NAJD debug key: install it on a test device or emulator (adb install). A store release needs your own signing key.' }
      } catch (failure) {
        if (failure?.code === 'BUILD_STEP_FAILED') return { status: 'failed', error: 'BUILD_STEP_FAILED', step: failure.step, detail: failure.detail }
        throw failure
      } finally { await fsp.rm(work, { recursive: true, force: true }).catch(() => {}) }
    }
  }
}

module.exports = { createAndroidBuilder, findToolchain }
