const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createQuitWatchdog } = require('../electron/quit-watchdog.cjs')

test('the watchdog ends the process after the grace period unless the quit finished first', () => {
  const timers = []
  const fake = { setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer }, clearTimer: timer => { timer.cleared = true } }
  let kills = 0
  const dog = createQuitWatchdog({ graceMs: 1234, kill: () => kills++, ...fake })
  dog.start(); dog.start()
  assert.equal(timers.length, 1, 'arming twice keeps one timer'); assert.equal(timers[0].ms, 1234); assert.equal(dog.isArmed(), true)
  timers[0].fn()
  assert.equal(kills, 1); assert.equal(dog.isArmed(), false)
  dog.start(); dog.stop()
  assert.equal(timers[1].cleared, true); assert.equal(dog.isArmed(), false)
  assert.equal(kills, 1, 'a quit that finished in time kills nothing')
})

test('a failing kill never throws out of the timer', () => {
  const timers = []
  const dog = createQuitWatchdog({ kill: () => { throw new Error('x') }, setTimer: fn => { timers.push(fn); return {} }, clearTimer() {} })
  dog.start()
  assert.doesNotThrow(() => timers[0]())
})
