// The feature flows of the Vue workstation that the older UI smokes covered on removed screens (R-080), in the real app with an isolated
// profile: a project (create, instructions saved, a task started in it), Task Center (create, pause, enable, delete), a dashboard from a
// template (widget added, removed), Remote Control (enable, pairing code, disable), a knowledge base, a memory note, an MCP server (the
// fixture stdio server: added after the confirmation, connected, tools listed, removed), Telegram refusing a malformed token, chat settings
// and an update check confirming in words, the interface switching to English and back, and a restart keeping project, task, board,
// note and server. Each action's confirmation (toast) or effect on disk is checked, not only the screen.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')
process.env.NAJD_TEST_OAUTH_BROWSER = '1' // the harness browser follows the OAuth fixture's redirect
process.env.NAJD_TEST_FAKE_MIC = '1' // Chromium's fake microphone and a fixture transcription service (harness)

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const data = file => path.join(root, 'najd-data', file)
  let instance
  try {
    instance = await launch(root)
    let client = instance.client
    const value = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const press = async selector => { assert.equal(await evaluate(client, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return false; e.click(); return true })()`), true, 'cannot press ' + selector) }
    const pressText = async (scope, text) => { assert.equal(await evaluate(client, `(() => { const e = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!e) return false; e.click(); return true })()`), true, `cannot press "${text}" in ${scope}`) }
    const pressLabel = async label => { assert.equal(await evaluate(client, `(() => { const e = [...document.querySelectorAll('button, [role=button]')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} && !b.disabled); if (!e) return false; e.click(); return true })()`), true, `cannot press [aria-label="${label}"]`) }
    const type = async (selector, text) => { await click(client, selector); await client.send('Input.insertText', { text }) }
    const fill = (selector, text) => evaluate(client, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const body = () => evaluate(client, 'document.body.innerText')
    const toast = text => waitFor(async () => (await evaluate(client, `[...document.querySelectorAll('[data-toast]')].map(t => t.innerText).join('\\n')`)).includes(text), 20000)
    const settings = async page => { await press('[data-nav="account"]'); await waitFor(async () => await evaluate(client, '!!document.querySelector(".n-account + .w-menu")')); await press('.n-account + .w-menu button:last-child'); await waitFor(async () => await evaluate(client, `!!document.querySelector('[data-settings-route="${page}"]')`)); await press(`[data-settings-route="${page}"]`); await new Promise(resolve => setTimeout(resolve, 300)) }
    const files = async () => (await fs.readdir(path.join(root, 'najd-data'), { recursive: true })).map(String)

    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue"'), 60000)
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })

    // A picture in the library, to be attached to the project below (imported first: the project page reads the library when it opens).
    const projectPicture = await value(`(async () => { const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)); return (await window.najdLibrary.importBytes('project-picture.png', png.buffer)).id })()`)
    // Project: created from the rail, instructions saved to disk, a task started in it opens the conversation view with the project chosen.
    await pressLabel('مشروع جديد')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-project=name]")'))
    await type('[data-project=name]', 'Smoke project')
    await press('[data-project=create]')
    await waitFor(async () => (await body()).includes('تعليمات المشروع'))
    await fill('[data-project] textarea', 'Answer in short sentences.')
    await pressText('[data-project]', 'حفظ')
    await waitFor(async () => (await value('window.najdProjects.list()')).some(item => item.name === 'Smoke project' && item.instructions === 'Answer in short sentences.'))
    // Project files: a library picture is attached from the project page, listed, and taken off again; the project record follows.
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-project-files]")'))
    assert.equal(await evaluate(client, '!!document.querySelector("[data-project-files-empty]")'), true, 'a new project has no files')
    await value(`(() => { const e = document.querySelector('[data-project-file-library]'); e.value = ${JSON.stringify(projectPicture)}; e.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await waitFor(async () => (await value('window.najdProjects.list()')).find(item => item.name === 'Smoke project').files.some(file => file.id === projectPicture))
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-project-file]")?.innerText || ""')).includes('project-picture.png'))
    await press('[data-project-file-remove]')
    await waitFor(async () => (await value('window.najdProjects.list()')).find(item => item.name === 'Smoke project').files.length === 0)
    await value(`window.najdLibrary.remove(${JSON.stringify(projectPicture)})`)
    await pressText('[data-project]', 'مهمة في المشروع')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))

    // Task Center: an interval task is created, paused, enabled again and deleted, each reflected in the stored list.
    await press('[data-nav="task-center"]')
    await press('[data-task=new]')
    await type('[data-task=title]', 'Smoke task')
    await type('[data-task=prompt]', 'Say hello.')
    await pressText('.w-dialog', 'متكررة')
    await press('[data-task=save]')
    await waitFor(async () => (await value('window.najdWorkstation.tasks()')).some(item => item.title === 'Smoke task' && item.schedule.kind === 'interval'))
    await pressLabel('إيقاف مؤقت')
    await waitFor(async () => (await value('window.najdWorkstation.tasks()')).find(item => item.title === 'Smoke task')?.status === 'paused')
    await pressLabel('تفعيل')
    await waitFor(async () => (await value('window.najdWorkstation.tasks()')).find(item => item.title === 'Smoke task')?.status === 'active')

    // Run now: the task's answer is saved in its conversation (it was dropped before 0.10.36 and the conversation said "no reply").
    await value(`window.najdProviders.saveKey('openai-api', 'sk-najd-API-TEST-KEY')`)
    const runnable = await value(`window.najdWorkstation.taskCreate({ title: 'Run probe', prompt: 'hello from a scheduled task', schedule: { kind: 'interval', minutes: 600 }, provider: 'openai-api', model: 'gpt-6.1-sol' })`)
    await value(`window.najdWorkstation.taskRun(${JSON.stringify(runnable.id)})`)
    await waitFor(async () => (await value('window.najdWorkstation.tasks()')).find(item => item.id === runnable.id)?.runs[0]?.state === 'COMPLETED', 60000)
    const ran = (await value('window.najdWorkstation.tasks()')).find(item => item.id === runnable.id).runs[0]
    assert.deepEqual((await value(`window.najdSessions.get(${JSON.stringify(ran.conversationId)})`)).messages.map(message => message.role), ['user', 'assistant'])
    await value(`window.najdWorkstation.taskRemove(${JSON.stringify(runnable.id)})`)

    // Dashboard: a board from the Finance template, a widget added in edit mode and kept on disk.
    await press('[data-nav="dashboard"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-template=finance]")'))
    await press('[data-template=finance]')
    await waitFor(async () => (await value('window.najdWorkstation.documents("dashboard")')).some(item => item.template === 'finance' && item.widgets.length === 4))
    await press('[data-dashboard=edit]')
    await pressText('.w-page-actions', '+ ودجت')
    await waitFor(async () => (await value('window.najdWorkstation.documents("dashboard")')).some(item => item.template === 'finance' && item.widgets.length === 5))

    // Remote Control: off by default; enabled, a pairing code is shown, then turned off again.
    await press('[data-nav="remote-control"]')
    await waitFor(async () => (await value('window.najdWorkstation.remote()')).enabled === false)
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-remote=enabled]")'))
    await press('[data-remote=enabled]')
    await waitFor(async () => (await value('window.najdWorkstation.remote()')).enabled === true, 20000)
    await press('[data-remote=pair]')
    await waitFor(async () => /\S/.test(await evaluate(client, 'document.querySelector("[data-remote=code]")?.innerText || ""')), 20000)
    await press('[data-remote=enabled]')
    await waitFor(async () => (await value('window.najdWorkstation.remote()')).enabled === false, 20000)

    // Knowledge base and a memory note: created through Settings, confirmed in words, stored.
    await settings('knowledge')
    await type('.s-inline input', 'Smoke base')
    await pressText('.s-inline', 'إنشاء')
    await toast('أُنشئت قاعدة المعرفة.')
    assert.ok((await value('window.najdKnowledge.list()')).some(base => base.name === 'Smoke base'))
    // A file is added (the harness's picker offers the file named in pick.txt), listed by name under its base with the result said in words,
    // and removed from the base on its own (the base stays). A file NAJD refuses is named with its reason instead of failing silently.
    await fs.mkdir(root + '-imports', { recursive: true })
    await fs.writeFile(path.join(root + '-imports', 'kb-note.md'), 'Knowledge fixture. The smoke base remembers this sentence.')
    await fs.writeFile(path.join(root + '-imports', 'pick.txt'), 'kb-note.md')
    await press('[data-base-add]')
    await toast('أُضيف 1 ملف.')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-base-file]")?.innerText || ""')).includes('kb-note.md'))
    assert.equal((await value('window.najdKnowledge.list()')).find(base => base.name === 'Smoke base').items.length, 1)
    await fs.writeFile(path.join(root + '-imports', 'pick.txt'), '../najd-data/sessions.json')
    await press('[data-base-add]')
    await toast('تعذر:')
    await press('[data-base-file-remove]')
    await toast('أُزيل الملف من القاعدة.')
    assert.equal((await value('window.najdKnowledge.list()')).find(base => base.name === 'Smoke base').items.length, 0, 'the file left the base')
    assert.ok((await value('window.najdKnowledge.list()')).some(base => base.name === 'Smoke base'), 'the base itself stays')
    await fs.rm(path.join(root + '-imports', 'pick.txt'), { force: true })

    // The attachment library: an imported file is listed (and found by name), and removing it needs a second press; the list in the app and the
    // stored library agree afterwards.
    const imported = await value(`(async () => { const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)); return (await window.najdLibrary.importBytes('smoke-library-item.png', png.buffer)).id })()`)
    await settings('library')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-library-page]")?.innerText || ""')).includes('smoke-library-item.png'))
    await type('[data-library-search]', 'no-such-file-name')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-library-empty]") && document.querySelectorAll("[data-library-item]").length === 0'))
    await fill('[data-library-search]', 'smoke-library')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll("[data-library-item]").length === 1'))
    await press('[data-library-remove]')
    assert.ok((await value('window.najdLibrary.list()')).some(item => item.id === imported), 'the first press only asks for confirmation')
    await press('[data-library-remove]')
    await toast('حُذف من المكتبة.')
    assert.equal((await value('window.najdLibrary.list()')).some(item => item.id === imported), false, 'the confirmed removal deleted it from the library')

    // An interrupted account removal (the password already gone) is shown on the accounts page and cleared once the owner confirms.
    const staleId = '11111111-2222-3333-4444-555555555555'
    await fs.mkdir(path.join(root, 'najd-data', 'accounts'), { recursive: true })
    await fs.writeFile(path.join(root, 'najd-data', 'accounts', 'accounts.json'), JSON.stringify({ version: 1, accounts: [{ id: staleId, label: 'Stale test account', host: 'example.test', username: 'nobody', autoLogin: false, authorizedAt: new Date().toISOString(), lastUsedAt: null, revoked: true }] }))
    await settings('account-security')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-accounts-pending]")'))
    assert.ok((await evaluate(client, 'document.querySelector("[data-accounts-pending]").innerText')).includes('Stale test account'))
    assert.equal(await evaluate(client, 'document.querySelectorAll("[data-account-remove]").length'), 0, 'a half-removed account is not listed as a normal one')
    await press('[data-account-confirm]')
    await waitFor(async () => await evaluate(client, '!document.querySelector("[data-accounts-pending]")'))
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'najd-data', 'accounts', 'accounts.json'), 'utf8')).accounts, [], 'the confirmed record is cleared')

    // The browser pairing code can be replaced from the page: the one on screen stops being the current code.
    await settings('permissions-control')
    await pressText('.ws-main', 'رمز الربط')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-pairing-code]")'))
    const firstCode = await evaluate(client, 'document.querySelector("[data-pairing-code]").textContent')
    await press('[data-rotate-code]')
    await waitFor(async () => { const next = await evaluate(client, 'document.querySelector("[data-pairing-code]")?.textContent'); return !!next && next !== firstCode })
    assert.notEqual(await value('window.najdBrowser.pairingCode()'), firstCode, 'the old code is no longer the current one')
    assert.equal(await value('window.najdBrowser.pairingCode()'), await evaluate(client, 'document.querySelector("[data-pairing-code]").textContent'), 'the page shows the current code')
    await settings('conversation-memory')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".s-form input")'))
    await type('.s-form input', 'Smoke note')
    await type('.s-form textarea', 'NAJD smoke remembers this.')
    await pressText('.s-form', 'حفظ')
    await toast('حُفظت الملاحظة.')
    assert.ok((await value('window.najdMemory.list()')).some(note => note.title === 'Smoke note'))
    // A note is corrected in place: Edit loads it into the form, Save keeps its id and creation time and replaces the text (0.10.103).
    const before = (await value('window.najdMemory.list()')).find(note => note.title === 'Smoke note')
    await press('[data-note-edit]')
    await waitFor(async () => (await evaluate(client, 'document.querySelector(".s-form input")?.value')) === 'Smoke note' && (await evaluate(client, 'document.querySelector(".s-form textarea")?.value')) === 'NAJD smoke remembers this.')
    await type('.s-form textarea', ' Corrected text.')
    await pressText('.s-form', 'حفظ')
    await toast('حُدّثت الملاحظة.')
    const edited = await value('window.najdMemory.list()')
    assert.equal(edited.filter(note => note.title === 'Smoke note').length, 1, 'edited in place, not duplicated')
    assert.equal(edited.find(note => note.title === 'Smoke note').id, before.id)
    assert.equal(edited.find(note => note.title === 'Smoke note').createdAt, before.createdAt)
    assert.ok(edited.find(note => note.title === 'Smoke note').text.includes('Corrected text.'))
    assert.equal(await evaluate(client, 'document.querySelector(".s-form input")?.value'), '', 'the form is empty again after saving')

    // MCP prerequisites: with npx reported missing, Node.js cards offer Install and Recheck instead of Add; uv cards still offer Add.
    // After the program "appears" (file removed), Recheck turns the cards back to Add without leaving the page.
    await fs.writeFile(path.join(root, 'missing-programs.txt'), 'npx')
    await settings('mcp')
    const cards = () => evaluate(client, `[...document.querySelectorAll('[data-mcp-presets] .s-preset')].map(card => ({ label: card.querySelector('em')?.textContent || '', missing: !!card.querySelector('[data-preset-missing]'), buttons: [...card.querySelectorAll('button')].map(b => b.innerText.trim()) }))`)
    await waitFor(async () => (await cards()).some(card => card.missing), 20000)
    const missingCards = (await cards()).filter(card => card.missing)
    assert.ok(missingCards.every(card => card.label.includes('Node.js') && card.buttons.includes('ثبّت Node.js') && card.buttons.includes('أعد الفحص') && !card.buttons.includes('إضافة')), 'missing cards: ' + JSON.stringify(missingCards.slice(0, 2)))
    assert.ok((await cards()).some(card => card.label.includes('جاهز') && !card.missing), 'uv cards stay ready')
    await fs.rm(path.join(root, 'missing-programs.txt'))
    await pressText('[data-preset-missing]', 'أعد الفحص')
    await waitFor(async () => !(await cards()).some(card => card.missing), 20000)

    // MCP: the fixture stdio server is added after the owner's confirmation, connects and lists its tools.
    await fs.writeFile(path.join(root, 'mcp-confirm.txt'), 'yes')
    await settings('mcp')
    await waitFor(async () => await evaluate(client, '!!document.querySelectorAll(".s-form input")[2]'))
    await type('.s-form label:nth-child(1) input', 'smoke-fixture')
    await type('.s-form label:nth-child(2) input', process.execPath)
    await type('.s-form label:nth-child(3) input', JSON.stringify([path.join(__dirname, 'fixtures', 'mcp-fixture-server.cjs')]))
    await pressText('.s-form', 'إضافة واتصال')
    await waitFor(async () => (await value('window.najdMcpServers.list()')).some(server => server.name === 'smoke-fixture' && server.state === 'connected'), 30000)
    assert.ok((await value('window.najdMcpServers.list()')).find(server => server.name === 'smoke-fixture').tools.some(tool => tool.name === 'echo'), 'the fixture tools are listed')

    // A remote MCP server with OAuth: it needs a sign-in, the Sign in button runs the browser flow, and it connects with its tools.
    const oauth = await require('./fixtures/mcp-oauth-fixture.cjs').fixture()
    try {
      await value(`window.najdMcpServers.add({ name: 'oauth-fixture', command: '', url: ${JSON.stringify(oauth.base + '/mcp')}, args: [], cwd: '', env: {} })`)
      const remote = (await value('window.najdMcpServers.list()')).find(server => server.name === 'oauth-fixture')
      await value(`window.najdMcpServers.connect(${JSON.stringify(remote.id)})`)
      await settings('channels'); await settings('mcp')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-mcp-signin]")'), 20000)
      await press('[data-mcp-signin]')
      await waitFor(async () => (await value('window.najdMcpServers.list()')).find(server => server.name === 'oauth-fixture')?.state === 'connected', 30000)
      await toast('تم تسجيل الدخول والاتصال.')
      assert.deepEqual((await value('window.najdMcpServers.list()')).find(server => server.name === 'oauth-fixture').tools.map(tool => tool.name), ['whoami'])
      assert.equal(/AT-\d|RT-\d/.test(await fs.readFile(path.join(root, 'najd-data', 'mcp-servers.json'), 'utf8')), false, 'tokens sealed on disk')
      await value(`window.najdMcpServers.remove(${JSON.stringify(remote.id)})`)
    } finally { await oauth.close() }

    // Telegram: a malformed token is refused and said so; nothing is stored.
    await settings('channels')
    await type('.s-inline input[type=password]', 'not-a-token')
    await pressText('.s-inline', 'حفظ')
    await waitFor(async () => (await evaluate(client, `[...document.querySelectorAll('[data-toast=error], .w-banner.error')].map(e => e.innerText).join(' ')`)).length > 0, 20000)
    assert.equal((await value('window.najdChannels.status()')).configured || false, false)

    // Chat settings save and an update check both say what happened.
    await settings('chat-settings')
    await waitFor(async () => await evaluate(client, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'حفظ')`))
    await pressText('.ws-main', 'حفظ')
    await toast('حُفظت إعدادات المحادثة.')
    await settings('general')
    await waitFor(async () => await evaluate(client, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'فحص')`))
    // The state is shown in words (never the raw state name), and a healthy start shows no recovery warning.
    const badge = await evaluate(client, '({ state: document.querySelector("[data-update-state]").dataset.state, text: document.querySelector("[data-update-state]").innerText })')
    assert.notEqual(badge.text.trim(), badge.state, 'the update state is translated: ' + JSON.stringify(badge))
    assert.equal(await evaluate(client, '!!document.querySelector("[data-update-recovery]")'), false, 'no recovery warning after a clean start')
    await pressText('.ws-main', 'فحص')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-toast]")'), 30000)

    // Language: English everywhere, then Arabic again.
    await pressText('.ws-main', 'English')
    await waitFor(async () => (await body()).includes('Settings') || (await body()).includes('General'))
    assert.equal(await evaluate(client, 'document.querySelector(".ws-main").getAttribute("dir")'), 'ltr')
    await pressText('.ws-main', 'العربية')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".ws-main").getAttribute("dir") === "rtl"'))

    // Restart: everything created above is still there.
    await stop(instance); instance = null
    instance = await launch(root); client = instance.client
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue"'), 60000)
    assert.ok((await value('window.najdProjects.list()')).some(item => item.name === 'Smoke project'), 'project kept')
    assert.ok((await value('window.najdWorkstation.tasks()')).some(item => item.title === 'Smoke task'), 'task kept')
    assert.ok((await value('window.najdWorkstation.documents("dashboard")')).some(item => item.widgets.length === 5), 'board kept')
    assert.ok((await value('window.najdMemory.list()')).some(note => note.title === 'Smoke note'), 'note kept')
    assert.ok((await value('window.najdMcpServers.list()')).some(server => server.name === 'smoke-fixture'), 'server kept')
    assert.ok((await value('window.najdKnowledge.list()')).some(base => base.name === 'Smoke base'), 'knowledge base kept')

    // Deleting from the screens: the task and the MCP server.
    await press('[data-nav="task-center"]')
    await waitFor(async () => (await body()).includes('Smoke task'))
    await pressLabel('حذف')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-confirm-dialog]")'))
    await press('[data-confirm=ok]')
    await waitFor(async () => !(await value('window.najdWorkstation.tasks()')).some(item => item.title === 'Smoke task'))
    // Voice input: with the OpenAI key saved, the microphone records (Chromium's fake device), stopping transcribes, and the text lands
    // in the draft without being sent.
    await press('[data-nav="new"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-voice]")'))
    await press('[data-voice]')
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-voice]").classList.contains("recording")'), 15000)
    await new Promise(resolve => setTimeout(resolve, 2500))
    await press('[data-voice]')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("#prompt").value')).includes('NAJD voice fixture text'), 30000)
    assert.equal(await evaluate(client, 'document.querySelectorAll(".c-msg.user").length'), 0, 'the transcription is not sent by itself')
    await evaluate(client, `(() => { const e = document.querySelector('#prompt'); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })) })()`)

    // Every menu opens inside the window and is not clipped (the workbench "+" menu opened past the right edge in Arabic).
    await press('[data-workbench-toggle]')
    await press('[data-workbench-new]')
    await waitFor(async () => await evaluate(client, `(() => { const m = document.querySelector('[data-workbench] .w-menu'); if (!m) return false; const r = m.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return r.left >= 0 && r.right <= innerWidth && !!hit && m.contains(hit) })()`))
    await press('[data-workbench-new]')
    // Shortcuts follow the physical key: Ctrl+N with the Arabic layout (the key gives "ى") still starts a new task.
    await press('[data-nav="dashboard"]')
    for (const type of ['rawKeyDown', 'keyUp']) await client.send('Input.dispatchKeyEvent', { type, key: 'ى', code: 'KeyN', windowsVirtualKeyCode: 78, modifiers: 2 })
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-route]")?.dataset.route === "home"'))
    void files
    console.log('PASS: Vue feature flows: project with instructions and a task in it, Task Center create/pause/enable/delete and run now saving its answer, dashboard template and widget, Remote Control enable/pair/disable, knowledge base, memory note, MCP fixture server connected with tools, OAuth sign-in to a remote MCP server from the Sign in button, malformed Telegram token refused, chat settings and update check confirmed, Arabic/English switch, restart keeping all of it, Ctrl+N on the Arabic layout, workbench menu inside the window, voice input into the draft.')
  } finally { if (instance) await stop(instance) }
}
main().catch(error => { console.error(error); process.exit(1) })
