// Prepare a checksum-pinned stock Node runtime without changing the system installation.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const { version, archiveSha256: checksum } = require('../electron/runtime-pins.json').node
const archive = `node-v${version}-win-x64.zip`
const root = path.resolve(__dirname, '../.runtimes')
const destination = path.join(root, `node-v${version}-win-x64`)
const digest = data => createHash('sha256').update(data).digest('hex')

async function verifyInstalled() {
  const record = JSON.parse(await fs.readFile(path.join(destination, 'najd-runtime.json'), 'utf8'))
  const executable = path.join(destination, 'node.exe')
  if (record.archiveSha256 !== checksum || record.version !== version ||
      digest(await fs.readFile(executable)) !== record.executableSha256 ||
      execFileSync(executable, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim() !== `v${version}`) {
    throw new Error('Existing project runtime failed verification; preserve it for review.')
  }
  return executable
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This payload supports Windows x64 only.')
  await fs.mkdir(root, { recursive: true })
  let installed = false
  try { await fs.access(destination); installed = true }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (installed) {
    console.log(`Verified project Node ${version}: ${await verifyInstalled()}`)
    return
  }
  const stage = await fs.mkdtemp(path.join(root, 'node-stage-'))
  try {
    const response = await fetch(`https://nodejs.org/dist/v${version}/${archive}`, {
      signal: AbortSignal.timeout(120000), redirect: 'error'
    })
    if (!response.ok || Number(response.headers.get('content-length')) > 100 * 1024 * 1024) throw new Error('Node download rejected.')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 100 * 1024 * 1024) throw new Error('Node archive exceeded size limit.')
      chunks.push(chunk)
    }
    const data = Buffer.concat(chunks)
    if (digest(data) !== checksum) throw new Error('Node archive checksum mismatch.')
    const zip = path.join(stage, archive)
    await fs.writeFile(zip, data, { flag: 'wx' })
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:NAJD_NODE_ARCHIVE, $env:NAJD_NODE_STAGE)'], {
      windowsHide: true, timeout: 60000,
      env: { ...process.env, NAJD_NODE_ARCHIVE: zip, NAJD_NODE_STAGE: stage }
    })
    const extracted = path.join(stage, `node-v${version}-win-x64`)
    const executable = path.join(extracted, 'node.exe')
    if (execFileSync(executable, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim() !== `v${version}`) throw new Error('Wrong Node runtime version.')
    await fs.writeFile(path.join(extracted, 'najd-runtime.json'), JSON.stringify({
      version, archiveSha256: checksum, executableSha256: digest(await fs.readFile(executable)), installationId: randomUUID()
    }) + '\n', { flag: 'wx' })
    await fs.rename(extracted, destination)
    console.log(`Prepared checksum-verified project Node ${version}: ${await verifyInstalled()}`)
  } finally {
    // Only remove the newly created staging directory inside the fixed runtime root.
    if (!path.resolve(stage).startsWith(root + path.sep)) throw new Error('Unsafe staging cleanup path.')
    await fs.rm(stage, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
