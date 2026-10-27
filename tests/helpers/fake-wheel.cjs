// A minimal real wheel for tests: a ZIP holding <name>.dist-info/entry_points.txt with the given console scripts, and
// its sha256, so plans can read the program to run exactly as they do for PyPI.
const { zipSync, strToU8 } = require('fflate')
const { createHash } = require('node:crypto')

function fakeWheel(filename, scripts = []) {
  const dist = filename.split('-').slice(0, 2).join('-') + '.dist-info'
  const entryPoints = '[console_scripts]\n' + scripts.map(script => `${script} = pkg.main:run`).join('\n') + '\n'
  const bytes = Buffer.from(zipSync({ [dist + '/entry_points.txt']: strToU8(entryPoints), [dist + '/METADATA']: strToU8('Name: x\n') }))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { file: { packagetype: 'bdist_wheel', url: 'https://files.pythonhosted.org/p/' + filename, filename, digests: { sha256 } }, bytes }
}

// Wraps a JSON fetch fake so wheel URLs answer with their bytes.
function withWheels(fetchImpl, wheels) {
  const byUrl = new Map(wheels.map(wheel => [wheel.file.url, wheel.bytes]))
  return async (url, options) => byUrl.has(String(url))
    ? new Response(byUrl.get(String(url)), { headers: { 'content-length': String(byUrl.get(String(url)).length) } })
    : fetchImpl(url, options)
}

module.exports = { fakeWheel, withWheels }
