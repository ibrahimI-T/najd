import { describe, expect, it } from 'vitest'
import { activityKind, buildActivity, formatDuration, groupTitle, summarize } from './activity'

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 21, 10, 0, seconds)).toISOString()
const make = (events: NajdTaskActivity['events'], finishedAt: string | null = null): NajdTaskActivity => ({ version: 1, startedAt: at(0), finishedAt, events })

describe('activity view model', () => {
  it('pairs tool starts with their results and measures durations', () => {
    const view = buildActivity(make([
      { type: 'task.started', time: at(0) },
      { type: 'tool.started', time: at(1), tool: 'najd-terminal-run', detail: 'git status' },
      { type: 'tool.completed', time: at(4), tool: 'najd-terminal-run', detail: 'completed (exit 0)' },
      { type: 'task.completed', time: at(5) }
    ], at(5)))
    const command = view.events.find(event => event.tool === 'najd-terminal-run')!
    expect(command.kind).toBe('git')
    expect(command.status).toBe('succeeded')
    expect(command.durationMs).toBe(3000)
    expect(command.exitCode).toBe(0)
    expect(view.running).toBe(false)
  })

  it('marks non-zero exit codes and failed tools as failures with their error text', () => {
    const view = buildActivity(make([
      { type: 'tool.started', time: at(1), tool: 'najd-python-run', detail: 'print(1)' },
      { type: 'tool.completed', time: at(2), tool: 'najd-python-run', detail: 'completed (exit 2)' },
      { type: 'tool.started', time: at(3), tool: 'najd-files-read', detail: 'a.txt' },
      { type: 'tool.failed', time: at(3), tool: 'najd-files-read', detail: 'error: NOT_FOUND' }
    ]))
    expect(view.events[0].status).toBe('failed')
    expect(view.events[0].exitCode).toBe(2)
    expect(view.events[1].error).toBe('NOT_FOUND')
    expect(view.counts.errors).toBe(2)
  })

  it('keeps unfinished work running while the task runs and cancels it when the task ends', () => {
    const events: NajdTaskActivity['events'] = [{ type: 'tool.started', time: at(1), tool: 'najd-web-search', detail: 'news' }]
    const live = buildActivity(make(events), Date.UTC(2026, 9, 21, 10, 0, 6))
    expect(live.running).toBe(true)
    expect(live.events[0].status).toBe('running')
    expect(live.events[0].durationMs).toBe(5000)
    const ended = buildActivity(make([...events, { type: 'task.cancelled', time: at(3) }], at(3)))
    expect(ended.events[0].status).toBe('cancelled')
    expect(ended.running).toBe(false)
  })

  it('shows approvals where they happen and records the decision', () => {
    const view = buildActivity(make([
      { type: 'approval.requested', time: at(2), tool: 'najd-files-write' },
    ]))
    expect(view.waiting).toBe(true)
    expect(view.events[0].needsApproval).toBe(true)
    const decided = buildActivity(make([
      { type: 'approval.requested', time: at(2), tool: 'najd-files-write' },
      { type: 'approval.resolved', time: at(5), decision: 'DENY' }
    ]))
    expect(decided.events[0].status).toBe('cancelled')
    expect(decided.events[0].durationMs).toBe(3000)
  })

  it('groups consecutive finished reads and counts only real events', () => {
    const reads = [1, 2, 3, 4, 5, 6].flatMap(n => [
      { type: 'tool.started', time: at(n), tool: 'najd-files-read', detail: `f${n}.txt` },
      { type: 'tool.completed', time: at(n), tool: 'najd-files-read', detail: '12 characters' }
    ]) as NajdTaskActivity['events']
    const view = buildActivity(make(reads))
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].type).toBe('group')
    expect(view.counts.filesRead).toBe(6)
    expect(summarize(view.counts, 'en')).toBe('6 tools used · 6 files read')
    expect(groupTitle('file-read', 6, 'ar')).toBe('قراءة 6 ملفات')
  })

  it('nests delegated sub-agent steps under the delegate call and shows reasoning summaries', () => {
    const view = buildActivity(make([
      { type: 'reasoning.summary', time: at(0), tool: 'najd-plan', detail: 'Profile general (default)' },
      { type: 'tool.started', time: at(1), tool: 'najd-delegate', detail: 'look up' },
      { type: 'tool.started', time: at(2), tool: 'najd-web-search', detail: '↳ topic' },
      { type: 'tool.completed', time: at(3), tool: 'najd-web-search', detail: '↳ ' },
      { type: 'tool.completed', time: at(4), tool: 'najd-delegate', detail: 'completed' }
    ]))
    expect(view.events[0].kind).toBe('reasoning')
    expect(view.events[1].children).toHaveLength(1)
    expect(view.counts.searches).toBe(0)
  })

  it('classifies tools and formats durations in both languages', () => {
    expect(activityKind('najd-mcp-call', '')).toBe('mcp')
    expect(activityKind('najd-files-edit', '')).toBe('file-write')
    expect(activityKind(undefined, '')).toBe('tool')
    expect(formatDuration(72_000, 'ar')).toBe('1 دقيقة و12 ثانية')
    expect(formatDuration(28_000, 'en')).toBe('28 s')
  })

  it('handles old saved records without new fields', () => {
    expect(buildActivity(undefined).rows).toEqual([])
    const view = buildActivity(make([{ type: 'task.started', time: at(0) }, { type: 'task.completed', time: at(1) }], at(1)))
    expect(view.events).toHaveLength(1)
  })
})

import { deriveContext, deriveProgress } from './activity'
describe('progress and used context', () => {
  const events: NajdTaskActivity['events'] = [
    { type: 'task.started', time: at(0), skill: 'najd-read-document' },
    { type: 'reasoning.summary', time: at(1), tool: 'najd-plan', detail: 'plan' },
    { type: 'tool.started', time: at(2), tool: 'najd-files-read', detail: 'C:/a.txt' },
    { type: 'tool.completed', time: at(3), tool: 'najd-files-read', detail: '5 characters' },
    { type: 'tool.started', time: at(4), tool: 'najd-files-write', detail: 'C:/b.txt' },
    { type: 'tool.completed', time: at(5), tool: 'najd-files-write', detail: 'written C:/b.txt' },
    { type: 'tool.started', time: at(6), tool: 'najd-web-extract', detail: 'https://example.com' }
  ]
  it('reports real stage counts and no percentage while a tool is running', () => {
    const activity = make(events)
    const stages = deriveProgress(buildActivity(activity, Date.UTC(2026, 9, 21, 10, 0, 9)), activity)
    expect(stages.map(stage => stage.id)).toEqual(['understand', 'plan', 'work', 'answer'])
    expect(stages.find(stage => stage.id === 'work')).toMatchObject({ state: 'active', done: 2, total: 3 })
    expect(stages.at(-1)!.state).toBe('pending')
    expect(JSON.stringify(stages)).not.toMatch(/percent/i)
  })
  it('shows a waiting stage for a pending approval and failure when the task failed', () => {
    const waiting = make([...events.slice(0, 2), { type: 'approval.requested', time: at(3), tool: 'najd-files-write' }])
    expect(deriveProgress(buildActivity(waiting), waiting).map(stage => stage.state)).toEqual(['done', 'done', 'paused', 'waiting', 'pending'])
    const failed = make([...events.slice(0, 4), { type: 'task.failed', time: at(5), detail: 'PROVIDER_TIMEOUT' }], at(5))
    expect(deriveProgress(buildActivity(failed), failed).at(-1)!.state).toBe('failed')
  })
  it('lists files, pages, skills and tools that were actually used', () => {
    // The page read has finished here; a step still running does not count as used yet.
    const used = deriveContext(buildActivity(make([...events, { type: 'tool.completed', time: at(7), tool: 'najd-web-extract', detail: '900 characters' }])))
    expect(used.filesRead).toEqual(['C:/a.txt'])
    expect(used.filesChanged).toEqual(['C:/b.txt'])
    expect(used.pages).toEqual(['https://example.com'])
    expect(used.skills).toEqual([]) // the selected skill counts once the task has finished successfully
    expect(used.tools).toEqual(['najd-files-read', 'najd-files-write', 'najd-web-extract'])
  })
})

describe('stable ids and truncated windows', () => {
  it('keys events by their sequence so dropping older events does not shift ids', () => {
    const full = buildActivity(make([
      { seq: 1, type: 'task.started', time: at(0) },
      { seq: 2, type: 'tool.started', time: at(1), tool: 'najd-files-read', detail: 'a' },
      { seq: 3, type: 'tool.completed', time: at(2), tool: 'najd-files-read', detail: 'ok' },
      { seq: 4, type: 'tool.started', time: at(3), tool: 'najd-terminal-run', detail: 'dir' }
    ]))
    const cut = buildActivity(make([
      { seq: 3, type: 'tool.completed', time: at(2), tool: 'najd-files-read', detail: 'ok' },
      { seq: 4, type: 'tool.started', time: at(3), tool: 'najd-terminal-run', detail: 'dir' }
    ]))
    expect(full.events.find(event => event.tool === 'najd-terminal-run')!.id).toBe('e4')
    expect(cut.events.find(event => event.tool === 'najd-terminal-run')!.id).toBe('e4')
  })
  it('counts a finished step whose start was cut from the saved window', () => {
    const view = buildActivity(make([{ seq: 9, type: 'tool.failed', time: at(2), tool: 'najd-python-run', detail: 'error: BOOM' }]))
    expect(view.counts.tools).toBe(1)
    expect(view.counts.errors).toBe(1)
  })
})

describe('round 2 corrections', () => {
  it('keeps failed attempts, orphans and unknown targets out of the used context, and omits Plan without a plan event', () => {
    const activity = make([
      { seq: 1, type: 'tool.started', time: at(1), tool: 'najd-files-read', detail: 'missing.txt' },
      { seq: 2, type: 'tool.failed', time: at(2), tool: 'najd-files-read', detail: 'error: NOT_FOUND' },
      { seq: 3, type: 'tool.completed', time: at(3), tool: 'najd-files-read', detail: '12 characters' }
    ], at(4))
    const view = buildActivity(activity)
    expect(deriveContext(view).filesRead).toEqual([])
    expect(deriveProgress(view, activity).map(stage => stage.id)).toEqual(['understand', 'work', 'answer'])
  })
})

describe('round 3 corrections', () => {
  it('closes a pending approval when the task is cancelled and fails the approval stage', () => {
    const activity = make([
      { seq: 1, type: 'reasoning.summary', time: at(0), tool: 'najd-plan', detail: 'plan' },
      { seq: 2, type: 'approval.requested', time: at(1), tool: 'najd-files-write' },
      { seq: 3, type: 'task.cancelled', time: at(4) }
    ], at(4))
    const view = buildActivity(activity)
    const approval = view.events.find(event => event.kind === 'approval')!
    expect(approval.status).toBe('cancelled')
    expect(approval.durationMs).toBe(3000)
    expect(deriveProgress(view, activity).find(stage => stage.id === 'approval')).toMatchObject({ state: 'failed', done: 0, total: 1 })
  })
  it('lists a tool as used once it was attempted, but only successful steps as files', () => {
    const view = buildActivity(make([
      { seq: 1, type: 'tool.started', time: at(1), tool: 'najd-files-read', detail: 'x.txt' },
      { seq: 2, type: 'tool.failed', time: at(2), tool: 'najd-files-read', detail: 'error: NOT_FOUND' }
    ], at(3)))
    const used = deriveContext(view)
    expect(used.tools).toEqual(['najd-files-read'])
    expect(used.filesRead).toEqual([])
  })
})

describe('round 4 corrections', () => {
  it('keeps an unconfirmed outcome distinct from a failure', () => {
    const view = buildActivity(make([{ seq: 1, type: 'task.started', time: at(0) }, { seq: 2, type: 'task.unknown_effect', time: at(2) }], at(2)))
    expect(view.unknownEffect).toBe(true)
    expect(view.failed).toBe(false)
  })
  it('always has a current stage while the task runs', () => {
    for (const events of [
      [{ seq: 1, type: 'task.started', time: at(0) }],
      [{ seq: 1, type: 'task.started', time: at(0) }, { seq: 2, type: 'reasoning.summary', time: at(1), tool: 'najd-plan', detail: 'p' }]
    ] as NajdTaskActivity['events'][]) {
      const activity = make(events)
      const stages = deriveProgress(buildActivity(activity), activity)
      expect(stages.some(stage => stage.state === 'active'), JSON.stringify(stages)).toBe(true)
    }
  })
})

describe('round 5 corrections', () => {
  it('follows the task outcome for a selected skill and counts loaded skill guides only when they succeeded', () => {
    const ok = buildActivity(make([{ seq: 1, type: 'task.started', time: at(0), skill: 'najd-read-document' }, { seq: 2, type: 'task.completed', time: at(2) }], at(2)))
    expect(deriveContext(ok).skills).toEqual(['najd-read-document'])
    const failed = buildActivity(make([{ seq: 1, type: 'task.started', time: at(0), skill: 'najd-read-document' }, { seq: 2, type: 'task.failed', time: at(2), detail: 'X' }], at(2)))
    expect(failed.events[0].status).toBe('failed')
    expect(deriveContext(failed).skills).toEqual([])
    const read = buildActivity(make([
      { seq: 1, type: 'tool.started', time: at(1), tool: 'najd-skills-read', detail: 'writer' }, { seq: 2, type: 'tool.completed', time: at(2), tool: 'najd-skills-read', detail: '' },
      { seq: 3, type: 'tool.started', time: at(3), tool: 'najd-skills-read', detail: 'broken' }, { seq: 4, type: 'tool.failed', time: at(4), tool: 'najd-skills-read', detail: 'error: NOT_FOUND' }
    ], at(5)))
    expect(deriveContext(read).skills).toEqual(['writer'])
  })
})

describe('round 6 corrections', () => {
  it('classifies orphan completions by exit code and counts only finished effects', () => {
    const view = buildActivity(make([
      { seq: 5, type: 'tool.completed', time: at(1), tool: 'najd-terminal-run', detail: 'completed (exit 2)' },
      { seq: 6, type: 'tool.started', time: at(2), tool: 'najd-files-write', detail: 'a.txt' },
      { seq: 7, type: 'tool.failed', time: at(3), tool: 'najd-files-write', detail: 'error: DENIED' },
      { seq: 8, type: 'tool.started', time: at(4), tool: 'najd-files-read', detail: 'b.txt' }
    ]))
    expect(view.events[0]).toMatchObject({ status: 'failed', exitCode: 2 })
    expect(view.counts).toMatchObject({ errors: 2, filesChanged: 0, filesRead: 0, tools: 3, commands: 1 })
    expect(summarize(view.counts, 'en')).not.toMatch(/file/)
  })
  it('counts only succeeded tools as done in the work stage', () => {
    const activity = make([{ seq: 1, type: 'reasoning.summary', time: at(0), tool: 'najd-plan', detail: 'p' }, { seq: 2, type: 'tool.started', time: at(1), tool: 'najd-files-read', detail: 'x' },
      { seq: 3, type: 'tool.failed', time: at(2), tool: 'najd-files-read', detail: 'error: X' }], at(3))
    expect(deriveProgress(buildActivity(activity), activity).find(stage => stage.id === 'work')).toMatchObject({ done: 0, total: 1 })
  })
})

describe('round 7 corrections', () => {
  it('gives a selected skill the same outcome as its cancelled task', () => {
    const view = buildActivity(make([{ seq: 1, type: 'task.started', time: at(0), skill: 'najd-read-document' }, { seq: 2, type: 'tool.started', time: at(1), tool: 'najd-files-read', detail: 'a' },
      { seq: 3, type: 'task.cancelled', time: at(2) }], at(2)))
    expect(view.events.find(event => event.kind === 'skill')!.status).toBe('cancelled')
    expect(view.events.find(event => event.tool === 'najd-files-read')!.status).toBe('cancelled')
  })
})

describe('round 8 corrections', () => {
  it('shows an unconfirmed outcome as a warning, not an error, and does not count it as one', () => {
    const view = buildActivity(make([{ seq: 1, type: 'task.started', time: at(0) }, { seq: 2, type: 'task.unknown_effect', time: at(2) }], at(2)))
    expect(view.events[0]).toMatchObject({ kind: 'warning', status: 'unconfirmed' })
    expect(view.counts.errors).toBe(0)
    expect(view.unknownEffect).toBe(true)
  })
  it('reports failed attempts next to the done count when a task completes after a failed tool', () => {
    const activity = make([{ seq: 1, type: 'tool.started', time: at(1), tool: 'najd-files-read', detail: 'x' }, { seq: 2, type: 'tool.failed', time: at(2), tool: 'najd-files-read', detail: 'error: X' },
      { seq: 3, type: 'task.completed', time: at(3) }], at(3))
    expect(deriveProgress(buildActivity(activity), activity).find(stage => stage.id === 'work')).toMatchObject({ state: 'done', done: 0, total: 1, failed: 1 })
  })
})

describe('round 9 corrections', () => {
  it('keeps exactly one current stage while an approval waits, and an unconfirmed task leaves its skill unconfirmed', () => {
    const waiting = make([{ seq: 1, type: 'reasoning.summary', time: at(0), tool: 'najd-plan', detail: 'p' }, { seq: 2, type: 'tool.started', time: at(1), tool: 'najd-files-write', detail: 'a' },
      { seq: 3, type: 'approval.requested', time: at(2), tool: 'najd-files-write' }])
    const stages = deriveProgress(buildActivity(waiting), waiting)
    expect(stages.filter(stage => stage.state === 'active' || stage.state === 'waiting')).toHaveLength(1)
    expect(stages.find(stage => stage.id === 'work')!.state).toBe('paused')
    const unknown = buildActivity(make([{ seq: 1, type: 'task.started', time: at(0), skill: 'najd-read-document' }, { seq: 2, type: 'task.unknown_effect', time: at(2) }], at(2)))
    expect(unknown.events.find(event => event.kind === 'skill')!.status).toBe('unconfirmed')
  })
})

describe('round 11 corrections', () => {
  it('shows an unconfirmed outcome as unconfirmed stages, not failed ones', () => {
    const activity = make([{ seq: 1, type: 'reasoning.summary', time: at(0), tool: 'najd-plan', detail: 'p' }, { seq: 2, type: 'tool.started', time: at(1), tool: 'najd-files-write', detail: 'a' },
      { seq: 3, type: 'task.unknown_effect', time: at(3) }], at(3))
    const stages = deriveProgress(buildActivity(activity), activity)
    expect(stages.at(-1)!.state).toBe('unconfirmed')
    expect(stages.some(stage => stage.state === 'failed')).toBe(false)
  })
})

describe('round 15 corrections', () => {
  it('shows declined, unverified and negative outcomes without counting them as written or successful', () => {
    const view = buildActivity(make([
      { seq: 1, type: 'tool.started', time: at(1), tool: 'najd-files-write', detail: 'a.txt' }, { seq: 2, type: 'tool.failed', time: at(2), tool: 'najd-files-write', detail: 'declined: denied_by_user' },
      { seq: 3, type: 'tool.started', time: at(3), tool: 'najd-desktop-act', detail: 'invoke' }, { seq: 4, type: 'tool.failed', time: at(4), tool: 'najd-desktop-act', detail: 'effect unknown: unverified' },
      { seq: 5, type: 'tool.started', time: at(5), tool: 'najd-files-read', detail: 'b.txt' }, { seq: 6, type: 'tool.failed', time: at(6), tool: 'najd-files-read', detail: 'unsuccessful: not_found' }
    ], at(7)))
    expect(view.events.map(event => event.status)).toEqual(['cancelled', 'unconfirmed', 'failed'])
    expect(view.counts).toMatchObject({ filesChanged: 0, filesRead: 0, errors: 1 })
    expect(view.unknownEffect).toBe(true)
    expect(deriveContext(view).filesChanged).toEqual([])
  })
})

describe('round 21 counters', () => {
  it('counts files read only for operations that read a file, not for listings or reviews', () => {
    const view = buildActivity(make([
      { seq: 1, type: 'tool.started', time: at(1), tool: 'najd-files-list', detail: '.' }, { seq: 2, type: 'tool.completed', time: at(2), tool: 'najd-files-list', detail: '3 entries' },
      { seq: 3, type: 'tool.started', time: at(3), tool: 'najd-files-read', detail: 'a.txt' }, { seq: 4, type: 'tool.completed', time: at(4), tool: 'najd-files-read', detail: '12 characters' }
    ], at(5)))
    expect(view.counts.filesRead).toBe(1)
    expect(deriveContext(view).filesRead).toEqual(['a.txt'])
  })
})

describe('round 22 page counters', () => {
  it('counts a page only when its target is known: one open and two scrolls is one page', () => {
    const view = buildActivity(make([
      { seq: 1, type: 'tool.started', time: at(1), tool: 'najd-browser', detail: 'open · https://example.com' }, { seq: 2, type: 'tool.completed', time: at(2), tool: 'najd-browser', detail: '' },
      { seq: 3, type: 'tool.started', time: at(3), tool: 'najd-browser', detail: 'scroll · down' }, { seq: 4, type: 'tool.completed', time: at(4), tool: 'najd-browser', detail: '' },
      { seq: 5, type: 'tool.started', time: at(5), tool: 'najd-browser', detail: 'click · e1' }, { seq: 6, type: 'tool.completed', time: at(6), tool: 'najd-browser', detail: '' },
      { seq: 7, type: 'tool.started', time: at(7), tool: 'najd-web-preview', detail: 'https://preview.example' }, { seq: 8, type: 'tool.completed', time: at(8), tool: 'najd-web-preview', detail: 'captured' }
    ], at(9)))
    expect(view.counts.pages).toBe(2)
    expect(deriveContext(view).pages).toEqual(['https://example.com', 'https://preview.example'])
  })
})

describe('round 23 corrections', () => {
  it('closes a pending approval when the task ends as an unknown effect and fails the approval stage', () => {
    const activity = make([
      { seq: 1, type: 'reasoning.summary', time: at(0), tool: 'najd-plan', detail: 'p' },
      { seq: 2, type: 'approval.requested', time: at(1), tool: 'najd-files-write' },
      { seq: 3, type: 'task.unknown_effect', time: at(3) }
    ], at(3))
    const view = buildActivity(activity)
    expect(view.events.find(event => event.kind === 'approval')).toMatchObject({ status: 'cancelled', durationMs: 2000 })
    expect(deriveProgress(view, activity).find(stage => stage.id === 'approval')).toMatchObject({ done: 0, total: 1 })
  })
})

describe('round 25 command counter', () => {
  it('counts only dispatched commands, not declined ones or process inspection', () => {
    const view = buildActivity(make([
      { seq: 1, type: 'tool.started', time: at(1), tool: 'najd-terminal-run', detail: 'dir' }, { seq: 2, type: 'tool.failed', time: at(2), tool: 'najd-terminal-run', detail: 'declined: denied_by_user' },
      { seq: 3, type: 'tool.started', time: at(3), tool: 'najd-process-list', detail: '' }, { seq: 4, type: 'tool.completed', time: at(4), tool: 'najd-process-list', detail: '' },
      { seq: 5, type: 'tool.started', time: at(5), tool: 'najd-terminal-run', detail: 'echo hi' }, { seq: 6, type: 'tool.completed', time: at(6), tool: 'najd-terminal-run', detail: 'completed (exit 0)' }
    ], at(7)))
    expect(view.counts.commands).toBe(1)
  })
})

describe('the model thinking and union advice', () => {
  it('are notes, not steps: shown with their text, timed, and never counted as tools', () => {
    const activity = make([{ seq: 1, type: 'reasoning.summary', time: at(0), tool: 'najd-plan', detail: 'p' },
      { seq: 2, type: 'reasoning.text', time: at(1), tool: 'najd-union', detail: 'chatgpt/gpt-5.6-luna\nCheck the file first.\nThen write.' },
      { seq: 3, type: 'reasoning.text', time: at(5), tool: 'najd-thinking', detail: 'The user wants a page.\nI will write it.' }])
    const view = buildActivity(activity, Date.parse(at(6)))
    const advice = view.events.find(event => event.kind === 'advice')!
    expect(advice.model).toBe('chatgpt/gpt-5.6-luna')
    expect(advice.summary).toBe('Check the file first.\nThen write.')
    const thinking = view.events.find(event => event.kind === 'thinking')!
    expect(thinking.summary).toContain('\nI will write it.')
    expect(thinking.durationMs).toBe(4000)
    expect(view.counts.tools).toBe(0)
    expect(deriveContext(view).tools).toEqual([])
  })
})