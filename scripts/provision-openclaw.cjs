// Stage the exact published Gateway payload; source submodule and package identity remain distinct.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const pins = require('../electron/runtime-pins.json')
const { version, integrity } = pins.openclaw
const root = path.resolve(__dirname, '../.runtimes')
const destination = path.join(root, `openclaw-${version}`)

async function verify() {
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'))
  const record = JSON.parse(await fs.readFile(path.join(destination, 'najd-runtime.json'), 'utf8'))
  if (manifest.name !== 'openclaw' || manifest.version !== version || record.integrity !== integrity) throw new Error('Existing OpenClaw payload failed verification; preserve it for review.')
  await fs.access(path.join(destination, 'openclaw.mjs'))
  await fs.access(path.join(destination, 'LICENSE'))
}

async function prepareArchive() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Gateway native proof is scoped to Windows x64.')
  await fs.mkdir(root, { recursive: true })
  let installed = false
  try { await fs.access(destination); installed = true }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (installed) { await verify(); console.log(`Verified staged OpenClaw ${version}.`); return }
  const stage = await fs.mkdtemp(path.join(root, 'openclaw-stage-'))
  try {
    const response = await fetch(`https://registry.npmjs.org/openclaw/-/openclaw-${version}.tgz`, {
      signal: AbortSignal.timeout(120000), redirect: 'error'
    })
    if (!response.ok) throw new Error('OpenClaw download rejected.')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 200 * 1024 * 1024) throw new Error('OpenClaw payload exceeded size bound.')
      chunks.push(chunk)
    }
    const data = Buffer.concat(chunks)
    if ('sha512-' + createHash('sha512').update(data).digest('base64') !== integrity) throw new Error('OpenClaw integrity mismatch.')
    const archive = path.join(stage, 'payload.tgz')
    await fs.writeFile(archive, data, { flag: 'wx' })
    execFileSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xzf', archive, '-C', stage], { windowsHide: true, timeout: 60000 })
    const extracted = path.join(stage, 'package')
    const manifest = JSON.parse(await fs.readFile(path.join(extracted, 'package.json'), 'utf8'))
    if (manifest.name !== 'openclaw' || manifest.version !== version) throw new Error('Wrong OpenClaw package identity.')
    await fs.access(path.join(extracted, 'LICENSE'))
    await fs.writeFile(path.join(extracted, 'najd-runtime.json'), JSON.stringify({ version, integrity,
      source: `https://registry.npmjs.org/openclaw/-/openclaw-${version}.tgz` }) + '\n', { flag: 'wx' })
    await fs.rename(extracted, destination)
    await verify()
    console.log(`Prepared integrity-verified OpenClaw ${version}; engine execution remains unverified.`)
  } finally {
    if (!path.resolve(stage).startsWith(root + path.sep)) throw new Error('Unsafe staging cleanup path.')
    await fs.rm(stage, { recursive: true, force: true })
  }
}

async function main() {
  await prepareArchive()
  const container = path.join(root, `openclaw-runtime-${version}`)
  await fs.mkdir(container, { recursive: true })
  const manifestPath = path.join(container, 'package.json')
  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    if (existing.name !== 'najd-managed-openclaw-runtime' || existing.dependencies?.openclaw !== version) throw new Error('Unexpected runtime container; preserve it for review.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await fs.writeFile(manifestPath, JSON.stringify({ name: 'najd-managed-openclaw-runtime', private: true,
      version: '1.0.0', dependencies: { openclaw: version } }) + '\n', { flag: 'wx' })
  }
  const node = path.join(root, `node-v${pins.node.version}-win-x64/node.exe`)
  await fs.access(node)
  const npm = process.env.npm_execpath
  if (!npm || path.basename(npm) !== 'npm-cli.js') throw new Error('Run setup:openclaw through the pinned npm CLI.')
  const lockPath = path.join(container, 'package-lock.json')
  const canonicalLock = path.resolve(__dirname, '../build/runtime-locks/openclaw.package-lock.json')
  const approvedLock = await fs.readFile(canonicalLock)
  let installed = false
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'))
    if (!Buffer.from(await fs.readFile(lockPath)).equals(approvedLock)) throw new Error('Runtime dependency lock differs from the reviewed baseline.')
    if (lock.packages?.['node_modules/openclaw']?.integrity !== integrity) throw new Error('Runtime lock integrity mismatch.')
    await fs.access(path.join(container, 'node_modules/openclaw/openclaw.mjs'))
    installed = true
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!installed) {
    await fs.copyFile(canonicalLock, lockPath)
    const npmrc = path.join(container, 'npm-empty.rc')
    try { if ((await fs.readFile(npmrc, 'utf8')).trim()) throw new Error('Unexpected runtime npm configuration.') }
    catch (error) { if (error.code !== 'ENOENT') throw error; await fs.writeFile(npmrc, '', { flag: 'wx' }) }
    execFileSync(node, [npm, 'ci', '--prefix', container, '--ignore-scripts', '--no-audit', '--no-fund', '--userconfig', npmrc], {
      windowsHide: true, timeout: 180000, stdio: 'inherit',
      env: { ...process.env, PATH: path.dirname(node) + path.delimiter + process.env.PATH }
    })
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'))
    if (lock.packages?.['node_modules/openclaw']?.integrity !== integrity) throw new Error('Installed package integrity does not match approved payload.')
  }
  const packageRoot = path.join(container, 'node_modules/openclaw')
  const lifecycleEnv = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    PATH: path.dirname(node) + path.delimiter + path.join(process.env.SystemRoot, 'System32'),
    TEMP: container, TMP: container, HOME: container, USERPROFILE: container, APPDATA: container, LOCALAPPDATA: container }
  execFileSync(node, [path.join(packageRoot, 'scripts/postinstall-bundled-plugins.mjs')], {
    cwd: container, env: lifecycleEnv, windowsHide: true, timeout: 60000, stdio: 'inherit'
  })
  console.log(`Prepared managed OpenClaw ${version} dependencies and package lifecycle; no global installation.`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
