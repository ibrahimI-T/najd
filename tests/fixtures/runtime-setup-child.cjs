// Owned crash fixture: no user profile, provider credential or executable tool.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRuntimeSetup } = require('../../electron/runtime-setup.cjs')
async function main() {
  const directory = path.resolve(process.argv[2])
  const input = JSON.parse(await fs.readFile(path.join(directory, 'input.json'), 'utf8'))
  const setup = createRuntimeSetup({ root: path.join(directory, 'store'), config: input.config,
    getManifest: async () => input.manifest, fetchImpl: async () => new Response(await fs.readFile(path.join(directory, 'fixture.zip'))),
    health: async () => {
      await fs.writeFile(path.join(directory, 'health-started'), 'owned fixture')
      return new Promise(() => { setInterval(() => {}, 1000) })
    }, canActivate: async () => true })
  await setup.prepare(['node'])
}
main().catch(() => { process.exitCode = 1 })
