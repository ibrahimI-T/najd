const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createActivityLog } = require('../electron/activity-log.cjs')

function setup(maxEntries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-log-'))
  const filePath = path.join(dir, 'activity-log.jsonl')
  return { dir, filePath, log: createActivityLog({ filePath, ...(maxEntries ? { maxEntries } : {}) }) }
}

test('record appends JSON lines and creates the log file', () => {
  const { filePath, log } = setup()
  log.record({ action: 'read-file', decision: 'allowed', path: 'C:\\a.txt' })
  log.record({ action: 'read-file', decision: 'denied', path: 'C:\\b.txt', reason: 'NO_ROOTS' })
  assert.ok(fs.existsSync(filePath))
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  const first = JSON.parse(lines[0])
  assert.equal(first.action, 'read-file')
  assert.equal(typeof first.time, 'string')
  assert.ok(Number.isFinite(Date.parse(first.time)))
  assert.equal(JSON.parse(lines[1]).reason, 'NO_ROOTS')
})

test('tail returns the newest n entries in order', () => {
  const { log } = setup()
  for (let i = 1; i <= 5; i++) log.record({ action: 'read-file', decision: 'allowed', path: `f${i}` })
  assert.deepEqual(log.tail(2).map(entry => entry.path), ['f4', 'f5'])
  assert.deepEqual(log.tail(50).map(entry => entry.path), ['f1', 'f2', 'f3', 'f4', 'f5'])
  assert.deepEqual(log.tail(0), [])
})

test('tail caps at maxEntries, dropping the oldest', () => {
  const { log } = setup(5)
  for (let i = 1; i <= 12; i++) log.record({ action: 'read-file', decision: 'allowed', path: `f${i}` })
  assert.deepEqual(log.tail(100).map(entry => entry.path), ['f8', 'f9', 'f10', 'f11', 'f12'])
})

test('rewrites the file to maxEntries once it grows past twice the cap', () => {
  const { filePath, log } = setup(5)
  for (let i = 1; i <= 16; i++) log.record({ action: 'read-file', decision: 'allowed', path: `f${i}` })
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n')
  assert.ok(lines.length <= 10)
  assert.deepEqual(log.tail(100).map(entry => entry.path), ['f12', 'f13', 'f14', 'f15', 'f16'])
})

test('record sanitizes non-scalar fields so contents cannot leak', () => {
  const { filePath, log } = setup()
  log.record({ action: 'read-file', decision: 'allowed', path: 'a.txt', content: { text: 'FILE-BODY' }, list: ['FILE-BODY'] })
  const entry = JSON.parse(fs.readFileSync(filePath, 'utf8').trim())
  assert.deepEqual(Object.keys(entry).sort(), ['action', 'decision', 'path', 'time'])
  assert.equal(fs.readFileSync(filePath, 'utf8').includes('FILE-BODY'), false)
})

test('activity log rejects undeclared scalar fields containing secrets or file bodies', () => {
  const { filePath, log } = setup()
  log.record({ action: 'read-file', decision: 'allowed', path: 'a.txt', content: 'PRIVATE-BODY', apiKey: 'PRIVATE-KEY' })
  const raw = fs.readFileSync(filePath, 'utf8')
  assert.equal(raw.includes('PRIVATE-BODY'), false)
  assert.equal(raw.includes('PRIVATE-KEY'), false)
})

test('record never throws and tail fails closed on unwritable or invalid paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-log-'))
  const blocker = path.join(dir, 'blocker')
  fs.writeFileSync(blocker, 'not a directory')
  const log = createActivityLog({ filePath: path.join(blocker, 'activity-log.jsonl') })
  assert.doesNotThrow(() => log.record({ action: 'read-file', decision: 'allowed', path: 'x' }))
  assert.deepEqual(log.tail(10), [])
  const missing = createActivityLog({ filePath: path.join(dir, 'never-written.jsonl') })
  assert.deepEqual(missing.tail(10), [])
})

test('tail skips corrupt lines', () => {
  const { filePath, log } = setup()
  log.record({ action: 'read-file', decision: 'allowed', path: 'good' })
  fs.appendFileSync(filePath, 'not json\n')
  assert.deepEqual(log.tail(10).map(entry => entry.path), ['good'])
})
