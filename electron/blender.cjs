// Finding the owner's Blender for NAJD's 3D tool (R-080): NAJD_BLENDER when set, otherwise the newest "Blender x.y" under the Blender
// Foundation folders of Program Files (system and per-user installs). Nothing is downloaded or installed; without Blender the 3D
// toolset is simply not ready and says so.
const fs = require('node:fs')
const path = require('node:path')

const version = name => (/(\d+)\.(\d+)/.exec(name) || [0, 0, 0]).slice(1).map(Number)
const newer = (a, b) => { const [x, y] = version(a), [u, v] = version(b); return x !== u ? x - u : y - v }

function findBlender({ env = process.env, exists = fs.existsSync, readdir = dir => fs.readdirSync(dir) } = {}) {
  if (env.NAJD_BLENDER && path.isAbsolute(env.NAJD_BLENDER) && /blender\.exe$/i.test(env.NAJD_BLENDER) && exists(env.NAJD_BLENDER)) return env.NAJD_BLENDER
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean).map(root => path.join(root, 'Blender Foundation'))
  const found = []
  for (const root of roots) {
    let names = []
    try { names = readdir(root) } catch { continue }
    for (const name of names) if (/^Blender\b/i.test(name)) { const exe = path.join(root, name, 'blender.exe'); if (exists(exe)) found.push([name, exe]) }
  }
  found.sort((a, b) => newer(b[0], a[0]))
  return found[0]?.[1] || null
}

module.exports = { findBlender }
