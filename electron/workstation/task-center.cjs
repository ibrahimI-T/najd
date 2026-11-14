// Task Center (spec 3.6): durable scheduled tasks. Schedules are once / every N minutes / five-field cron in an IANA time zone.
// Wall-clock times that do not exist on a DST change are skipped; a repeated hour runs once. After a restart an unfinished run is recorded
// INTERRUPTED and never replayed; a missed schedule runs once and is marked late. Effects still go through the core's approval policy.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { replaceFile } = require('../atomic-file.cjs')

const error = code => Object.assign(new Error(code), { code })
const MINUTE = 60000, MAX_AUTOMATIONS = 500, MAX_RUNS = 50, MAX_SEARCH_MINUTES = 366 * 24 * 60 * 2
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]

function parseField(text, [low, high]) {
  const values = new Set()
  for (const part of text.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!match) throw error('CRON_INVALID')
    const step = match[2] === undefined ? 1 : Number(match[2])
    let from = low, to = high
    if (match[1] !== '*') { const [a, b] = match[1].split('-').map(Number); from = a; to = b ?? (match[2] !== undefined ? high : a) }
    if (step < 1 || from < low || to > high || from > to) throw error('CRON_INVALID')
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return values
}
function parseCron(expression) {
  const fields = String(expression || '').trim().split(/\s+/)
  if (fields.length !== 5) throw error('CRON_INVALID')
  const [minute, hour, day, month, weekday] = fields.map((field, index) => parseField(field, RANGES[index]))
  if (weekday.has(7)) weekday.add(0)
  return { minute, hour, day, month, weekday, dayRestricted: fields[2] !== '*', weekdayRestricted: fields[4] !== '*' }
}
function validZone(timezone) { try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); return true } catch { return false } }
const zoneFormat = new Map()
function wallClock(time, timezone) {
  if (!zoneFormat.has(timezone)) zoneFormat.set(timezone, new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }))
  const parts = Object.fromEntries(zoneFormat.get(timezone).formatToParts(new Date(time)).map(part => [part.type, part.value]))
  return { minute: +parts.minute, hour: +parts.hour, day: +parts.day, month: +parts.month, year: +parts.year, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) }
}
const wallKey = clock => [clock.year, clock.month, clock.day, clock.hour, clock.minute].join('-')
function cronMatches(cron, clock) {
  if (!cron.minute.has(clock.minute) || !cron.hour.has(clock.hour) || !cron.month.has(clock.month)) return false
  const day = cron.day.has(clock.day), weekday = cron.weekday.has(clock.weekday)
  return cron.dayRestricted && cron.weekdayRestricted ? day || weekday : day && weekday // the usual cron rule when both are restricted
}
// The first matching minute strictly after `after`. A repeated wall-clock minute (the hour after clocks go back) is not a second run.
function nextCron(expression, timezone, after) {
  const cron = parseCron(expression)
  const previous = wallKey(wallClock(after, timezone))
  let time = Math.floor(after / MINUTE) * MINUTE + MINUTE
  for (let i = 0; i < MAX_SEARCH_MINUTES; i++, time += MINUTE) {
    const clock = wallClock(time, timezone)
    if (cronMatches(cron, clock) && wallKey(clock) !== previous) return time
  }
  return null
}
function nextRun(schedule, after) {
  if (schedule.kind === 'once') return Date.parse(schedule.at) > after ? Date.parse(schedule.at) : null
  if (schedule.kind === 'interval') return after + schedule.minutes * MINUTE
  return nextCron(schedule.cron, schedule.timezone, after)
}
function checkSchedule(schedule) {
  if (schedule?.kind === 'once' && Number.isFinite(Date.parse(schedule.at))) return { kind: 'once', at: new Date(schedule.at).toISOString() }
  if (schedule?.kind === 'interval' && Number.isSafeInteger(schedule.minutes) && schedule.minutes >= 1 && schedule.minutes <= 525600) return { kind: 'interval', minutes: schedule.minutes }
  if (schedule?.kind === 'cron' && validZone(schedule.timezone)) { parseCron(schedule.cron); return { kind: 'cron', cron: schedule.cron.trim(), timezone: schedule.timezone } }
  throw error('SCHEDULE_INVALID')
}

// `execute(automation, run)` starts the work and resolves to { state, output?, taskId?, conversationId? }.
function createTaskCenter({ directory, execute, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, tickMs = 15000, onChange = () => {} }) {
  if (!path.isAbsolute(directory || '') || typeof execute !== 'function') throw error('INVALID_INPUT')
  const filename = path.join(directory, 'task-center.json')
  let queue = Promise.resolve(), timer = null, stopped = true
  const running = new Map()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  async function load() {
    let raw
    try { raw = await fs.readFile(filename, 'utf8') } catch (reason) { if (reason.code === 'ENOENT') return { version: 1, automations: [] }; throw reason }
    try { const value = JSON.parse(raw); if (value?.version === 1 && Array.isArray(value.automations)) return value } catch {}
    await fs.rename(filename, filename + '.corrupt-' + Date.now()).catch(() => {})
    return { version: 1, automations: [] }
  }
  async function save(state) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(state, null, 1) + '\n', { flag: 'wx' })
    await replaceFile(temporary, filename)
  }
  const find = (state, id) => { const found = state.automations.find(item => item.id === id); if (!found) throw error('AUTOMATION_NOT_FOUND'); return found }
  const iso = time => time === null ? null : new Date(time).toISOString()
  const text = (value, limit) => { if (typeof value !== 'string' || !value.trim() || value.length > limit) throw error('INVALID_INPUT'); return value.trim() }
  function addRun(item, run) { item.runs = [run, ...(item.runs || [])].slice(0, MAX_RUNS) }

  async function finish(id, runId, result) {
    await serial(async () => {
      const state = await load(), item = state.automations.find(entry => entry.id === id)
      const run = item?.runs?.find(entry => entry.id === runId)
      if (!run) return
      Object.assign(run, { state: result.state, finishedAt: new Date(now()).toISOString(), ...(result.output ? { output: String(result.output).slice(0, 4000) } : {}), ...(result.taskId ? { taskId: result.taskId } : {}), ...(result.conversationId ? { conversationId: result.conversationId } : {}), ...(result.code ? { code: result.code } : {}) })
      await save(state)
    })
    running.delete(runId); onChange()
  }
  function launch(item, run) {
    running.set(run.id, true)
    Promise.resolve().then(() => execute(item, run)).then(result => finish(item.id, run.id, result || { state: 'FAILED' }), reason => finish(item.id, run.id, { state: 'FAILED', code: reason?.code || 'FAILED' })).catch(() => {})
  }
  async function tick() {
    const due = await serial(async () => {
      const state = await load(), time = now(), list = []
      for (const item of state.automations) {
        if (item.status !== 'active' || !item.nextRunAt || Date.parse(item.nextRunAt) > time) continue
        if (item.runs?.[0]?.state === 'RUNNING') continue // one at a time for each task
        const late = time - Date.parse(item.nextRunAt) > 2 * MINUTE
        const run = { id: randomUUID(), state: 'RUNNING', trigger: 'schedule', late, startedAt: new Date(time).toISOString() }
        addRun(item, run); item.lastRunAt = run.startedAt
        item.nextRunAt = iso(nextRun(item.schedule, time))
        if (item.nextRunAt === null) item.status = 'completed'
        list.push([{ ...item, runs: undefined }, run])
      }
      if (list.length) await save(state)
      return list
    })
    for (const [item, run] of due) launch(item, run)
    if (due.length) onChange()
  }
  function arm() { if (!stopped) timer = setTimer(() => { void tick().catch(() => {}).finally(arm) }, tickMs) }

  return {
    // After a restart: runs that never finished are recorded, not repeated (their effects are unknown).
    start: () => serial(async () => {
      const state = await load(); let changed = false
      for (const item of state.automations) for (const run of item.runs || []) if (run.state === 'RUNNING' && !running.has(run.id)) { run.state = 'INTERRUPTED'; run.finishedAt = new Date(now()).toISOString(); changed = true }
      if (changed) await save(state)
      stopped = false; arm()
    }),
    stop: () => { stopped = true; if (timer) clearTimer(timer); timer = null },
    tick,
    list: () => serial(async () => (await load()).automations.filter(item => item.status !== 'deleted')),
    create: input => serial(async () => {
      const state = await load()
      if (state.automations.length >= MAX_AUTOMATIONS) throw error('AUTOMATION_LIMIT')
      const schedule = checkSchedule(input?.schedule)
      const next = nextRun(schedule, now())
      if (next === null) throw error('SCHEDULE_INVALID')
      const item = { id: randomUUID(), title: text(input.title, 120), prompt: text(input.prompt, 8000), schedule, status: 'active', nextRunAt: iso(next), lastRunAt: null, delivery: input.delivery === 'notification' ? 'notification' : 'conversation', provider: typeof input.provider === 'string' ? input.provider : null, model: typeof input.model === 'string' ? input.model : null, conversationId: typeof input.conversationId === 'string' ? input.conversationId : null, createdAt: new Date(now()).toISOString(), runs: [] }
      state.automations.push(item); await save(state); onChange(); return item
    }),
    update: (id, patch) => serial(async () => {
      const state = await load(), item = find(state, id)
      if (patch.title !== undefined) item.title = text(patch.title, 120)
      if (patch.prompt !== undefined) item.prompt = text(patch.prompt, 8000)
      if (patch.schedule !== undefined) { item.schedule = checkSchedule(patch.schedule); item.nextRunAt = iso(nextRun(item.schedule, now())) }
      await save(state); onChange(); return item
    }),
    setStatus: (id, status) => serial(async () => {
      if (!['active', 'paused', 'archived'].includes(status)) throw error('INVALID_INPUT')
      const state = await load(), item = find(state, id)
      item.status = status
      if (status === 'active') { item.nextRunAt = iso(nextRun(item.schedule, now())); if (item.nextRunAt === null) item.status = 'completed' }
      await save(state); onChange(); return item
    }),
    remove: id => serial(async () => { const state = await load(); find(state, id); state.automations = state.automations.filter(item => item.id !== id); await save(state); onChange(); return true }),
    runNow: id => serial(async () => {
      const state = await load(), item = find(state, id)
      if (item.runs?.[0]?.state === 'RUNNING') throw error('AUTOMATION_RUNNING')
      const run = { id: randomUUID(), state: 'RUNNING', trigger: 'manual', late: false, startedAt: new Date(now()).toISOString() }
      addRun(item, run); item.lastRunAt = run.startedAt; await save(state)
      launch({ ...item, runs: undefined }, run); onChange(); return run
    })
  }
}

module.exports = { createTaskCenter, nextCron, parseCron, checkSchedule }
