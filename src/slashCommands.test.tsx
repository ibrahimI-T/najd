import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSlashItems, filterSlash, slashQuery, GROUP_ORDER, type SlashContext } from './slashCommands'
import { SlashMenu } from './SlashMenu'

const calls: string[] = []
const context = (over: Partial<SlashContext> = {}): SlashContext => ({
  language: 'en', hasConversation: true, busy: false, skills: [{ id: 'writing', name: 'Writing', description: 'Helps write clearly' }], pluginCommands: [{ command: 'setup-review-all', pluginName: 'Setup', description: 'Review everything', body: 'Review $ARGUMENTS carefully.' }], efforts: ['low', 'high'],
  actions: { newChat: () => calls.push('new'), openPage: page => calls.push('page:' + page), setAccess: mode => calls.push('access:' + mode), pinProfile: profile => calls.push('pin:' + profile), setEffort: effort => calls.push('effort:' + effort) },
  ...over
})

describe('slash query', () => {
  it('opens only for a lone first word that starts with a slash', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/Co')).toBe('co')
    expect(slashQuery('/read file.txt')).toBeNull()
    expect(slashQuery('hello /x')).toBeNull()
    expect(slashQuery('/usr/bin/tool')).toBeNull()
    expect(slashQuery('C:\path')).toBeNull()
    expect(slashQuery('')).toBeNull()
  })
})

describe('slash commands', () => {
  it('lists every group, in order, with nothing typed', () => {
    const shown = filterSlash(buildSlashItems(context()), '')
    const order = shown.map(item => GROUP_ORDER.indexOf(item.group))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(new Set(shown.map(item => item.group))).toEqual(new Set(GROUP_ORDER))
    expect(shown.map(item => item.command)).toEqual(expect.arrayContaining(['new', 'read', 'models', 'access-full', 'profile-coding', 'effort-high', 'skill-writing']))
  })
  it('filters by what the command starts with first, then by label and keywords (Arabic too)', () => {
    const items = buildSlashItems(context({ language: 'ar' }))
    expect(filterSlash(items, 'co')[0].command).toBe('connections')
    expect(filterSlash(items, 'co').map(item => item.command)).toContain('profile-coding')
    expect(filterSlash(items, 'ne')[0].command).toBe('new')
    expect(filterSlash(items, 'coding').map(item => item.command)).toContain('profile-coding')
    expect(filterSlash(items, 'برمجة').map(item => item.command)).toContain('profile-coding')
    expect(filterSlash(items, 'مهارة').map(item => item.command)).toContain('skill-writing')
    expect(filterSlash(items, 'zzzz')).toEqual([])
  })
  it('only offers efforts the model supports, and automatic always', () => {
    const efforts = buildSlashItems(context({ efforts: ['high'] })).filter(item => item.group === 'effort').map(item => item.command)
    expect(efforts).toEqual(['effort-auto', 'effort-high'])
  })
  it('profiles need a conversation, and a busy chat cannot start a new one', () => {
    const idle = buildSlashItems(context({ hasConversation: false, busy: true }))
    expect(idle.find(item => item.command === 'profile-coding')?.disabled).toBeTruthy()
    expect(idle.find(item => item.command === 'new')?.disabled).toBeTruthy()
    expect(buildSlashItems(context()).find(item => item.command === 'profile-coding')?.disabled).toBeUndefined()
  })
  it('running a command calls its action; skills and /read only insert text for the owner to read and edit', () => {
    calls.length = 0
    const items = buildSlashItems(context())
    const byCommand = (command: string) => items.find(item => item.command === command)!
    for (const command of ['new', 'models', 'access-approve', 'profile-research', 'effort-low']) { const action = byCommand(command).action; expect(action.kind).toBe('run'); if (action.kind === 'run') action.run() }
    expect(calls).toEqual(['new', 'page:models', 'access:approve', 'pin:research', 'effort:low'])
    expect(byCommand('read').action).toEqual({ kind: 'insert', text: '/read ' })
    const skill = byCommand('skill-writing').action
    expect(skill.kind).toBe('insert'); if (skill.kind === 'insert') expect(skill.text).toContain('Writing')
  })
  it('automatic profile clears the pin', () => {
    calls.length = 0
    const action = buildSlashItems(context()).find(item => item.command === 'profile-auto')!.action
    if (action.kind === 'run') action.run()
    expect(calls).toEqual(['pin:null'])
  })
})

describe('slash menu', () => {
  it('renders a listbox with options, the active one selected, groups and a reason for disabled ones', () => {
    const items = buildSlashItems(context({ hasConversation: false }))
    const html = renderToStaticMarkup(<SlashMenu id="slash-menu" items={filterSlash(items, '')} index={0} language="en" onChoose={vi.fn()} onHover={vi.fn()} />)
    expect(html).toContain('role="listbox"'); expect(html).toContain('role="option"'); expect(html).toContain('aria-selected="true"'); expect(html).toContain('data-slash="new"')
    expect(html).toContain('Chat'); expect(html).toContain('aria-disabled="true"'); expect(html).toContain('Send a message first')
  })
  it('renders nothing when there is nothing to show, and Arabic labels in Arabic', () => {
    expect(renderToStaticMarkup(<SlashMenu id="m" items={[]} index={0} language="en" onChoose={vi.fn()} onHover={vi.fn()} />)).toBe('')
    const html = renderToStaticMarkup(<SlashMenu id="m" items={filterSlash(buildSlashItems(context({ language: 'ar' })), 'new')} index={0} language="ar" onChoose={vi.fn()} onHover={vi.fn()} />)
    expect(html).toContain('محادثة جديدة'); expect(html).toContain('المحادثة')
  })

  it('plugin commands put their text in the message box and never run anything', () => {
    const item = buildSlashItems(context()).find(entry => entry.command === 'setup-review-all')!
    expect(item.group).toBe('plugin')
    expect(item.action).toEqual({ kind: 'insert', text: 'Review  carefully. ' })
  })
})
