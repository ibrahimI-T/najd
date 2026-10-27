// Prepare the upstream-required SDK locally; do not change the machine-wide installation.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const version = '10.0.400'
const sha512 = '9b8b88590e4da131bfd0da7aa089d0fc04d5418d5f8607ec13d55dc5a17b4399afd54d496c12657fa05c6c6546dc5eab930f26ac6c50f2d3a7712c0fb378c366'
const root = path.resolve(__dirname, '../.runtimes')
const destination = path.join(root, `dotnet-sdk-${version}`)
const sdkEnv = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
  DOTNET_CLI_HOME: path.join(root, 'dotnet-home'), DOTNET_ROOT: destination }
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This SDK payload is Windows x64 only.')
  let exists = false
  try { await fs.access(destination); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (exists) {
    const reported = execFileSync(path.join(destination, 'dotnet.exe'), ['--version'], { windowsHide: true, encoding: 'utf8', env: sdkEnv }).trim()
    if (reported !== version) throw new Error('Existing local SDK does not match the pin; preserve it for review.')
    console.log(`Verified local .NET SDK ${version}.`); return
  }
  await fs.mkdir(root, { recursive: true })
  const stage = await fs.mkdtemp(path.join(root, 'dotnet-stage-'))
  try {
    const response = await fetch(`https://builds.dotnet.microsoft.com/dotnet/Sdk/${version}/dotnet-sdk-${version}-win-x64.zip`, {
      signal: AbortSignal.timeout(180000), redirect: 'error'
    })
    if (!response.ok) throw new Error('SDK download rejected.')
    const chunks = []; let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 500 * 1024 * 1024) throw new Error('SDK size limit exceeded.')
      chunks.push(chunk)
    }
    const data = Buffer.concat(chunks)
    if (createHash('sha512').update(data).digest('hex') !== sha512) throw new Error('SDK checksum mismatch.')
    const archive = path.join(stage, 'sdk.zip')
    await fs.writeFile(archive, data, { flag: 'wx' })
    const unpacked = path.join(stage, 'sdk')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:NAJD_SDK_ARCHIVE, $env:NAJD_SDK_DEST)'], {
      windowsHide: true, timeout: 120000, env: { ...process.env, NAJD_SDK_ARCHIVE: archive, NAJD_SDK_DEST: unpacked }
    })
    await fs.rename(unpacked, destination)
    const reported = execFileSync(path.join(destination, 'dotnet.exe'), ['--version'], { windowsHide: true, encoding: 'utf8', env: sdkEnv }).trim()
    if (reported !== version) throw new Error('Unexpected SDK version.')
    console.log(`Prepared checksum-verified local .NET SDK ${version}; system SDK unchanged.`)
  } finally {
    if (!path.resolve(stage).startsWith(root + path.sep)) throw new Error('Unsafe SDK staging cleanup path.')
    await fs.rm(stage, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
