// The folder that holds NAJD's unpacked components ("runtime") and install.log. Installer preparation, normal start and
// uninstall (build/installer.nsh customUnInstall mirrors this) must all find the same folder: %LOCALAPPDATA%\NAJD AGENT,
// or the profile's AppData\Local\NAJD AGENT when the variable is missing (C53-03).
const path = require('node:path')
const os = require('node:os')

// Only a drive path (C:\...) or a UNC path (\\server\...) is taken; installer.nsh applies the same test.
const usable = value => typeof value === 'string' && /^(?:.:[\\/]|[\\/]{2})/.test(value)
function najdLocalRoot(env = process.env, home = os.homedir()) {
  const local = usable(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.join(home, 'AppData', 'Local')
  return path.join(local, 'NAJD AGENT')
}
module.exports = { najdLocalRoot }
