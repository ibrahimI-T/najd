const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPermissionPolicy } = require('../electron/permissions.cjs')

const app = { id: 'app' }, other = { id: 'preview' }
const policy = createPermissionPolicy({ isAppWindow: contents => contents === app })
const ask = (contents, permission, details) => new Promise(resolve => policy.request(contents, permission, resolve, details))
const page = 'file:///C:/Program%20Files/NAJD/resources/app.asar/dist/index.html'

test('NAJD\'s own page may copy and go full screen; nothing else, and never from a frame or another window (Phase 14)', async () => {
  assert.equal(await ask(app, 'clipboard-sanitized-write', { requestingUrl: page, isMainFrame: true }), true)
  assert.equal(await ask(app, 'fullscreen', { requestingUrl: page, isMainFrame: true }), true)
  for (const permission of ['media', 'geolocation', 'notifications', 'midi', 'clipboard-read', 'openExternal', 'hid', 'serial'])
    assert.equal(await ask(app, permission, { requestingUrl: page, isMainFrame: true }), false, permission)
  assert.equal(await ask(app, 'clipboard-sanitized-write', { requestingUrl: 'about:srcdoc', isMainFrame: false }), false, 'a page run inside a code block')
  assert.equal(await ask(other, 'clipboard-sanitized-write', { requestingUrl: page, isMainFrame: true }), false, 'another window')
  assert.equal(await ask(app, 'clipboard-sanitized-write', { requestingUrl: 'https://example.com/', isMainFrame: true }), false, 'a web address')
  assert.equal(policy.check(app, 'media', page, { requestingUrl: page, isMainFrame: true }), false)
  assert.equal(policy.check(app, 'clipboard-sanitized-write', page, { isMainFrame: true }), true)
})

test('voice input: the microphone only, for NAJD\'s own page and main frame; any request with video is refused (R-080)', async () => {
  assert.equal(await ask(app, 'media', { requestingUrl: page, isMainFrame: true, mediaTypes: ['audio'] }), true)
  assert.equal(await ask(app, 'media', { requestingUrl: page, isMainFrame: true, mediaTypes: ['video'] }), false)
  assert.equal(await ask(app, 'media', { requestingUrl: page, isMainFrame: true, mediaTypes: ['audio', 'video'] }), false)
  assert.equal(await ask(app, 'media', { requestingUrl: page, isMainFrame: false, mediaTypes: ['audio'] }), false)
  assert.equal(await ask(other, 'media', { requestingUrl: page, isMainFrame: true, mediaTypes: ['audio'] }), false)
  assert.equal(await ask(app, 'media', { requestingUrl: 'https://example.com/', isMainFrame: true, mediaTypes: ['audio'] }), false)
  assert.equal(policy.check(app, 'media', 'file://', { requestingUrl: page, isMainFrame: true, mediaType: 'audio' }), true)
  assert.equal(policy.check(app, 'media', 'file://', { requestingUrl: page, isMainFrame: true, mediaType: 'video' }), false)
})
