import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessage } from './ChatMessage'
import { nearBottom } from './useChatScroll'
import { TaskActivity } from './TaskActivity'

it('renders branded assistant markdown, lists, tables and fenced code', () => {
  const html = renderToStaticMarkup(<ChatMessage language="en" message={{role:'assistant', createdAt:'', text:'**Hello**\n\n- one\n- two\n\n```html\n<script>alert(1)</script>\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |'}} />)
  expect(html).toContain('NAJD')
  expect(html).toContain('<strong>Hello</strong>')
  expect(html).toContain('<ul>')
  expect(html).toContain('<table>')
  expect(html).toContain('code-block')
  // Highlighted, escaped source: the tag name is wrapped in a token span and never becomes a live tag.
  expect(html).toMatch(/&lt;<span class="hljs-name">script<\/span>&gt;/)
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<script>')
})
it('places activity above and outside the assistant response', () => {
  const html=renderToStaticMarkup(<ChatMessage language="en" message={{role:'assistant',createdAt:'',text:'Response body'}} activity={<details className="task-activity"><summary>Worked</summary></details>} />)
  expect(html.indexOf('task-activity')).toBeLessThan(html.indexOf('<article'))
  expect(html.slice(html.indexOf('<article'))).not.toContain('task-activity')
})
it('keeps user text literal and rejects active HTML, images and script links', () => {
  const user = renderToStaticMarkup(<ChatMessage language="ar" message={{role:'user',createdAt:'',text:'**literal**'}} />)
  expect(user).toContain('**literal**')
  const html = renderToStaticMarkup(<ChatMessage language="en" message={{role:'assistant',createdAt:'',text:'<script>alert(1)</script>\n\n![remote](https://example.com/track.png)\n\n[bad](javascript:alert(1))'}} />)
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('javascript:')
})
it('follows near the bottom but lets the reader inspect older messages', () => {
  expect(nearBottom({scrollHeight:1000,clientHeight:400,scrollTop:590})).toBe(true)
  expect(nearBottom({scrollHeight:1000,clientHeight:400,scrollTop:100})).toBe(false)
})
it('shows only recorded task events, expanded while the task runs, with no reasoning leak', () => {
  const activity = {version:1 as const,startedAt:'2026-10-21T10:00:00.000Z',finishedAt:null,events:[
    {type:'task.started',time:'2026-10-21T10:00:00.000Z'},
    {type:'reasoning.summary',time:'2026-10-21T10:00:01.000Z',tool:'najd-plan',detail:'Profile general (default) · tools: core'},
    {type:'tool.started',time:'2026-10-21T10:00:02.000Z',tool:'najd-files-read',detail:'C:\work\a.txt'},
    {type:'approval.requested',time:'2026-10-21T10:00:03.000Z',tool:'najd-files-write'}]}
  const html = renderToStaticMarkup(<TaskActivity language="en" onStop={() => {}} run={{key:'fixture',sessionId:null,afterIndex:1,startedAt:Date.parse('2026-10-21T10:00:00.000Z'),activity,steps:[{state:'WAITING_APPROVAL',proposedTool:'najd-files-write',reasoningEffort:'high'}]}} />)
  expect(html).toContain('Waiting for your approval')
  expect(html).not.toContain('NAJD plan')
  expect(html).toContain('Read file')
  expect(html).toContain('Stop task')
  expect(html).toContain('aria-expanded="true"')
  expect(html).not.toContain('private model reasoning')
})
it('renders ordinary response duration without a timeline when no tool ran', () => {
  const html=renderToStaticMarkup(<TaskActivity language="ar" run={{key:'plain',sessionId:null,afterIndex:1,startedAt:1000,finishedAt:77000,steps:[{state:'COMPLETED',proposedTool:null,reasoningEffort:'high'}]}} />)
  expect(html).toContain('اشتغل 1 د 16 ث')
  expect(html).not.toContain('<details')
  expect(html).not.toContain('act-timeline')
  expect(html).toContain('task-duration')
})

it('offers no restore or retry control anywhere when the outcome is unconfirmed', () => {
  const activity = {version:1 as const,startedAt:'2026-10-21T10:00:00.000Z',finishedAt:'2026-10-21T10:00:05.000Z',events:[
    {type:'task.started',time:'2026-10-21T10:00:00.000Z'},
    {type:'tool.started',time:'2026-10-21T10:00:01.000Z',tool:'najd-files-write',detail:'C:/a.txt'},
    {type:'tool.failed',time:'2026-10-21T10:00:02.000Z',tool:'najd-files-write',detail:'error: UNKNOWN'},
    {type:'task.unknown_effect',time:'2026-10-21T10:00:05.000Z'}]}
  const html = renderToStaticMarkup(<TaskActivity language="en" onRetry={() => {}} run={{key:'u',sessionId:null,afterIndex:1,startedAt:Date.parse(activity.startedAt),finishedAt:Date.parse(activity.finishedAt),activity,steps:[{state:'UNKNOWN_EFFECT',proposedTool:null,reasoningEffort:null}]}} />)
  expect(html).toContain('Outcome unconfirmed')
  expect(html).not.toContain('Restore prompt')
  const failed = renderToStaticMarkup(<TaskActivity language="en" onRetry={() => {}} run={{key:'f',sessionId:null,afterIndex:1,startedAt:Date.parse(activity.startedAt),finishedAt:Date.parse(activity.finishedAt),
    activity:{...activity,events:[...activity.events.slice(0,3),{type:'task.failed',time:'2026-10-21T10:00:05.000Z',detail:'PROVIDER_TIMEOUT'}]},steps:[{state:'FAILED',proposedTool:null,reasoningEffort:null}]}} />)
  expect(failed).toContain('Restore prompt')
})

it('shows an unconfirmed selected skill as a warning row without a restore control', () => {
  const activity = {version:1 as const,startedAt:'2026-10-21T10:00:00.000Z',finishedAt:'2026-10-21T10:00:05.000Z',events:[
    {type:'task.started',time:'2026-10-21T10:00:00.000Z',skill:'najd-read-document'},
    {type:'task.unknown_effect',time:'2026-10-21T10:00:05.000Z'}]}
  const html = renderToStaticMarkup(<TaskActivity language="en" onRetry={() => {}} run={{key:'s',sessionId:null,afterIndex:1,startedAt:Date.parse(activity.startedAt),finishedAt:Date.parse(activity.finishedAt),activity,steps:[{state:'UNKNOWN_EFFECT',proposedTool:null,reasoningEffort:null}]}} />)
  // The finished block is collapsed by default, but it is the full activity block (not the one-line duration) so the skill row can be opened.
  expect(html).toContain('act-block')
  expect(html).not.toContain('act-plain')
  expect(html).toContain('Outcome unconfirmed')
  expect(html).not.toContain('Restore prompt')
})

it('keeps the activity block for a task stopped before any tool ran', () => {
  const activity = {version:1 as const,startedAt:'2026-10-21T10:00:00.000Z',finishedAt:'2026-10-21T10:00:02.000Z',events:[
    {type:'task.started',time:'2026-10-21T10:00:00.000Z'},{type:'task.cancelled',time:'2026-10-21T10:00:02.000Z'}]}
  const html = renderToStaticMarkup(<TaskActivity language="en" run={{key:'c',sessionId:null,afterIndex:1,startedAt:Date.parse(activity.startedAt),finishedAt:Date.parse(activity.finishedAt),activity,steps:[{state:'CANCELLED',proposedTool:null,reasoningEffort:null}]}} />)
  expect(html).toContain('act-block')
  expect(html).toContain('Stopped after')
})
it('keeps a file link to a finished site clickable and still drops script links', () => {
  const html = renderToStaticMarkup(<ChatMessage language="en" message={{role:'assistant',createdAt:'',text:'[Open](file:///C:/Users/a/Documents/NAJD/site/index.html) [bad](javascript:alert(1))'}} />)
  expect(html).toContain('href="file:///C:/Users/a/Documents/NAJD/site/index.html"')
  expect(html).not.toContain('javascript:')
})

it('shows the model thinking like Claude: the word Thinking, its time and its text open; a live Thinking line while it works', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 21, 10, 0, s)).toISOString()
  const done = {version:1 as const,startedAt:at(0),finishedAt:at(9),events:[
    {seq:1,type:'task.started',time:at(0)},
    {seq:2,type:'reasoning.summary',time:at(1),tool:'najd-plan',detail:'Request of 8 characters'},
    {seq:3,type:'reasoning.text',time:at(5),tool:'najd-thinking',detail:'The user greets me.\nAnswer briefly.'},
    {seq:4,type:'task.completed',time:at(9)}]}
  const html = renderToStaticMarkup(<TaskActivity language="ar" run={{key:'t',sessionId:null,afterIndex:1,startedAt:Date.parse(at(0)),finishedAt:Date.parse(at(9)),activity:done,steps:[{state:'COMPLETED',proposedTool:null,reasoningEffort:null}]}} />)
  expect(html).not.toContain('Request of 8 characters')
  const open = renderToStaticMarkup(<TaskActivity language="ar" run={{key:'t',sessionId:null,afterIndex:1,startedAt:Date.parse(at(0)),activity:{...done,finishedAt:null,events:done.events.slice(0,3)},steps:[{state:'RUNNING',proposedTool:null,reasoningEffort:null}]}} />)
  expect(open).toContain('تفكير'); expect(open).toContain('The user greets me.\nAnswer briefly.'); expect(open).toContain('4 s'); expect(open).toContain('يفكر…')
})
it('a live task with nothing recorded yet opens with the Thinking line (C21-01)', () => {
  const start = '2026-10-21T10:00:00.000Z'
  const html = renderToStaticMarkup(<TaskActivity language="en" run={{key:'t0',sessionId:null,afterIndex:1,startedAt:Date.parse(start),activity:{version:1,startedAt:start,finishedAt:null,events:[{seq:1,type:'task.started',time:start}]},steps:[{state:'RUNNING',proposedTool:null,reasoningEffort:null}]}} />)
  expect(html).toContain('Thinking…'); expect(html).toContain('aria-expanded="true"')
})