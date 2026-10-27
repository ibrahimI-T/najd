const { test } = require('node:test')
const assert = require('node:assert/strict')
const { evaluateBudget } = require('../scripts/perf-budget.cjs')

const phase = (name, cpu, extra = {}) => ({ name, seconds: 120, cpuOneCorePercent: cpu, privateMB: { avg: 300, peak: 420 }, handles: { start: 1000, end: 1020, growthPercent: 2 }, threads: { start: 200, end: 204 }, ...extra })
const good = () => ({ valid: true, phases: [phase('idle-visible', 0.5), phase('idle-minimized', 0.1)] })

test('a valid run inside every limit passes', () => { assert.deepEqual(evaluateBudget(good()), []) })

test('violations of CPU, memory, handle or thread growth are reported', () => {
  const report = good()
  report.phases[0].cpuOneCorePercent = 1.0
  report.phases[1].cpuOneCorePercent = 0.31
  report.phases[0].privateMB.peak = 600
  report.phases[1].handles.growthPercent = 5.1
  report.phases[1].threads.end = 220
  const problems = evaluateBudget(report).map(line => line.split(':')[0])
  assert.deepEqual(problems.sort(), ['CPU', 'CPU', 'HANDLES', 'MEMORY', 'THREADS'])
})

test('a missing measurement, a short phase or an invalid run is a violation, never a pass', () => {
  assert.deepEqual(evaluateBudget(null), ['REPORT_MISSING'])
  assert.ok(evaluateBudget({ ...good(), valid: false }).some(line => line.startsWith('RUN_INVALID')))
  assert.ok(evaluateBudget({ valid: true, phases: [phase('idle-visible', 0.5)] }).some(line => line.startsWith('MISSING: idle-minimized')))
  const noMemory = good(); delete noMemory.phases[0].privateMB
  assert.ok(evaluateBudget(noMemory).some(line => line.startsWith('MISSING: idle-visible private memory')))
  const noHandles = good(); noHandles.phases[1].handles = null
  assert.ok(evaluateBudget(noHandles).some(line => line.startsWith('MISSING: idle-minimized handle')))
  const short = good(); short.phases[0].seconds = 30
  assert.ok(evaluateBudget(short).some(line => line.startsWith('SHORT')))
  const nan = good(); nan.phases[0].cpuOneCorePercent = NaN
  assert.ok(evaluateBudget(nan).some(line => line.startsWith('MISSING: idle-visible CPU')))
})
