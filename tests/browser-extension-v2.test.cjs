// NAJD Browser 2.0 observation rules, without a browser: controls from the accessibility tree, secrets marked, stale targets refused.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ax = (role, name, id, extra = {}) => ({ role: { type: 'role', value: role }, name: { type: 'computedString', value: name }, backendDOMNodeId: id, ignored: false, ...extra })

test('controls come from the accessibility tree with their DOM node; text, hidden, disabled and ignored nodes are left out', async () => {
  const { axToElements } = await import('../browser-extension-v2/src/observe.js')
  const nodes = [ax('RootWebArea', 'Page', 1), ax('link', 'Gold price', 7), ax('StaticText', 'x', 9), ax('button', 'Join', 11), ax('button', 'Hidden', 12, { properties: [{ name: 'hidden', value: { type: 'boolean', value: true } }] }),
    ax('button', 'Off', 13, { properties: [{ name: 'disabled', value: { type: 'boolean', value: true } }] }), ax('link', 'Ignored', 14, { ignored: true }), ax('textbox', 'Email', 15), ax('textbox', 'Password', 16), ax('textbox', 'Code', 17), ax('combobox', 'Plan', 18)]
  const attrs = { 7: { href: 'https://gold.example/today' }, 15: { type: 'email' }, 16: { type: 'password' }, 17: { autocomplete: 'one-time-code' } }
  const out = axToElements(nodes, id => attrs[id])
  assert.deepEqual(out.map(item => [item.id, item.role, item.label]), [['e1', 'link', 'Gold price'], ['e2', 'button', 'Join'], ['e3', 'field', 'Email'], ['e4', 'field', 'Password'], ['e5', 'field', 'Code'], ['e6', 'select', 'Plan']])
  assert.equal(out[0].href, 'https://gold.example/today'); assert.equal(out[0].ref, 7)
  assert.equal(out[3].sensitive, true); assert.equal(out[4].sensitive, true); assert.equal(out[2].sensitive, undefined)
  // The sign-in rules in NAJD read the field's autocomplete purpose and its name and id.
  assert.equal(out[4].autocomplete, 'one-time-code'); assert.equal(out[2].autocomplete, undefined)
  assert.equal(axToElements([ax('textbox', 'Password', 3)], () => ({ type: 'password', name: 'pw', id: 'pass-1', autocomplete: 'current-password' }))[0].names, 'pw pass-1')
  assert.equal(axToElements(Array.from({ length: 400 }, (_, index) => ax('button', 'b' + index, index + 1))).length, 150)
})

test('an action must name the current observation and the same control; secrets are refused', async () => {
  const { checkTarget, canNavigate } = await import('../browser-extension-v2/src/observe.js')
  const observation = { doc: 'abc12345', snap: 4, elements: [{ id: 'e1', role: 'link', label: 'Gold price', ref: 7 }, { id: 'e2', role: 'field', label: 'Password', ref: 9, sensitive: true }] }
  assert.equal(checkTarget(null, {}, 'e1').error, 'PAGE_CHANGED')
  assert.equal(checkTarget(observation, { doc: 'other', snap: '4' }, 'e1').error, 'PAGE_CHANGED')
  assert.equal(checkTarget(observation, { doc: 'abc12345', snap: '3' }, 'e1').error, 'PAGE_CHANGED')
  assert.equal(checkTarget(observation, { doc: 'abc12345', snap: '4', role: 'button' }, 'e1').error, 'ELEMENT_CHANGED')
  assert.equal(checkTarget(observation, { doc: 'abc12345', snap: '4', label: 'Delete account' }, 'e1').error, 'ELEMENT_CHANGED')
  assert.equal(checkTarget(observation, { doc: 'abc12345', snap: '4' }, 'e9').error, 'ELEMENT_NOT_FOUND')
  assert.equal(checkTarget(observation, { doc: 'abc12345', snap: '4' }, 'e2').error, 'SENSITIVE_FIELD')
  assert.equal(checkTarget(observation, { doc: 'abc12345', snap: '4', role: 'link', label: 'Gold price' }, 'e1').element.ref, 7)
  assert.equal(canNavigate('owned'), true); assert.equal(canNavigate('attached'), false)
})

test('@ tabs: the word being typed after @ is found, other web tabs are offered newest first, and the @word is removed once one is chosen', async () => {
  const { mentionAt, mentionChoices, dropMention, MAX_MENTIONS } = await import('../browser-extension-v2/src/mention.js')
  assert.equal(MAX_MENTIONS, 3)
  assert.deepEqual(mentionAt('@', 1), { start: 0, query: '' })
  assert.deepEqual(mentionAt('قارن مع @جو', 11), { start: 8, query: 'جو' })
  assert.equal(mentionAt('mail me at a@b.com', 18), null, 'an address is not a mention')
  assert.equal(mentionAt('@gi now', 7), null, 'the caret is past the word')
  const tabs = [
    { id: 1, url: 'https://github.com/x', title: 'GitHub', lastAccessed: 5 }, { id: 2, url: 'chrome://settings', title: 'Settings', lastAccessed: 9 },
    { id: 3, url: 'https://news.example/', title: 'الأخبار', lastAccessed: 8 }, { id: 4, url: 'https://gitlab.com/', title: 'GitLab', lastAccessed: 7 }, { url: 'https://no-id.example/' }]
  assert.deepEqual(mentionChoices(tabs).map(tab => tab.id), [3, 4, 1], 'web pages only, newest first')
  assert.deepEqual(mentionChoices(tabs, { query: 'GIT', exclude: [4] }).map(tab => tab.id), [1])
  assert.deepEqual(mentionChoices(tabs, { query: 'الاخبار' }).map(tab => tab.id), [], 'different letters do not match')
  assert.deepEqual(mentionChoices(tabs, { query: 'news' }).map(tab => tab.id), [3], 'the address matches too')
  assert.equal(dropMention('compare @gi with this', { start: 8 }, 11), 'compare with this')
})

test('/ skills: only at the start of the box, matches in the name come before the description, and the opening is the app\'s Use text', async () => {
  const { slashAt, skillChoices, skillPrompt } = await import('../browser-extension-v2/src/mention.js')
  assert.deepEqual(slashAt('/', 1), { start: 0, query: '' })
  assert.deepEqual(slashAt('/pdf', 4), { start: 0, query: 'pdf' })
  assert.equal(slashAt('a /pdf', 6), null, 'not in the middle of a question')
  assert.equal(slashAt('/pdf now', 8), null, 'a space ends it')
  assert.equal(slashAt('https://x', 9), null)
  const skills = [{ id: 'docx', name: 'Word files', description: 'Make PDF from Word too' }, { id: 'pdf-tools', name: 'PDF tools', description: '' }, { id: 'xlsx', name: 'Spreadsheets', description: '' }]
  assert.deepEqual(skillChoices(skills, { query: 'pdf' }).map(skill => skill.id), ['pdf-tools', 'docx'])
  assert.deepEqual(skillChoices(skills, { limit: 2 }).map(skill => skill.id), ['docx', 'pdf-tools'])
  assert.equal(skillPrompt(skills[1], false), 'Use the skill "PDF tools" (pdf-tools) for: ')
  assert.equal(skillPrompt(skills[1], true), 'استخدم مهارة «PDF tools» (pdf-tools) في: ')
})

test('self-update: only a strictly newer version in NAJD\'s folder reloads, and never while something is in progress', async () => {
  const { isNewer, checkSelfUpdate } = await import('../browser-extension-v2/src/self-update.js')
  assert.equal(isNewer('2.8.0', '2.2.0'), true); assert.equal(isNewer('2.10.0', '2.9.9'), true); assert.equal(isNewer('3.0.0', '2.99.99'), true)
  assert.equal(isNewer('2.8.0', '2.8.0'), false); assert.equal(isNewer('2.7.9', '2.8.0'), false); assert.equal(isNewer('2.8', '2.7.0'), false); assert.equal(isNewer(undefined, '2.7.0'), false)
  let reloads = 0
  const reload = () => { reloads++ }
  assert.equal(await checkSelfUpdate({ read: async () => '2.8.0', running: () => '2.8.0', reload }), 'current')
  assert.equal(await checkSelfUpdate({ read: async () => '2.8.0', running: () => '2.2.0', busy: async () => true, reload }), 'waiting')
  assert.equal(await checkSelfUpdate({ read: async () => { throw new Error('no file') }, running: () => '2.2.0', reload }), 'unreadable')
  assert.equal(reloads, 0, 'nothing reloads until it is newer and idle')
  assert.equal(await checkSelfUpdate({ read: async () => '2.8.0', running: () => '2.2.0', busy: async () => false, reload }), 'reloading')
  assert.equal(reloads, 1)
})

test('earlier chats: a closed chat is kept newest first, once, at most ten, titled by its first question, and taken out when reopened', async () => {
  const { keepChat, takeChat, MAX_CHATS } = await import('../browser-extension-v2/src/history.js')
  const id = n => n.toString(16).padStart(24, '0')
  let chats = keepChat(undefined, [{ id: id(1), text: '  first\n question ' }], 100)
  assert.deepEqual(chats.map(chat => [chat.title, chat.count, chat.at]), [['first question', 1, 100]])
  chats = keepChat(chats, [{ id: id(2), text: 'second' }], 200)
  chats = keepChat(chats, [{ id: id(1), text: 'first question' }, { id: id(3), text: 'follow-up' }], 300)
  assert.deepEqual(chats.map(chat => [chat.id, chat.count]), [[id(1), 2], [id(2), 1]], 'the same chat kept again replaces its earlier copy, at the top')
  assert.deepEqual(keepChat(chats, []), chats, 'an empty chat is not kept')
  assert.deepEqual(keepChat(chats, [{ id: 'not-an-ask', text: 'x' }]), chats)
  for (let n = 10; n < 30; n++) chats = keepChat(chats, [{ id: id(n), text: 'q' + n }], n)
  assert.equal(chats.length, MAX_CHATS); assert.equal(chats[0].id, id(29))
  const { chat, rest } = takeChat(chats, id(25))
  assert.equal(chat.title, 'q25'); assert.equal(rest.length, MAX_CHATS - 1); assert.ok(!rest.some(item => item.id === id(25)))
  assert.equal(takeChat(chats, id(999)).chat, null)
})

test('type to queue: a question typed while NAJD works waits, only the last one is kept, it is sent when NAJD is idle, and it can be dropped', async () => {
  const { createQueue } = await import('../browser-extension-v2/src/queue.js')
  let busy = false; const sent = []; const notes = []
  const queue = createQueue({ busy: () => busy, send: text => sent.push(text), onChange: value => notes.push(value) })
  assert.equal(queue.offer('first'), 'sent'); assert.deepEqual(sent, ['first'])
  busy = true
  assert.equal(queue.offer('second'), 'queued'); assert.equal(queue.offer('third'), 'queued')
  assert.equal(queue.settle(), false, 'nothing is sent while NAJD is busy'); assert.deepEqual(sent, ['first'])
  busy = false
  assert.equal(queue.settle(), true); assert.deepEqual(sent, ['first', 'third'], 'only the last typed question was kept')
  assert.equal(queue.settle(), false, 'and it is sent once')
  busy = true; queue.offer('fourth'); queue.clear(); busy = false
  assert.equal(queue.settle(), false); assert.deepEqual(sent, ['first', 'third'], 'a dropped question is never sent')
  assert.deepEqual(notes, [true, true, false, true, false])
})
