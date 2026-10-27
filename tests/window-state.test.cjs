const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createWindowState, restore } = require('../electron/window-state.cjs')

const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }]

test('a saved window opens where it was, maximized when it was', () => {
  assert.deepEqual(restore({ x: 100, y: 50, width: 1400, height: 900, maximized: true }, screen), { x: 100, y: 50, width: 1400, height: 900, maximized: true })
})

test('nothing saved, a damaged value or a place on a removed monitor opens at the default size', () => {
  assert.deepEqual(restore(null, screen), { width: 1280, height: 820, maximized: false })
  assert.deepEqual(restore({ x: 'a', y: 0, width: 900, height: 700 }, screen), { width: 1280, height: 820, maximized: false })
  assert.deepEqual(restore({ x: 0, y: 0, width: 200, height: 100 }, screen), { width: 1280, height: 820, maximized: false }, 'below the minimum size')
  assert.deepEqual(restore({ x: 3000, y: 100, width: 1200, height: 800, maximized: true }, screen), { width: 1280, height: 820, maximized: true }, 'off every screen')
})

test('the state is read from its file and a damaged file is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-window-'))
  const filePath = path.join(dir, 'window-state.json')
  fs.writeFileSync(filePath, JSON.stringify({ x: 10, y: 10, width: 1000, height: 700, maximized: false }))
  assert.equal(createWindowState({ filePath }).restore(screen).width, 1000)
  fs.writeFileSync(filePath, '{broken')
  assert.equal(createWindowState({ filePath }).restore(screen).width, 1280)
  fs.rmSync(dir, { recursive: true, force: true })
})
