const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
const nsis = require('../package.json').build.nsis

test('installer pages use NAJD sidebar images in the size and format NSIS requires', () => {
  for (const key of ['installerSidebar', 'uninstallerSidebar']) {
    const bmp = fs.readFileSync(path.join(root, nsis[key]))
    assert.equal(bmp.toString('latin1', 0, 2), 'BM', key)
    assert.equal(bmp.readInt32LE(18), 164, key + ' width'); assert.equal(Math.abs(bmp.readInt32LE(22)), 314, key + ' height')
    assert.equal(bmp.readUInt16LE(28), 24, key + ' must be 24-bit')
  }
})

test('"Space required" includes the unpacked components', t => {
  const bundle = path.join(root, 'build/bundle/najd-runtime-packed/bundle.json')
  const declared = Number(/AddSize\s+(\d+)/.exec(fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8'))?.[1])
  assert.ok(declared > 1000000, 'AddSize must cover roughly 1 GB of components')
  if (!fs.existsSync(bundle)) return t.skip('runtime bundle is not built in this checkout')
  const bytes = JSON.parse(fs.readFileSync(bundle, 'utf8')).components.reduce((sum, row) => sum + row.bytes, 0)
  assert.equal(declared, Math.ceil(bytes / 1024), 'update AddSize in build/installer.nsh to match bundle.json')
})

test('the preparation window sizes its content area so nothing scrolls', () => {
  const source = fs.readFileSync(path.join(root, 'electron/prepare-runtime.cjs'), 'utf8')
  assert.match(source, /useContentSize: true/)
  assert.match(source, /html,body\{overflow:hidden\}/)
})

test('uninstall keeps user data and removes only the components, in the folder the app itself uses (Phase 15)', () => {
  assert.equal(nsis.deleteAppDataOnUninstall, false, 'chats, memory and keys stay after uninstall')
  const macro = /!macro customUnInstall([\s\S]*?)!macroend/.exec(fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8'))?.[1] || ''
  assert.match(macro, /ReadEnvStr \$R0 LOCALAPPDATA/)
  assert.doesNotMatch(macro, /\$LOCALAPPDATA/, 'the shell folder could differ from the LOCALAPPDATA the app used')
  assert.doesNotMatch(macro, /APPDATA\\najd-agent|\$APPDATA/i, 'never removes the user data folder')
  assert.match(macro, /rd \/s \/q "\$R4\\NAJD AGENT\\runtime"/, 'files deeper than 260 characters are removed too')
  // The extended form per root type (C55-01): \\?\ for a drive, \\?\UNC\ without the leading \\ for a UNC root.
  assert.ok(macro.includes('StrCpy $R5 $R0 "" 2') && macro.includes('StrCpy $R4 "\\\\?\\UNC\\$R5"'), 'UNC roots use \\\\?\\UNC\\')
  assert.ok(macro.includes('${elseIf} $R2 == ":\\"') && macro.includes('StrCpy $R4 "\\\\?\\$R0"'), 'drive roots use \\\\?\\')
  assert.match(macro, /StrCpy \$R0 "\$PROFILE\\AppData\\Local"/, 'the same fallback as runtime-root.cjs when LOCALAPPDATA is missing')
  for (const file of ['electron/main.cjs', 'electron/prepare-runtime.cjs'])
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /require\('\.\/runtime-root\.cjs'\)\.najdLocalRoot\(\)/, file + ' uses the shared folder')
})

test('the components folder is the same for preparation, start and uninstall, also without LOCALAPPDATA (C53-03)', () => {
  const { najdLocalRoot } = require('../electron/runtime-root.cjs')
  assert.equal(najdLocalRoot({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'C:\\Users\\a'), path.join('C:\\Users\\a\\AppData\\Local', 'NAJD AGENT'))
  assert.equal(najdLocalRoot({}, 'C:\\Users\\a'), path.join('C:\\Users\\a', 'AppData', 'Local', 'NAJD AGENT'))
  assert.equal(najdLocalRoot({ LOCALAPPDATA: 'relative' }, 'C:\\Users\\a'), path.join('C:\\Users\\a', 'AppData', 'Local', 'NAJD AGENT'), 'a relative value is not trusted')
})

test('C54-02: a LOCALAPPDATA that is not a drive or UNC path falls back the same way in the app and the uninstaller', () => {
  const { najdLocalRoot } = require('../electron/runtime-root.cjs')
  for (const value of ['relative\\x', '\\rooted', 'x']) assert.equal(najdLocalRoot({ LOCALAPPDATA: value }, 'C:\\Users\\a'), path.join('C:\\Users\\a', 'AppData', 'Local', 'NAJD AGENT'), value)
  assert.equal(najdLocalRoot({ LOCALAPPDATA: '\\\\server\\share' }, 'C:\\Users\\a'), path.join('\\\\server\\share', 'NAJD AGENT'))
  const macro = /!macro customUnInstall([\s\S]*?)!macroend/.exec(fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8'))[1]
  for (const check of ['${if} $R2 != ":\\"', '${andIf} $R2 != ":/"', '${andIf} $R3 != "\\\\"', '${andIf} $R3 != "//"']) assert.ok(macro.includes(check), check)
})
