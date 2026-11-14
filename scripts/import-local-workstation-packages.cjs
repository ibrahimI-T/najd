// One-time local migration used by the workstation UI and release verification.
// Run only while NAJD is closed: node scripts/import-local-workstation-packages.cjs [profileRoot]
const path = require('node:path')
const os = require('node:os')
const { createWorkstationPackages } = require('../electron/workstation/packages.cjs')
const { createLocalPackageImporter } = require('../electron/workstation/local-package-importer.cjs')
const { version } = require('../package.json')

async function main() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const profile = path.resolve(process.argv[2] || path.join(roaming, 'najd-agent'))
  const directory = path.join(profile, 'najd-data', 'workstation', 'packages')
  const packages = createWorkstationPackages({ directory, appVersion: version })
  const importer = createLocalPackageImporter({ roots: [
    path.join(roaming, 'kimi-desktop', 'daimon-share', 'daimon'),
    path.join(roaming, 'kimi-desktop', 'daimon-bundle', 'app', 'daimon')
  ], packages })
  const found = await importer.discover()
  if (!found.length) throw Object.assign(new Error('LOCAL_PACKAGES_NOT_FOUND'), { code: 'LOCAL_PACKAGES_NOT_FOUND' })
  const plan = await importer.plan(found.map(item => item.id))
  const result = await importer.install(plan.planId)
  process.stdout.write(JSON.stringify({ profile, discovered: found.length, installed: result.installed.map(item => item.id), failed: result.failed }, null, 2) + '\n')
  if (result.failed.length) process.exitCode = 2
}

main().catch(reason => { process.stderr.write(String(reason?.stack || reason) + '\n'); process.exitCode = 1 })
