// A cold first start after an install or update can fail the gateway's checks (measured: ready after ~105 s, then the
// check failed and the engine stayed stopped until first use). Startup makes one more attempt, never for a final error.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

test('startup retries the gateway once after a failed cold start', () => {
  const start = main.indexOf('const startGateway = (retry = true)')
  assert.ok(start > 0)
  const body = main.slice(start, main.indexOf('\n  if (bundleRuntime) void bundleRuntime.prepare()', start))
  assert.match(body, /if \(retry && !quitting && !\['CANCELLED', 'NOT_INSTALLED', 'INCOMPATIBLE_RUNTIME'\]\.includes\(error\.code\)\)/)
  assert.match(body, /startGateway\(false\)/, 'the second attempt does not retry again')
  assert.match(body, /again\.unref\(\)/)
})
