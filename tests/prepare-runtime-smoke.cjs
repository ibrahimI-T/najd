// Installer-time preparation mode with an isolated LOCALAPPDATA: success unpacks and verifies
// every component (exit 0); a damaged archive exits 1 with a logged component reason.
//   node tests/prepare-runtime-smoke.cjs build/bundle/najd-runtime-packed
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawnSync } = require('node:child_process')
const electron = require('electron')
const source = path.resolve(process.argv[2])
function prepare(bundle) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-prepare-'))
  const result = spawnSync(electron, [path.join(__dirname, '../electron/main.cjs'), '--najd-prepare-runtime', '--silent'],
    { env: { ...process.env, NAJD_DEV_BUNDLE: bundle, LOCALAPPDATA: home }, timeout: 1200000, windowsHide: true })
  const log = fs.readFileSync(path.join(home, 'NAJD AGENT', 'install.log'), 'utf8')
  return { code: result.status, log, home }
}
const ok = prepare(source)
assert.equal(ok.code, 0, ok.log); assert.match(ok.log, /prepare ok/)
assert.equal(fs.readdirSync(path.join(ok.home, 'NAJD AGENT', 'runtime')).filter(name => !name.startsWith('.')).length, 5)
fs.rmSync(ok.home, { recursive: true, force: true })
const damaged = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-damaged-bundle-'))
for (const name of fs.readdirSync(source)) fs.copyFileSync(path.join(source, name), path.join(damaged, name))
const archive = path.join(damaged, 'node.zip'), bytes = fs.readFileSync(archive); bytes[1000] ^= 0xff; fs.writeFileSync(archive, bytes)
const bad = prepare(damaged)
assert.equal(bad.code, 1); assert.match(bad.log, /prepare failed: .*component=node/)
fs.rmSync(bad.home, { recursive: true, force: true }); fs.rmSync(damaged, { recursive: true, force: true })
console.log('PASS: preparation mode unpacked and verified all components (exit 0); a damaged archive failed with exit 1 and a component reason.')
