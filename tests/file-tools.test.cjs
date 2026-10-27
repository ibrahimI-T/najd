const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createFileTool } = require('../electron/file-tools.cjs')

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-files-'))
  const root = path.join(dir, 'root')
  fs.mkdirSync(root)
  const entries = []
  const audit = { record: entry => entries.push(entry) }
  const tool = createFileTool({ getRoots: () => [root], audit, ...options })
  return { dir, root, tool, entries }
}

const read = (tool, filePath) => tool({ name: 'read-file', input: { path: filePath } })

test('rejects any read when no roots are granted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-files-'))
  const tool = createFileTool({ getRoots: () => [] })
  await assert.rejects(read(tool, path.join(dir, 'x.txt')), { code: 'NO_ROOTS' })
})

test('internal engine files remain protected even inside a granted parent folder', async () => {
  const { root } = setup()
  const protectedRoot = path.join(root, 'engine')
  fs.mkdirSync(protectedRoot)
  const file = path.join(protectedRoot, 'paired.json')
  fs.writeFileSync(file, 'private fixture token')
  const tool = createFileTool({ getRoots: () => [root], getProtectedRoots: () => [protectedRoot] })
  await assert.rejects(read(tool, file), { code: 'SENSITIVE_FILE' })
  const ordinary = path.join(root, 'ordinary.txt')
  fs.writeFileSync(ordinary, 'allowed text')
  assert.equal(await read(tool, ordinary), 'allowed text')
})

test('a junction alias cannot bypass internal-engine protection', async () => {
  const { root } = setup()
  const protectedRoot = path.join(root, 'engine')
  fs.mkdirSync(protectedRoot)
  fs.writeFileSync(path.join(protectedRoot, 'paired.json'), 'private fixture token')
  const alias = path.join(root, 'alias')
  fs.symlinkSync(protectedRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const tool = createFileTool({ getRoots: () => [root], getProtectedRoots: () => [protectedRoot] })
  await assert.rejects(read(tool, path.join(alias, 'paired.json')), { code: 'SENSITIVE_FILE' })
})

test('rejects unknown tool names and invalid paths', async () => {
  const { tool, root } = setup()
  await assert.rejects(tool({ name: 'write-file', input: { path: 'x' } }), { code: 'INVALID_INPUT' })
  await assert.rejects(tool({ name: 'read-file', input: {} }), { code: 'INVALID_INPUT' })
  await assert.rejects(tool({ name: 'read-file', input: { path: 42 } }), { code: 'INVALID_INPUT' })
  await assert.rejects(tool({ name: 'read-file', input: { path: '   ' } }), { code: 'INVALID_INPUT' })
  await assert.rejects(tool({ name: 'read-file', input: { path: 'x'.repeat(1025) } }), { code: 'INVALID_INPUT' })
  fs.writeFileSync(path.join(root, 'ok.txt'), 'ok')
  assert.equal(await read(tool, 'ok.txt'), 'ok')
})

test('rejects paths outside granted roots', async () => {
  const { dir, root, tool } = setup()
  const outside = path.join(dir, 'outside.txt')
  fs.writeFileSync(outside, 'secret')
  await assert.rejects(read(tool, outside), { code: 'PATH_NOT_ALLOWED' })
  await assert.rejects(read(tool, path.join(root, '..', 'outside.txt')), { code: 'PATH_NOT_ALLOWED' })
  const sibling = `${root}-evil`
  fs.mkdirSync(sibling)
  fs.writeFileSync(path.join(sibling, 'x.txt'), 'secret')
  await assert.rejects(read(tool, path.join(sibling, 'x.txt')), { code: 'PATH_NOT_ALLOWED' })
})

test('rejects sensitive basenames even inside a granted root', async () => {
  const { root, tool } = setup()
  const sensitive = ['.env', '.env.local', 'secret.pem', 'secret.key', 'cert.pfx', 'cert.p12',
    'id_rsa', 'id_rsa_backup', 'vault.kdbx', 'credentials.json', 'CREDENTIALS']
  for (const name of sensitive) {
    fs.writeFileSync(path.join(root, name), 'secret')
    await assert.rejects(read(tool, name), { code: 'SENSITIVE_FILE' }, name)
  }
  fs.writeFileSync(path.join(root, 'public.pub'), 'not sensitive')
  assert.equal(await read(tool, 'public.pub'), 'not sensitive')
})

test('distinguishes directories and missing files', async () => {
  const { root, tool } = setup()
  fs.mkdirSync(path.join(root, 'folder'))
  await assert.rejects(read(tool, 'folder'), { code: 'NOT_A_FILE' })
  await assert.rejects(read(tool, 'missing.txt'), { code: 'READ_FAILED' })
})

test('rejects files larger than maxBytes', async () => {
  const { root, tool } = setup({ maxBytes: 16 })
  fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(100))
  await assert.rejects(read(tool, 'big.txt'), { code: 'FILE_TOO_LARGE' })
})

test('rejects binary files with a NUL byte in the first 8KB', async () => {
  const { root, tool } = setup()
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.concat([Buffer.from('text'), Buffer.from([0]), Buffer.from('more')]))
  await assert.rejects(read(tool, 'bin.dat'), { code: 'BINARY_FILE' })
})

test('reads a small UTF-8 text file inside a granted root', async () => {
  const { root, tool } = setup()
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'note.txt'), 'مرحبا بالعالم', 'utf8')
  assert.equal(await read(tool, path.join('sub', 'note.txt')), 'مرحبا بالعالم')
  assert.equal(await read(tool, path.join(root, 'sub', 'note.txt')), 'مرحبا بالعالم')
})

test('rejects a symlink or junction escaping the root', async t => {
  const { dir, root, tool } = setup()
  const outside = path.join(dir, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction')
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EINVAL') return t.skip('symlink creation needs privileges')
    throw error
  }
  await assert.rejects(read(tool, path.join('link', 'secret.txt')), { code: 'PATH_NOT_ALLOWED' })
})

test('audits every attempt without ever recording file content', async () => {
  const { root, tool, entries } = setup()
  fs.writeFileSync(path.join(root, 'note.txt'), 'TOP-SECRET-CONTENT')
  assert.equal(await read(tool, 'note.txt'), 'TOP-SECRET-CONTENT')
  await assert.rejects(read(tool, 'nope.txt'), { code: 'READ_FAILED' })
  await assert.rejects(read(tool, path.join(root, '..', 'x.txt')), { code: 'PATH_NOT_ALLOWED' })
  assert.equal(entries.length, 3)
  const allowed = entries[0]
  assert.equal(allowed.action, 'read-file')
  assert.equal(allowed.decision, 'allowed')
  assert.equal(allowed.path, fs.realpathSync(path.join(root, 'note.txt')))
  assert.equal(entries[1].decision, 'denied')
  assert.equal(entries[1].reason, 'READ_FAILED')
  assert.equal(entries[2].decision, 'denied')
  assert.equal(entries[2].reason, 'PATH_NOT_ALLOWED')
  assert.equal(JSON.stringify(entries).includes('TOP-SECRET-CONTENT'), false)
})

test('works without an audit sink', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-files-'))
  fs.writeFileSync(path.join(dir, 'note.txt'), 'hi')
  const tool = createFileTool({ getRoots: () => [dir] })
  assert.equal(await read(tool, 'note.txt'), 'hi')
  await assert.rejects(read(tool, 'nope.txt'), { code: 'READ_FAILED' })
})

test('rejects a cancelled read before opening any file', async () => {
  const { tool, root } = setup()
  const controller = new AbortController()
  controller.abort()
  fs.writeFileSync(path.join(root, 'note.txt'), 'hi')
  await assert.rejects(tool({ name: 'read-file', input: { path: 'note.txt' }, signal: controller.signal }), { code: 'CANCELLED' })
})

test('rejects Windows alternate data stream paths', { skip: process.platform !== 'win32' }, async () => {
  const { tool, root } = setup()
  fs.writeFileSync(path.join(root, 'public.txt'), 'public')
  await assert.rejects(read(tool, 'public.txt:private'), { code: 'SENSITIVE_FILE' })
})

test('rejects invalid UTF-8 and binary markers beyond the first 8KB', async () => {
  const { tool, root } = setup()
  fs.writeFileSync(path.join(root, 'invalid.txt'), Buffer.from([0xc3, 0x28]))
  fs.writeFileSync(path.join(root, 'late.dat'), Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])]))
  await assert.rejects(read(tool, 'invalid.txt'), { code: 'BINARY_FILE' })
  await assert.rejects(read(tool, 'late.dat'), { code: 'BINARY_FILE' })
  fs.writeFileSync(path.join(root, 'empty.txt'), '')
  assert.equal(await read(tool, 'empty.txt'), '')
})
