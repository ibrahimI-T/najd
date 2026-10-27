// Fixed, main-owned health probes for managed runtime components. Commands are
// chosen here per component ID, never taken from a manifest; probes run the
// component's own executable with a scrubbed environment, bounded output and a
// timeout, and succeed only on a verified postcondition.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const probeSource = fs.readFileSync(path.join(__dirname, 'agent-core-probe.py'), 'utf8')
const AGENT_CORE_REVISION = 'c70332f88886932337619a1e57029bd885c28b9d'

function inside(root, target) {
  const relative = path.relative(root, target)
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function run(executable, args, { signal, timeoutMs = 60000, extraEnv = {}, cwd = os.tmpdir() } = {}) {
  return new Promise(resolve => {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const env = { SystemRoot: systemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), PATH: path.join(systemRoot, 'System32'),
      PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', NO_COLOR: '1', ...extraEnv }
    let child
    try { child = spawn(executable, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { resolve({ code: -1, output: '' }); return }
    let output = '', settled = false
    const collect = chunk => { if (output.length < 16384) output += chunk.toString('utf8') }
    child.stdout.on('data', collect); child.stderr.on('data', () => {})
    const kill = () => { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { child.kill() } }
    const timer = setTimeout(kill, timeoutMs)
    signal?.addEventListener('abort', kill, { once: true })
    const done = value => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', kill); resolve(value) }
    child.on('error', () => done({ code: -1, output: '' }))
    child.on('close', code => done({ code, output: output.trim() }))
  })
}

async function checkComponent({ component, directory, signal, runner = run }) {
  const exe = name => path.join(directory, name)
  switch (component.id) {
    case 'node': {
      const result = await runner(exe('node.exe'), ['--version'], { signal })
      return result.code === 0 && result.output === 'v' + component.version
    }
    case 'python': {
      const result = await runner(exe('python.exe'), ['-I', '-S', '-B', '-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'], { signal })
      return result.code === 0 && result.output === component.version
    }
    case 'uv': {
      const result = await runner(exe('uv.exe'), ['--version'], { signal })
      return result.code === 0 && result.output.startsWith('uv ' + component.version)
    }
    case 'agent-core': {
      let receipt
      try {
        const file = path.join(directory, 'najd-core.json')
        if (fs.statSync(file).size > 1024 * 1024) return false
        receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch { return false }
      if (receipt?.format !== 'najd-agent-core-v1' || receipt.sourceRevision !== AGENT_CORE_REVISION || typeof receipt.python !== 'string') return false
      const interpreter = path.resolve(directory, receipt.python)
      if (!inside(directory, interpreter) || !['python.exe', 'najd-engine.exe'].includes(path.basename(interpreter).toLowerCase())) return false
      // Private throwaway state: the probe never sees the user's profile or a standalone installation.
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-core-health-'))
      let result
      try {
        result = await runner(interpreter, ['-I', '-S', '-B', '-c', probeSource, directory, AGENT_CORE_REVISION], { signal, timeoutMs: 120000, cwd: home,
          extraEnv: { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), TEMP: home, TMP: home,
            HERMES_HOME: path.join(home, 'profile'), HERMES_RUNTIME_DIR: path.join(directory, 'tools') } })
      } finally { fs.rmSync(home, { recursive: true, force: true }) }
      if (result.code !== 0) return false
      try { const proof = JSON.parse(result.output.split(/\r?\n/).at(-1)); return proof.isolated === true && proof.modules?.includes('run_agent.AIAgent') }
      catch { return false }
    }
    // Components without a verified probe are never reported healthy.
    default: return false
  }
}

module.exports = { checkComponent, run }
