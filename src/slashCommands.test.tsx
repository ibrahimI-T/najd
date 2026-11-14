import { describe, expect, it } from 'vitest'
import { buildSlashItems, filterSlash, slashQuery, GROUP_ORDER, type SlashContext } from './slashCommands'

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
    expect(new Set(shown.map(item => item.group))).toEqual(new Set(GROUP_ORDER.filter(group => group !== 'prompt'))) // no saved prompts in this context
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
  it('keeps the active item first and gives a reason for disabled ones', () => {
    const items = filterSlash(buildSlashItems(context({ hasConversation: false })), '')
    expect(items[0].command).toBe('new')
    expect(items.some(item => String(item.disabled).includes('Send a message first'))).toBe(true)
  })
  it('finds nothing for an unknown word, and labels Arabic in Arabic', () => {
    expect(filterSlash(buildSlashItems(context()), 'zzzz-none')).toEqual([])
    expect(filterSlash(buildSlashItems(context({ language: 'ar' })), 'new')[0].label).toBe('محادثة جديدة')
  })

  it('plugin commands put their text in the message box and never run anything', () => {
    const item = buildSlashItems(context()).find(entry => entry.command === 'setup-review-all')!
    expect(item.group).toBe('plugin')
    expect(item.action).toEqual({ kind: 'insert', text: 'Review  carefully. ' })
  })
})

describe('saved prompts in the slash menu', () => {
  it('lists the saved prompts first and finds them by any of their words', () => {
    const actions = { newChat() {}, openPage() {}, setAccess() {}, pinProfile() {}, setEffort() {} }
    const items = buildSlashItems({ language: 'ar', hasConversation: false, busy: false, skills: [], efforts: [], prompts: ['لخص لي تقرير المبيعات الأسبوعي', 'Draft a polite reply'], actions })
    expect(filterSlash(items, '')[0].group).toBe('prompt')
    expect(filterSlash(items, 'المبيعات')[0].action).toEqual({ kind: 'insert', text: 'لخص لي تقرير المبيعات الأسبوعي' })
  })
})
