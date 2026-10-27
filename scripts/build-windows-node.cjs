const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const sdk = path.join(root, '.runtimes/dotnet-sdk-10.0.400')
const cliHome = path.join(root, '.runtimes/dotnet-home')
const env = { ...process.env, PATH: sdk + path.delimiter + process.env.PATH,
  DOTNET_ROOT: sdk, DOTNET_CLI_HOME: cliHome, DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
  NUGET_PACKAGES: path.join(root, '.runtimes/nuget-packages'),
  OPENCLAW_REPO_ROOT: path.join(root, 'third_party/openclaw-windows-node') }
try {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 only.')
  const dotnet = path.join(sdk, 'dotnet.exe')
  if (execFileSync(dotnet, ['--version'], { cwd: root, env, encoding: 'utf8', windowsHide: true }).trim() !== '10.0.400')
    throw new Error('Prepare the pinned SDK with setup:dotnet.')
  execFileSync(dotnet, ['publish', 'native/windows-node-host/Najd.WindowsNode.csproj', '-c', 'Release',
    '-o', '.runtimes/windows-node-host', '--configfile', 'third_party/openclaw-windows-node/NuGet.Config',
    '--artifacts-path', '.runtimes/native-artifacts', '-p:RestoreLockedMode=true', '--nologo'], {
    cwd: root, env, windowsHide: true, timeout: 180000, stdio: 'inherit' })
} catch (error) { console.error(error.message); process.exitCode = 1 }
