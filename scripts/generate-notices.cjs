const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')

// These dependencies contribute bundled code, icons, or fonts to the renderer.
const packages = Object.keys(require('../package.json').dependencies)

async function main() {
  const root = path.resolve(__dirname, '..')
  const notices = ['NAJD AGENT — Third-party notices',
    'Electron and Chromium notices are distributed beside the application executable.',
    'The notices below cover bundled application code, icons, and fonts.']
  const seen = new Set()
  async function visit(name, parent, optional = false) {
    // PDF text-only packaging explicitly excludes this optional native renderer.
    if (name.startsWith('@napi-rs/canvas') && require('../package.json').build.files.includes('!node_modules/@napi-rs/**')) return
    const resolver = createRequire(path.join(parent,'package.json'))
    if (optional) {
      try { resolver.resolve(name + '/package.json') }
      catch { try { resolver.resolve(name) } catch (error) { if (error.code === 'MODULE_NOT_FOUND') return; throw error } }
    }
    let directory
    try { directory = path.dirname(resolver.resolve(name + '/package.json')) }
    catch {
      // A package whose exports hide package.json is found in the module search folders first, without loading its code
      // (some publish a "require" entry that is missing from the package).
      for (const base of resolver.resolve.paths(name) || []) {
        try { if (JSON.parse(await fs.readFile(path.join(base, name, 'package.json'), 'utf8')).name === name) { directory = path.join(base, name); break } } catch {}
      }
    }
    if (!directory) {
      directory = path.dirname(resolver.resolve(name))
      while (true) {
        try { if (JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8')).name === name) break } catch {}
        const next = path.dirname(directory); if (next === directory) throw Error('License package not found');directory = next
      }
    }
    if (seen.has(directory)) return
    seen.add(directory)
    const manifest = JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'))
    const files = (await fs.readdir(directory)).filter(file => /^(license|licence|copying|notice)(\.|-|$)/i.test(file))
    const retained = path.join(root,'docs/third-party-notices',name.replace(/[@/]/g,'_') + '-' + manifest.version + '-NOTICE.txt')
    const texts = []
    for (const file of files) { const stat = await fs.stat(path.join(directory,file));if(stat.isFile()) texts.push(await fs.readFile(path.join(directory,file),'utf8')) }
    if (name === 'pdfjs-dist') {
      for (const folder of ['cmaps', 'iccs', 'standard_fonts', 'wasm']) {
        for (const file of (await fs.readdir(path.join(directory, folder))).filter(file => /^LICENSE/.test(file))) {
          texts.push(folder + '/' + file + '\n' + await fs.readFile(path.join(directory, folder, file), 'utf8'))
        }
      }
    }
    if(!texts.length) texts.push(await fs.readFile(retained,'utf8'))
    notices.push('\n' + name + ' ' + manifest.version + '\n' + '='.repeat(60) + '\n' + texts.join('\n'))
    for(const dependency of Object.keys(manifest.dependencies || {})) await visit(dependency,directory)
    for(const dependency of Object.keys(manifest.optionalDependencies || {})) await visit(dependency,directory,true)
  }
  for (const name of packages) await visit(name,root)
  const skillBundle = require('../electron/upstream-skills.json')
  notices.push(...skillBundle.notices)
  notices.push(['Bundled NAJD runtime components', '='.repeat(60),
    'The installer includes these original components under resources/najd-runtime. Their complete original',
    'license and notice files are installed beside them and are not modified:',
    '- engine/: Hermes Agent source snapshot (MIT, Nous Research) in engine/core/LICENSE; Python 3.14.7 in',
    '  engine/tools/python-*/LICENSE.txt (renamed executable najd-engine.exe); each Python distribution in its',
    '  .dist-info; recovered notices, uv licenses, security overrides and exclusions in engine/NAJD-NOTICES/.',
    '- gateway/: OpenClaw and its npm dependencies (OpenClaw: MIT, OpenClaw Foundation), each package license in',
    '  gateway/node_modules/<package>/.',
    '- node/: Node.js (najd-gateway.exe), node/LICENSE.',
    '- dotnet/: .NET runtime, dotnet/LICENSE.txt and dotnet/ThirdPartyNotices.txt.',
    '- desktop-host/: NAJD Windows desktop host and its .NET dependencies.'].join('\n'))
  await fs.mkdir(path.join(root, 'build'), { recursive: true })
  await fs.writeFile(path.join(root, 'build', 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n') + '\n', 'utf8')
  console.log(`Generated notices for ${seen.size} bundled dependencies.`)
}

main().catch(error => { console.error('Could not generate required third-party notices:', error.message); process.exitCode = 1 })
