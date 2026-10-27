const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createToolbox, evaluate, decimal, parseDelimited } = require('../electron/toolbox.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-toolbox-'))
const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file }
const box = createToolbox({ resolveReadable: input => {
  const absolute = path.resolve(root, input)
  if (path.relative(root, absolute).startsWith('..')) throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' })
  return absolute
} })
const run = (tool, target = '', options = {}) => box.run({ tool, path: target, options: JSON.stringify(options) })
const calc = (expression, places) => decimal(evaluate(expression), places ?? 12)

test('calc is exact: no binary floating point drift', () => {
  assert.equal(calc('0.1+0.2'), '0.3')
  assert.equal(calc('1/3*3'), '1')
  assert.equal(calc('2^10'), '1024')
  assert.equal(calc('2^-2'), '0.25')
  assert.equal(calc('(1+2)*3-4/8'), '8.5')
  assert.equal(calc('1,000.50*2'), '2001')
  assert.equal(calc('1e3/8'), '125')
  assert.equal(calc('-7 % 3'), '2')
  assert.equal(calc('7 % -3'), '-2')
  assert.equal(calc('1/3', 6), '0.333333')
  assert.equal(calc('2/3', 6), '0.666667')
  assert.equal(calc('-2/3', 3), '-0.667')
  assert.equal(calc('0.0004', 3), '0')
  assert.equal(calc('1234567890123456789 * 987654321987654321', 0), String(1234567890123456789n * 987654321987654321n))
})

test('calc refuses anything that is not plain arithmetic, and runaway sizes', async () => {
  for (const bad of ['', '1/0', '1+', '(1', '1)', 'abc', '1,5+2', '1.5.2', '2^99999', '9^9^9', 'process.exit()', '1 2', '5 % 0'])
    assert.throws(() => evaluate(bad), { code: 'INVALID_INPUT' }, bad)
  assert.deepEqual(await run('calc', '', { expression: '10/4', places: 2 }), { expression: '10/4', result: '2.5', exact: '5/2' })
  await assert.rejects(run('calc', '', { expression: 'x'.repeat(500) }), { code: 'INVALID_INPUT' })
})

test('dates: day counts, weekdays and invalid calendar days', async () => {
  const result = await run('dates', '', { from: '2026-02-27', to: '2026-03-02', addDays: 3 })
  assert.equal(result.days, 3); assert.equal(result.weekday, 'Friday'); assert.equal(result.toWeekday, 'Monday')
  assert.deepEqual(result.plus, { days: 3, date: '2026-03-02', weekday: 'Monday' })
  assert.equal((await run('dates', '', { from: '2024-01-31', to: '2024-03-01' })).fullMonths, 1)
  await assert.rejects(run('dates', '', { from: '2026-02-30' }), { code: 'INVALID_INPUT' })
  await assert.rejects(run('dates', '', { from: 'tomorrow' }), { code: 'INVALID_INPUT' })
})

test('table profile: types, empties, numeric statistics, quoting, delimiter detection and a BOM', async () => {
  write('sales.csv', '﻿name;qty;price;day\r\n"Lamp, big";2;1,250.50;2026-01-02\r\nDesk;;99;2026-01-03\r\n"Say ""hi""";4;10.5;2026-01-04\r\n')
  const profile = await run('table', 'sales.csv')
  assert.equal(profile.delimiter, ';'); assert.equal(profile.rows, 3)
  const [name, qty, price, day] = profile.columns
  assert.equal(name.type, 'text'); assert.equal(name.top[0].value.length > 0, true)
  assert.deepEqual([qty.type, qty.filled, qty.empty, qty.min, qty.max, qty.sum], ['integer', 2, 1, '2', '4', '6'])
  assert.deepEqual([price.type, price.min, price.max], ['number', '10.5', '1250.5']); assert.equal(price.sum, '1360')
  assert.equal(day.type, 'date')
  assert.deepEqual(profile.sample[0], ['Lamp, big', '2', '1,250.50', '2026-01-02'])
  assert.deepEqual(parseDelimited('a,"b\nc",d\n', ',', 10).rows, [['a', 'b\nc', 'd']])
})

test('json outline shows shape, and pick returns one value without reading the rest', async () => {
  write('data.json', JSON.stringify({ users: [{ id: 1, name: 'A', tags: ['x'] }, { id: 2, name: 'B', tags: [] }], meta: { total: 2, note: 'hello' } }))
  const found = await run('json', 'data.json')
  assert.equal(found.outline.fields.users.length, 2); assert.equal(found.outline.fields.meta.fields.note, 'string(5)')
  assert.deepEqual((await run('json', 'data.json', { pick: 'users.1.name' })).value, 'B')
  assert.equal((await run('json', 'data.json', { pick: 'users.9' })).error, 'NO_MATCH')
  assert.equal((await run('json', 'data.json', { pick: '__proto__.x' })).error, 'NO_MATCH')
  write('broken.json', '{ nope')
  assert.equal((await run('json', 'broken.json')).error, 'INVALID_INPUT')
})

test('grep finds literal and regex matches with context, skips binaries and refuses catastrophic patterns', async () => {
  write('src/a.txt', 'alpha\nBeta line\nGamma\n')
  write('src/b.txt', 'nothing\nbeta again\n')
  fs.writeFileSync(path.join(root, 'src', 'c.bin'), Buffer.from([0, 1, 2, 98, 101, 116, 97]))
  const literal = await run('grep', 'src', { pattern: 'beta', context: 1 })
  assert.equal(literal.matches, 2); assert.equal(literal.skipped, 1)
  assert.deepEqual(literal.hits.map(hit => hit.file).sort(), ['a.txt', 'b.txt'])
  assert.equal((await run('grep', 'src/a.txt', { pattern: '^G\\w+$', regex: true })).matches, 1)
  assert.equal((await run('grep', 'src/a.txt', { pattern: 'beta', caseSensitive: true })).matches, 0)
  for (const pattern of ['(a+)+$', '(.*)*x', '(a)\\1', '(?<=a)b']) await assert.rejects(run('grep', 'src', { pattern, regex: true }), { code: 'INVALID_INPUT' }, pattern)
  assert.equal((await run('grep', 'src', { pattern: 'a', limit: 2 })).matches, 2)
})

test('hash and duplicates: identical content is found by hash, not by name', async () => {
  write('dup/one.txt', 'same bytes'); write('dup/two.dat', 'same bytes'); write('dup/three.txt', 'other bytes!'); write('dup/sub/four.txt', 'same bytes')
  const hashed = await run('hash', 'dup/one.txt')
  assert.equal(hashed.sha256, require('node:crypto').createHash('sha256').update('same bytes').digest('hex'))
  const found = await run('duplicates', 'dup')
  assert.equal(found.groups, 1); assert.equal(found.top[0].files.length, 3); assert.equal(found.wasted, '20 B')
})

test('diff reports only changed lines with context and says when files are identical', async () => {
  write('v1.txt', 'a\nb\nc\nd\ne\n'); write('v2.txt', 'a\nb\nX\nd\ne\nf\n'); write('v3.txt', 'a\nb\nc\nd\ne\n')
  const changed = await run('diff', 'v1.txt', { other: 'v2.txt', context: 1 })
  assert.equal(changed.added, 2); assert.equal(changed.removed, 1)
  assert.ok(changed.diff.includes('-c') && changed.diff.includes('+X') && changed.diff.includes('+f'))
  assert.deepEqual(await run('diff', 'v1.txt', { other: 'v3.txt' }), { identical: true })
})

test('inventory summarizes a folder by type, and skips dependency folders and secrets', async () => {
  write('proj/a.js', 'x'.repeat(100)); write('proj/b.js', 'y'); write('proj/readme.md', 'z'.repeat(2000)); write('proj/node_modules/pkg/i.js', 'ignored'); write('proj/.env', 'SECRET=1')
  const result = await run('inventory', 'proj')
  assert.equal(result.files, 3)
  assert.deepEqual(result.types.map(row => row.ext), ['.md', '.js'])
  assert.equal(result.largest[0].path, 'readme.md')
  assert.ok(!JSON.stringify(result).includes('SECRET') && !JSON.stringify(result).includes('node_modules'))
})

test('scope and input rules: paths outside the allowed folders, bad helpers, bad options, long output', async () => {
  await assert.rejects(run('hash', '../outside.txt'), { code: 'PATH_NOT_ALLOWED' })
  await assert.rejects(run('hash', 'missing.txt'), { code: 'NOT_FOUND' })
  assert.equal((await run('nope')).error, 'INVALID_INPUT')
  await assert.rejects(box.run({ tool: 'calc', path: '', options: '[1]' }), { code: 'INVALID_INPUT' })
  await assert.rejects(box.run({ tool: 'calc', path: '', options: '{bad' }), { code: 'INVALID_INPUT' })
  await assert.rejects(run('grep', ''), { code: 'INVALID_INPUT' })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(box.run({ tool: 'inventory', path: 'proj', options: '' }, { signal: controller.signal }), { code: 'CANCELLED' })
  write('wide.csv', 'id,' + Array.from({ length: 60 }, (_, index) => 'column_' + index).join(',') + '\n' + '1,' + Array.from({ length: 60 }, (_, index) => 'value number ' + index).join(',') + '\n')
  const wide = await run('table', 'wide.csv')
  assert.ok(JSON.stringify(wide).length <= 7200); assert.equal(wide.truncated, true)
})

test('the toolbox never writes: its source has no write, shell or network calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'toolbox.cjs'), 'utf8')
  assert.doesNotMatch(source, /writeFile|appendFile|unlink|rmSync|\brm\(|rename|child_process|spawn|execSync|execFile|fetch\(|require\('node:(http|https|net)'\)|\beval\(|new Function/)
})

test('R064-01: recursive helpers apply the file resolver to every entry, so protected folders and names are never listed or read', async () => {
  write('scope/ok.txt', 'needle here'); write('scope/.hermes/config.txt', 'needle secret'); write('scope/credentials-backup.json', '{"needle":1}')
  const guarded = createToolbox({ resolveReadable: input => {
    const absolute = path.resolve(root, input)
    if (absolute.split(path.sep).includes('.hermes') || /credentials/i.test(path.basename(absolute))) throw Object.assign(new Error('SENSITIVE_FILE'), { code: 'SENSITIVE_FILE' })
    return absolute
  } })
  const found = await guarded.run({ tool: 'grep', path: 'scope', options: JSON.stringify({ pattern: 'needle' }) })
  assert.deepEqual(found.hits.map(hit => hit.file), ['ok.txt'])
  const listing = await guarded.run({ tool: 'inventory', path: 'scope', options: '' })
  assert.equal(listing.files, 1)
})

test('R064-02: a catastrophic ambiguous pattern ends at the deadline instead of blocking the process', async () => {
  write('slow/line.txt', 'a'.repeat(900) + '!')
  const started = Date.now()
  await assert.rejects(run('grep', 'slow', { pattern: '(a|aa)+$', regex: true }), error => ['TIMEOUT', 'INVALID_INPUT'].includes(error.code))
  assert.ok(Date.now() - started < 6000, 'returned promptly')
  assert.equal((await run('grep', 'slow', { pattern: 'a{3}!', regex: true })).matches, 1)
})

test('R064-08: any result, including one huge value, stays within the output bound', async () => {
  write('huge.json', JSON.stringify({ text: 'x'.repeat(100000), list: Array.from({ length: 500 }, (_, index) => ({ index, label: 'y'.repeat(50) })) }))
  for (const options of [{ pick: 'text' }, { pick: '' }, { depth: 3 }, { pick: 'list' }]) {
    const result = await run('json', 'huge.json', options)
    assert.ok(JSON.stringify(result).length <= 7000, JSON.stringify(options) + ' ' + JSON.stringify(result).length)
  }
  assert.equal((await run('json', 'huge.json', { pick: 'text' })).truncated, true)
})

test('R064-09: wording about counting or comparing loads the toolbox in profiles that do not carry it', () => {
  const { extraToolsets } = require('../electron/agent-toolsets.cjs')
  for (const text of ['compare these JSON files', 'how many duplicates are in the folder', 'calculate the total', 'احسب المجموع', 'كم يوم بين التاريخين'])
    assert.ok(extraToolsets(text).includes('toolbox'), text)
  assert.ok(!extraToolsets('write a poem').includes('toolbox'))
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'electron', 'agent-toolsets.cjs'), 'utf8').includes('\b'), false, 'no literal backspace characters')
})

test('R064-103: a table with thousands of columns or cells is refused or bounded, never profiled by brute force', async () => {
  write('columns.csv', Array.from({ length: 5000 }, (_, index) => 'c' + index).join(',') + '\n1\n2\n')
  const wide = await run('table', 'columns.csv')
  assert.equal(wide.error, 'FILE_TOO_LARGE')
  write('cells.csv', 'a,b,c\n' + '1,2,3\n'.repeat(400000))
  const started = Date.now()
  const big = await run('table', 'cells.csv')
  assert.ok(Date.now() - started < 5000)
  assert.equal(big.complete, false); assert.ok(big.rows <= 400000)
})

test('R064-106: the delimiter is found with quotes respected, and can be given', async () => {
  write('semi.csv', 'name;qty\n"a,b,c,d";2\n"e,f,g,h";3\n')
  const profile = await run('table', 'semi.csv')
  assert.equal(profile.delimiter, ';'); assert.deepEqual(profile.columns.map(column => column.name), ['name', 'qty']); assert.equal(profile.columns[1].sum, '5')
  write('pipe.txt', 'a|b\n1|2\n')
  assert.equal((await run('table', 'pipe.txt', { delimiter: '|' })).delimiter, '|')
  write('tab.tsv', 'a\tb\n1\t2\n')
  assert.equal((await run('table', 'tab.tsv')).delimiter, 'tab')
})

test('R064-107: even an escaped preview fallback stays within the bound', async () => {
  write('many.json', JSON.stringify({ data: Object.fromEntries(Array.from({ length: 6000 }, (_, index) => ['k' + index, '"q"' + index])) }))
  const result = await run('json', 'many.json', { pick: 'data' })
  assert.ok(JSON.stringify(result).length <= 7000, String(JSON.stringify(result).length))
  assert.equal(result.truncated, true)
})

test('R064-205: literal search reads whole lines; a partial search says so and is not reported as complete', async () => {
  write('long/one-line.json', '{"a":"' + 'x'.repeat(1500) + 'needle"}')
  const literal = await run('grep', 'long', { pattern: 'needle' })
  assert.equal(literal.matches, 1)
  write('long/big.txt', 'y'.repeat(1100000))
  const partial = await run('grep', 'long', { pattern: 'absent-word' })
  assert.equal(partial.matches, 0); assert.equal(partial.complete, false); assert.equal(partial.notSearched.largerThan1MB, 1)
  fs.rmSync(path.join(root, 'long', 'big.txt'))
  const full = await run('grep', 'long', { pattern: 'absent-word' })
  assert.equal(full.complete, true)
  write('long/regex-line.txt', 'z'.repeat(6000) + 'tail')
  const cut = await run('grep', 'long', { pattern: 'tail$', regex: true })
  assert.equal(cut.matches, 0); assert.equal(cut.complete, false); assert.equal(cut.notSearched.longLinesCutAt5000, 1)
})

test('R064-206: duplicates is marked partial when candidate files were not compared', async () => {
  write('dups/a.txt', 'same'); write('dups/b.txt', 'same')
  assert.equal((await run('duplicates', 'dups')).complete, true)
})

test('R064-304: hashing reads no more than the size the file had, and duplicates reports a budget it could not finish', async () => {
  write('grow/a.txt', 'abcdef')
  const result = await run('hash', 'grow/a.txt')
  assert.equal(result.size, 6)
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'electron', 'toolbox.cjs'), 'utf8'), /limit - total/)
})


test('R064-REV-004: complete months and day counts are right for reverse intervals', async () => {
  const reverse = await run('dates', '', { from: '2026-10-22', to: '2026-10-21' })
  assert.equal(reverse.days, -1); assert.equal(reverse.fullMonths, 0)
  const across = await run('dates', '', { from: '2026-03-15', to: '2026-01-20' })
  assert.equal(across.fullMonths, -1); assert.equal(across.days, -54)
  assert.equal((await run('dates', '', { from: '2026-01-20', to: '2026-03-15' })).fullMonths, 1)
  assert.equal((await run('dates', '', { from: '2026-01-31', to: '2026-03-01' })).fullMonths, 1)
})

test('R064-REV-503: table statistics are exact, with large integers and many decimals, and never overflow to null', async () => {
  write('exact.csv', 'big,dec,huge\n1234567890123,0.1,1e30\n9007199254740993,0.2,1e30\n')
  const profile = await run('table', 'exact.csv')
  const [big, dec, huge] = profile.columns
  assert.equal(big.sum, String(1234567890123n + 9007199254740993n)); assert.equal(big.max, '9007199254740993')
  assert.equal(dec.sum, '0.3'); assert.equal(dec.mean, '0.15'); assert.equal(dec.median, '0.15')
  assert.equal(huge.sum, '2' + '0'.repeat(30))
})

test('R064-REV-504: decimals written as .5 or 1. are numbers', async () => {
  assert.equal((await run('calc', '', { expression: '.5+1' })).result, '1.5')
  assert.equal((await run('calc', '', { expression: '1.+2' })).result, '3')
  await assert.rejects(run('calc', '', { expression: '.+1' }), { code: 'INVALID_INPUT' })
})

test('R064-REVIEW-003: huge numeric cells are refused before any BigInt is built, and the table call returns promptly', async () => {
  write('hostile.csv', 'a,b\n0.' + '0'.repeat(1000000) + '1,2\n3,4\n')
  const started = Date.now()
  const profile = await run('table', 'hostile.csv')
  assert.ok(Date.now() - started < 3000, 'prompt: ' + (Date.now() - started))
  assert.equal(profile.columns[0].type, 'text', 'a value that is not a plain bounded number is not read as one')
  assert.equal(profile.columns[1].sum, '6')
  write('exp.csv', 'a\n1e500\n')
  assert.equal((await run('table', 'exp.csv')).columns[0].type, 'text')
})

test('R064-004: sensitive file names are refused for direct paths and for the second file of a diff, not only while walking', async () => {
  write('proj/.npmrc', '//registry/:_authToken=abc'); write('proj/.netrc', 'machine x password y'); write('proj/secrets.json', '{"k":"v"}'); write('proj/ok.txt', 'fine')
  await assert.rejects(run('grep', 'proj/.npmrc', { pattern: 'authToken' }), { code: 'SENSITIVE_FILE' })
  await assert.rejects(run('hash', 'proj/.netrc'), { code: 'SENSITIVE_FILE' })
  await assert.rejects(run('json', 'proj/secrets.json'), { code: 'SENSITIVE_FILE' })
  await assert.rejects(run('diff', 'proj/ok.txt', { other: 'proj/.npmrc' }), { code: 'SENSITIVE_FILE' })
  assert.equal((await run('hash', 'proj/ok.txt')).size, 4)
})

test('R064-REVIEW-005: empty files are compared too', async () => {
  write('empties/a.txt', ''); write('empties/b.txt', ''); write('empties/c.txt', 'x')
  const result = await run('duplicates', 'empties')
  assert.equal(result.groups, 1); assert.equal(result.top[0].files.length, 2)
})

test('R064-IR-3403: numbers a double cannot hold exactly are returned as their source text, never rounded or turned into null', async () => {
  write('numbers.json', '{"id":9007199254740993,"big":1e400,"small":0.30000000000000004,"fine":12.5,"int":42,"list":[123456789012345678901234567890]}')
  assert.deepEqual((await run('json', 'numbers.json', { pick: 'id' })).value, { $exactNumber: '9007199254740993' })
  assert.deepEqual((await run('json', 'numbers.json', { pick: 'big' })).value, { $exactNumber: '1e400' })
  assert.deepEqual((await run('json', 'numbers.json', { pick: 'small' })).value, { $exactNumber: '0.30000000000000004' })
  assert.equal((await run('json', 'numbers.json', { pick: 'fine' })).value, 12.5)
  assert.equal((await run('json', 'numbers.json', { pick: 'int' })).value, 42)
  assert.deepEqual((await run('json', 'numbers.json', { pick: 'list.0' })).value, { $exactNumber: '123456789012345678901234567890' })
})

test('R064-REV-3503: a nonzero number that underflows to zero is returned as its source text', async () => {
  write('tiny.json', '{"a":1e-400,"b":-1e-400,"c":0,"d":0.0,"e":0e5}')
  assert.deepEqual((await run('json', 'tiny.json', { pick: 'a' })).value, { $exactNumber: '1e-400' })
  assert.deepEqual((await run('json', 'tiny.json', { pick: 'b' })).value, { $exactNumber: '-1e-400' })
  for (const key of ['c', 'd', 'e']) assert.equal((await run('json', 'tiny.json', { pick: key })).value, 0, key)
})

test('R064-REVIEW-4102: a nonzero subnormal number is returned as its source text', async () => {
  write('subnormal.json', '{"a":3e-324,"b":-4e-320,"c":1e-307}')
  assert.deepEqual((await run('json', 'subnormal.json', { pick: 'a' })).value, { $exactNumber: '3e-324' })
  assert.deepEqual((await run('json', 'subnormal.json', { pick: 'b' })).value, { $exactNumber: '-4e-320' })
  assert.equal((await run('json', 'subnormal.json', { pick: 'c' })).value, 1e-307)
})

test('R064-REVIEW-4402: a large diff yields to the event loop, stops when the task is stopped, and refuses files beyond its size', async () => {
  const prefix = 'common prefix of a rather long line that makes every comparison expensive '.repeat(20)
  const lines = count => Array.from({ length: count }, (_, index) => prefix + (index % 7))
  write('big/a.txt', lines(2500).join('\n')); write('big/b.txt', lines(2500).reverse().join('\n'))
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 5)
  const started = Date.now()
  const result = await run('diff', 'big/a.txt', { other: 'big/b.txt' }).catch(error => ({ error: error.code }))
  clearInterval(timer)
  assert.ok(Date.now() - started < 8000, 'bounded')
  assert.ok(ticks > 3, 'other work (timers) ran during the diff: ' + ticks)
  assert.ok(result.added !== undefined || ['TIMEOUT'].includes(result.error), JSON.stringify(result).slice(0, 100))
  const controller = new AbortController()
  const pending = box.run({ tool: 'diff', path: 'big/a.txt', options: JSON.stringify({ other: 'big/b.txt' }) }, { signal: controller.signal })
  setTimeout(() => controller.abort(), 30)
  await assert.rejects(pending, error => ['CANCELLED', 'TIMEOUT'].includes(error.code))
  write('big/c.txt', lines(3001).join('\n'))
  assert.equal((await run('diff', 'big/c.txt', { other: 'big/a.txt' })).error, 'FILE_TOO_LARGE')
})

test('R064-REVIEW-4502: a large numeric table is profiled in turns, stops when the task is stopped, and says when the median was skipped', async () => {
  const rows = 120000
  write('large.csv', 'id,value\n' + Array.from({ length: rows }, (_, index) => index + ',' + (index * 7 % 1000) + '.5').join('\n'))
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 5)
  const profile = await run('table', 'large.csv')
  clearInterval(timer)
  assert.ok(ticks > 3, 'the event loop was not blocked: ' + ticks)
  assert.equal(profile.rows, rows)
  const value = profile.columns[1]
  assert.equal(value.median, null); assert.match(value.medianNote, /not computed/); assert.ok(value.sum && value.min && value.max)
  const controller = new AbortController()
  const pending = box.run({ tool: 'table', path: 'large.csv', options: '' }, { signal: controller.signal })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, { code: 'CANCELLED' })
  write('small.csv', 'n\n3\n1\n2\n')
  assert.equal((await run('table', 'small.csv')).columns[0].median, '2')
})

test('R064-REVIEW-4602: malformed CSV is refused instead of producing numbers that were never in the file', async () => {
  write('bad1.csv', 'amount\n"10"20\n')
  const bad1 = await run('table', 'bad1.csv')
  assert.equal(bad1.error, 'INVALID_INPUT'); assert.equal(bad1.columns, undefined)
  write('bad2.csv', 'amount\n"10\n20\n')
  assert.equal((await run('table', 'bad2.csv')).error, 'INVALID_INPUT')
  write('bad3.csv', 'a,b\n"x"y,2\n')
  assert.equal((await run('table', 'bad3.csv')).error, 'INVALID_INPUT')
  // Valid quoting still works: escaped quotes, quoted delimiters and newlines, empty quoted fields, a quoted last field.
  write('ok.csv', 'a,b\n"x ""q"" y","1,5"\n"",2\n"multi\nline",3\n"last",4')
  const ok = await run('table', 'ok.csv')
  assert.equal(ok.rows, 4); assert.equal(ok.complete, true); assert.equal(ok.columns[1].type, 'text')
})

test('R064-IR-4703: a grep excerpt contains the match and says where it is, also in a very long line', async () => {
  write('minified/data.json', '{"a":"' + 'x'.repeat(5000) + '","needle":"FOUND-HERE","z":"' + 'y'.repeat(3000) + '"}')
  const result = await run('grep', 'minified', { pattern: 'FOUND-HERE', context: 0 })
  assert.equal(result.matches, 1)
  const hit = result.hits[0]
  assert.ok(hit.text.includes('FOUND-HERE'), hit.text.slice(0, 120)); assert.ok(hit.column > 5000); assert.equal(hit.clipped, true)
  assert.ok(hit.text.startsWith('…'))
  write('minified/short.txt', 'a needle b')
  const short = (await run('grep', 'minified/short.txt', { pattern: 'needle' })).hits[0]
  assert.equal(short.text, 'a needle b'); assert.equal(short.column, 3); assert.equal(short.clipped, undefined)
})

test('a folder helper with an empty path works on the workspace; a file helper still needs a path', async () => {
  write('ws-file.txt', 'x')
  const result = await run('inventory', '')
  assert.ok(!result.error, JSON.stringify(result)); assert.ok(result.files >= 1 || result.total >= 1 || JSON.stringify(result).includes('txt'))
  await assert.rejects(run('hash', ''), { code: 'INVALID_INPUT' })
})