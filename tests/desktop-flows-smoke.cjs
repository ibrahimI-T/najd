// The desktop flows on the Vue workstation (R-079) in the real app with an isolated profile and fixture providers: engine status, an API key
// saved and never stored in clear, the ChatGPT subscription sign-in (fixture identity provider), model tests, a conversation saved to disk,
// an approval card denied then allowed with the file appearing only after approval, export without overwriting, full-text search, a restart
// that keeps conversations and verified providers, and deletion. --packaged runs the same flows on the packaged layout (npm run smoke:package).
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

const packaged = process.argv.includes('--packaged')
const KEY = 'sk-najd-API-TEST-KEY'

// A small valid PNG of one colour, for the attachment thumbnail check.
function solidPng(width, height) {
  const zlib = require('node:zlib')
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii'); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0); return Buffer.concat([head, data, tail]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [30, 120, 220]).flat())])))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const sessionsFile = path.join(root, 'najd-data', 'sessions.json')
  const target = path.join(root + '-documents', 'NAJD', 'smoke', 'out.txt')
  let instance
  try {
    // A personal skill saved earlier (as NAJD saves one after the owner approves it), to edit from the Skills page below.
    { const { createWorkstationPackages } = require('../electron/workstation/packages.cjs'), { personalSkillArchive } = require('../electron/workstation/personal-skill.cjs')
      const packages = createWorkstationPackages({ directory: path.join(root, 'najd-data', 'workstation', 'packages'), appVersion: require('../package.json').version })
      const seed = personalSkillArchive({ name: 'Monthly budget', description: 'Use when the user wants a monthly budget workbook.', steps: '1. Ask for income and expenses.\n2. Write the workbook with najd_python_run.' })
      await packages.install((await packages.planFromBytes(seed.bytes, 'personal:' + seed.id)).planId) }
    instance = await launch(root)
    let client = instance.client
    const value = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const press = async selector => { assert.equal(await evaluate(client, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return false; e.click(); return true })()`), true, 'cannot press ' + selector) }
    const pressText = async (scope, text) => { assert.equal(await evaluate(client, `(() => { const e = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!e) return false; e.click(); return true })()`), true, `cannot press "${text}" in ${scope}`) }
    const choose = (selector, option) => evaluate(client, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(option)}; e.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    const type = async (selector, text) => { await click(client, selector); await client.send('Input.insertText', { text }) }
    const body = () => evaluate(client, 'document.body.innerText')
    const settings = async page => { await press('[data-nav="account"]'); await waitFor(async () => await evaluate(client, '!!document.querySelector(".n-account + .w-menu")')); await press('.n-account + .w-menu button:last-child'); await waitFor(async () => await evaluate(client, `!!document.querySelector('[data-settings-route="${page}"]')`)); await press(`[data-settings-route="${page}"]`) }
    const send = async text => { await type('#prompt', text); await waitFor(async () => await evaluate(client, '!!document.querySelector(".k-send[type=submit]:not(:disabled)")')); await press('.k-send[type=submit]') }
    const replied = text => waitFor(async () => await evaluate(client, `[...document.querySelectorAll('.c-msg.assistant')].some(m => m.textContent.includes(${JSON.stringify(text)}))`), 60000)

    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue"'))
    // The community corner at the bottom of the rail: Discord, the website and the maker's Discord name (owner request 2026-11-14).
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-community] [data-community-join]")'))
    const corner = await evaluate(client, '({ text: document.querySelector("[data-community]").innerText, buttons: document.querySelectorAll("[data-community] button").length, links: typeof window.najdLinks?.open })')
    assert.equal(corner.buttons, 3, 'Discord, website and maker'); assert.equal(corner.links, 'function')
    assert.ok(/najdagent\.si/.test(corner.text) && /@fm\.1/.test(corner.text) && /(Discord|ديسكورد)/.test(corner.text), 'the corner names the community, the site and the maker: ' + corner.text)
    // Engine status: the packaged layout has no bundled engine runtime in this isolated profile.
    const runtime = path.join(__dirname, '../.runtimes/openclaw-runtime-2026.10.3/node_modules/openclaw/openclaw.mjs')
    const expected = !packaged && await fs.access(runtime).then(() => true, () => false) ? 'healthy' : 'not_installed'
    await waitFor(async () => (await value('window.najdGateway.status()')).state === expected, 60000)
    assert.deepEqual(Object.keys(await value('window.najdGateway.status()')).sort(), ['engine', 'errorCode', 'instanceId', 'state', 'verifiedAt', 'version'])

    // API key: saved through the screen, cleared from the field, never written in clear; the model is listed, tested and used.
    await settings('models')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-provider-row=openai] .ps-head")'))
    await press('[data-provider-row=openai] .ps-head')
    await pressText('[data-provider-row=openai] .w-seg', 'API')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-setup=openai-api] input[type=password]")'))
    await type('[data-setup=openai-api] input[type=password]', KEY)
    await pressText('[data-setup=openai-api]', 'حفظ')
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-setup=openai-api] select")?.options.length > 1'))
    assert.equal(await evaluate(client, 'document.querySelector("[data-setup=openai-api] input[type=password]").value'), '')
    for (const name of await fs.readdir(path.join(root, 'najd-data'))) {
      const file = path.join(root, 'najd-data', name)
      if ((await fs.stat(file)).isFile()) assert.equal((await fs.readFile(file, 'utf8')).includes(KEY), false, name + ' holds the key in clear')
    }
    await choose('[data-setup=openai-api] select', 'gpt-6.1-sol')
    await pressText('[data-setup=openai-api]', 'اختبار')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-setup=openai-api]").innerText')).includes('يعمل'))
    assert.equal((await value('window.najdProviders.catalog()')).find(item => item.id === 'openai-api').verified, true)

    // ChatGPT subscription: the fixture identity provider completes the browser sign-in; the access token never reaches the profile files.
    await pressText('[data-provider-row=openai] .w-seg', 'اشتراك')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-setup=chatgpt] [data-provider-signin]")'))
    await press('[data-setup=chatgpt] [data-provider-signin]')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-setup=chatgpt]").innerText')).includes('مسجل'), 30000)
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-setup=chatgpt] select")?.options.length > 1'), 30000)
    await choose('[data-setup=chatgpt] select', 'gpt-6.1-sol')
    await pressText('[data-setup=chatgpt]', 'اختبار')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-setup=chatgpt]").innerText')).includes('يعمل'))
    await press('[data-setup=chatgpt] [data-provider-use]')
    assert.equal(await evaluate(client, 'localStorage.getItem("najd.provider.v1")'), 'chatgpt')
    assert.equal((await fs.readFile(path.join(root, 'najd-data', 'chatgpt.json'), 'utf8')).includes('NAJD-TEST-ACCESS'), false)

    // A conversation: the answer streams into the thread and both turns are saved.
    await press('[data-nav="new"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
    await send('NAJD isolated session smoke')
    await replied('NAJD subscription test OK')
    await waitFor(async () => { try { const saved = JSON.parse(await fs.readFile(sessionsFile, 'utf8')).sessions[0]?.messages || []; return saved[0]?.text === 'NAJD isolated session smoke' && saved.at(-1)?.text.includes('NAJD subscription test OK') } catch { return false } })

    // Full thinking (R-083): the finished run's box opens, the thinking step shows one line, and a click shows every line of it.
    // Attached pictures (R-083): the composer shows the whole picture as a thumbnail, and so does the sent message.
    await fs.mkdir(root + '-imports', { recursive: true })
    await fs.writeFile(path.join(root + '-imports', 'photo.png'), solidPng(64, 48))
    await press("[aria-label='إرفاق ملفات']")
    await waitFor(async () => await evaluate(client, `!!document.querySelector('.k-files [data-attachment-thumb] img')?.naturalWidth`), 30000)
    await send('thinking fixture: show your thinking')
    await waitFor(async () => await evaluate(client, `!![...document.querySelectorAll('.c-msg.user')].at(-1)?.querySelector('[data-attachment-thumb] img')?.naturalWidth`), 30000)
    await replied('Thinking fixture answered')
    const lastBox = `[...document.querySelectorAll('.c-msg.assistant')].at(-1).querySelector('.a-box')`
    await waitFor(async () => await evaluate(client, `!!${lastBox}`), 30000)
    if (!await evaluate(client, `!!${lastBox}.querySelector('.a-steps')`)) await evaluate(client, `${lastBox}.querySelector('.a-head').click()`)
    await waitFor(async () => await evaluate(client, `!!${lastBox}.querySelector('.a-step.note .a-note-head')`), 30000)
    assert.equal(await evaluate(client, `!!${lastBox}.querySelector('.a-note-body')`), false, 'the thinking starts folded to one line')
    await evaluate(client, `[...${lastBox}.querySelectorAll('.a-step.note')].find(step => step.textContent.includes('thinking')).querySelector('.a-note-head').click()`)
    await waitFor(async () => (await evaluate(client, `${lastBox}.querySelector('.a-note-body')?.innerText || ''`)).includes('THINKING-LAST-LINE-MARKER'))
    const shown = await evaluate(client, `${lastBox}.querySelector('.a-note-body').innerText`)
    assert.ok(shown.includes('Second line of the plan.') && shown.includes('Reading the request') && !shown.includes('**'), 'every line shows, without Markdown marks: ' + shown)

    // Learning loop (R-083): a finished task with five or more tool steps offers Save as a skill; one click asks NAJD to write it.
    await send('activity showcase fixture: show the steps')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-approval]") || [...document.querySelectorAll(".c-msg.assistant")].some(m => m.textContent.includes("Done. I searched capabilities"))'), 60000)
    if (await evaluate(client, '!!document.querySelector("[data-approval]")')) await pressText('[data-approval]', 'Allow once')
    await replied('Done. I searched capabilities')
    const toolSteps = await evaluate(client, `[...document.querySelectorAll('.c-msg.assistant')].at(-1).querySelectorAll('.a-step.succeeded').length`)
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-skill-offer]")'), 15000).catch(() => {})
    assert.ok(await evaluate(client, '!!document.querySelector("[data-skill-offer]")'), 'a task with many tool steps offers Save as a skill (steps shown: ' + toolSteps + ')')
    const offerAnswers = await evaluate(client, `document.querySelectorAll('.c-msg.assistant').length`)
    await press('[data-skill-offer]')
    await waitFor(async () => await evaluate(client, `document.querySelectorAll('.c-msg.assistant').length > ${offerAnswers}`), 60000)
    assert.ok((await evaluate(client, `[...document.querySelectorAll('.c-msg.user')].at(-1).innerText`)).includes('najd_skill_save'), 'the offer asks NAJD to save the method as a skill')
    assert.equal(await evaluate(client, '!!document.querySelector("[data-skill-offer]")'), false, 'the offer is not repeated on the new reply')

    // Run receipt (original improvement): the finished showcase run says how many steps were confirmed and that one failed.
    await waitFor(async () => await evaluate(client, `!![...document.querySelectorAll('.c-msg.assistant')].at(-2)?.querySelector('[data-run-receipt]') || !!document.querySelector('[data-run-receipt]')`), 15000)
    const receiptLine = await evaluate(client, `[...document.querySelectorAll('[data-run-receipt]')].map(item => item.innerText).join(' | ')`)
    assert.ok(/مؤكدة/.test(receiptLine) && /فشلت/.test(receiptLine), 'the receipt names confirmed and failed steps: ' + receiptLine)
    // My prompts (original improvement): a sent message is saved with one click and found again from the "/" menu.
    await evaluate(client, `document.querySelector('.c-msg.user [data-save-prompt]').click()`)
    const savedPrompt = JSON.parse(await evaluate(client, `localStorage.getItem('najd.workstation.preferences.v1')`)).prompts[0]
    assert.ok(savedPrompt && savedPrompt.length > 3, 'the message was saved as a prompt')
    await type('#prompt', '/')
    await waitFor(async () => (await body()).includes('يضع الأمر في الرسالة'), 15000)
    await evaluate(client, `(() => { const p = document.querySelector('#prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(p, ''); p.dispatchEvent(new Event('input', { bubbles: true })) })()`)

    // Retry with another model (R-083): the latest request again on a model picked for this answer only; the default stays.
    const answersBefore = await evaluate(client, `document.querySelectorAll('.c-msg.assistant').length`)
    await press('[data-retry-model]')
    await waitFor(async () => await evaluate(client, `!!document.querySelector('[data-retry-model] + .w-menu .w-menu-item')`))
    await evaluate(client, `[...document.querySelectorAll('[data-retry-model] + .w-menu .w-menu-item')].find(item => item.textContent.includes('second'))?.click()`)
    await waitFor(async () => await evaluate(client, `document.querySelectorAll('.c-msg.assistant').length > ${answersBefore}`), 60000)
    assert.equal(await evaluate(client, 'localStorage.getItem("najd.provider.v1")'), 'chatgpt')
    assert.equal(JSON.parse(await evaluate(client, 'localStorage.getItem("najd.models.v2")')).chatgpt, 'gpt-6.1-sol', 'the default model is unchanged')

    // Read aloud (R-083): each reply has Listen; Windows' own engine returns real audio (checked by calling it, not played aloud in the test).
    assert.ok(await evaluate(client, `!!document.querySelector('.c-msg.assistant [data-read-aloud]')`), 'replies offer Listen')
    if (process.platform === 'win32') {
      const spoken = await value(`window.najdSessions.speak('NAJD read aloud test', 'en')`)
      assert.ok(spoken.audio.startsWith('data:audio/wav;base64,') && spoken.audio.length > 20000 && spoken.voice, 'Windows speech returned audio')
    }

    // Backup model (R-083): the subscription fails before any tool ran, NAJD tells the owner and finishes the request on the backup.
    await evaluate(client, `localStorage.setItem('najd.fallback-model.v1', JSON.stringify({ provider: 'openai-api', model: 'gpt-6.1-sol' }))`)
    await send('failover fixture: say hello')
    await replied('NAJD API test OK')
    assert.ok((await body()).includes('النموذج الاحتياطي'), 'the owner is told the backup model answered')
    await evaluate(client, `localStorage.removeItem('najd.fallback-model.v1')`)

    // Approval: in "Ask for each step" the model's write pauses in an approval card with its target; Deny writes nothing, Allow once writes.
    await press('.k-pill[data-access]')
    await pressText('.k-pill[data-access] + .w-menu', 'اسألني عن كل خطوةأي تغيير يحتاج موافقتك')
    assert.equal(await evaluate(client, 'document.querySelector(".k-pill[data-access]").dataset.access'), 'ask')
    for (const decision of ['Deny', 'Allow once']) {
      await send('workspace write fixture: write the file using the terminal command if needed')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-approval]")'), 60000)
      const card = await evaluate(client, 'document.querySelector("[data-approval]").innerText')
      assert.ok(card.includes('out.txt'), 'the approval names its target: ' + card)
      await assert.rejects(fs.stat(target), 'nothing is written before approval')
      assert.equal(await evaluate(client, 'document.querySelector("[data-nav=new]").disabled'), true, 'a new task cannot start while an approval waits')
      await pressText('[data-approval]', decision)
      await replied(decision === 'Deny' ? 'Workspace write declined' : 'Workspace write verified')
      if (decision === 'Deny') await assert.rejects(fs.stat(target), 'a denial leaves no file')
    }
    assert.equal(await fs.readFile(target, 'utf8'), 'APPROVED-CONTENT')
    // File cards (R-083): the written file shows under the reply with its actions; Preview opens its text inside NAJD's workbench.
    await waitFor(async () => await evaluate(client, `[...document.querySelectorAll('.c-msg.assistant [data-file-cards]')].some(list => list.innerText.includes('out.txt'))`), 30000)
    assert.equal(await evaluate(client, `[...document.querySelectorAll('.c-msg.assistant [data-file-cards] .c-filecard')].find(card => card.innerText.includes('out.txt')).querySelectorAll('.c-filecard-actions button').length`), 4)
    await evaluate(client, `[...document.querySelectorAll('.c-msg.assistant [data-file-cards] .c-filecard')].find(card => card.innerText.includes('out.txt')).querySelector('.c-filecard-main').click()`)
    await waitFor(async () => await evaluate(client, `(document.querySelector('[data-workbench]')?.innerText || '').includes('APPROVED-CONTENT')`), 30000)
    const journal = JSON.parse(await fs.readFile(path.join(root, 'najd-data', 'actions.json'), 'utf8'))
    assert.deepEqual(journal.actions.map(item => item.state).sort(), ['COMPLETED', 'COMPLETED', 'DENIED'], 'the showcase write (approved), the denied and the approved fixture writes')

    // Continue from where it stopped (original improvement): a run stopped at its approval offers Continue; the continued run tells the
    // model what the stopped attempt had done, and finishes after approval.
    await send('workspace write fixture: write the file using the terminal command if needed')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-approval]")'), 60000)
    await pressText('.a-box', 'Stop')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-continue]")'), 30000)
    await press('[data-continue]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-approval]")'), 60000)
    await pressText('[data-approval]', 'Allow once')
    await replied('resumed with the earlier steps')


    // Usage on the right: the header shows the conversation's tokens; the panel lists totals from the receipts and the tools by name.
    // The fixture subscription reports no token counts, so the totals read "—" (never 0) while calls and tools are counted.
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-usage-toggle]")'), 30000)
    if (!await evaluate(client, '!!document.querySelector("[data-usage]")')) await press('[data-usage-toggle]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-usage-total]")'), 30000)
    assert.equal(await evaluate(client, 'document.querySelector("[data-usage-total]").innerText.trim()'), '—')
    assert.ok((await evaluate(client, 'document.querySelector("[data-usage-toggle]").innerText')).includes('—'), 'unknown tokens are not shown as 0')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll("[data-usage-tools] li").length > 0'), 30000)
    const receipts = JSON.parse(await fs.readFile(path.join(root, 'najd-data', 'run-receipts.json'), 'utf8'))
    assert.ok(receipts.runs.some(run => Object.keys(run.tools || {}).length > 0), 'the receipts name the tools a run used')
    assert.ok((await evaluate(client, 'document.querySelector("[data-usage-tools]").innerText')).includes('كتابة ملف'), 'the panel names the tool the approved write used')

    // Export: the stubbed save dialog names a fixture file; a second export refuses to overwrite it and says so.
    await waitFor(async () => !await evaluate(client, 'document.querySelector("[aria-label=\'تصدير المحادثة\']").disabled'))
    await press("[aria-label='تصدير المحادثة']")
    const exported = path.join(root, 'export-fixture.txt')
    await waitFor(async () => { try { return (await fs.readFile(exported, 'utf8')).includes('NAJD subscription test OK') } catch { return false } })
    await waitFor(async () => (await body()).includes('صُدّرت المحادثة'))
    await press("[aria-label='تصدير المحادثة']")
    await waitFor(async () => (await body()).includes('يوجد ملف بهذا الاسم'))

    // Rename (R-083): the pencil opens an inline field; Enter saves the new title to disk and the list shows it.
    await evaluate(client, `document.querySelector('.n-session [data-session-rename]').click()`)
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-rename-input]")'))
    await evaluate(client, `(() => { const i = document.querySelector('[data-rename-input]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'تقرير نجد'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
    await waitFor(async () => (await evaluate(client, `document.querySelector('.n-session bdi')?.textContent || ''`)) === 'تقرير نجد')
    assert.equal(JSON.parse(await fs.readFile(sessionsFile, 'utf8')).sessions[0].title, 'تقرير نجد')

    // Pinning (R-083): a pinned conversation shows as pinned and stays first in the list after a restart.
    await evaluate(client, `document.querySelector('.n-session [data-session-pin]').click()`)
    await waitFor(async () => await evaluate(client, `document.querySelector('.n-session [data-session-pin]')?.getAttribute('aria-pressed') === 'true'`))
    assert.equal(JSON.parse(await evaluate(client, `localStorage.getItem('najd.pinned-chats.v1')`)).length, 1)

    // Export as PDF and Markdown (R-083): a real PDF and a Markdown file with the conversation, never overwriting.
    for (const [ext, check] of [['.pdf', bytes => bytes.subarray(0, 4).toString() === '%PDF' && bytes.length > 2000], ['.md', bytes => bytes.toString('utf8').startsWith('# ') && bytes.toString('utf8').includes('NAJD subscription test OK')]]) {
      await fs.writeFile(path.join(root, 'export-ext.txt'), ext)
      await press("[aria-label='تصدير المحادثة']")
      await waitFor(async () => { try { return check(await fs.readFile(path.join(root, 'export-fixture' + ext))) } catch { return false } }, 60000)
      await waitFor(async () => (await body()).includes(ext === '.pdf' ? 'إلى ملف PDF' : 'إلى ملف Markdown'))
    }
    await fs.rm(path.join(root, 'export-ext.txt'))

    // Search reads the saved text, not only titles, and shows where it matched.
    await press('.n-label-act[aria-label="بحث"]')
    await type('.w-search input', 'subscription test')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".n-session").length === 1 && (document.querySelector(".n-snippet")?.textContent || "").includes("subscription test")'))
    await evaluate(client, `(() => { const i = document.querySelector('.w-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await waitFor(async () => await evaluate(client, '!document.querySelector(".n-snippet")'))

    // Find in this conversation (R-083): Ctrl+F opens the bar, matches are counted and highlighted, Esc closes it.
    await press('.n-session .n-row')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".c-msg").length > 2'), 30000)
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', modifiers: 2, windowsVirtualKeyCode: 70 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', modifiers: 2, windowsVirtualKeyCode: 70 })
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-find] input")'))
    await type('[data-find] input', 'fixture')
    await waitFor(async () => /^1 \/ \d+$/.test(await evaluate(client, 'document.querySelector("[data-find-count]")?.textContent.trim() || ""')))
    assert.ok(await evaluate(client, 'CSS.highlights.has("najd-find-current")'), 'the current match is highlighted')
    await evaluate(client, `document.querySelector('[data-find] button:last-child').click()`)
    await waitFor(async () => await evaluate(client, '!document.querySelector("[data-find]") && !CSS.highlights.has("najd-find-current")'))

    // Branch from here (R-083): a new conversation with what came before, the message in the composer; the original stays.
    await press('.n-session .n-row')
    await waitFor(async () => await evaluate(client, `document.querySelectorAll('.c-msg.user [data-branch], .c-msg.user ~ .c-msg [data-branch]').length > 0 || document.querySelectorAll('[data-branch]').length > 0`), 30000)
    const originalCount = JSON.parse(await fs.readFile(sessionsFile, 'utf8')).sessions[0].messages.length
    const branchText = await evaluate(client, `(() => { const button = document.querySelectorAll('[data-branch]')[0]; const text = button.closest('.c-msg').querySelector('.c-body').innerText; button.click(); return text })()`)
    await waitFor(async () => (await evaluate(client, 'document.querySelector("#prompt")?.value || ""')) === branchText.trim() || (await evaluate(client, 'document.querySelector("#prompt")?.value || ""')) === branchText, 30000)
    const stored = JSON.parse(await fs.readFile(sessionsFile, 'utf8')).sessions
    assert.equal(stored.length, 2, 'the branch is a new conversation')
    assert.ok(stored.some(session => session.messages.length === originalCount), 'the original conversation is unchanged')
    await press('.n-session.on [data-session-delete]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-confirm-dialog]")'))
    await press('[data-confirm=ok]')
    await waitFor(async () => JSON.parse(await fs.readFile(sessionsFile, 'utf8')).sessions.length === 1)
    await evaluate(client, `(() => { const p = document.querySelector('#prompt'); if (p) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(p, ''); p.dispatchEvent(new Event('input', { bubbles: true })) } })()`)

    // Restart: the conversation, the chosen provider and both verified connections remain.
    await stop(instance)
    instance = await launch(root)
    client = instance.client
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".n-session").length === 1'), 30000)
    assert.equal(await evaluate(client, 'localStorage.getItem("najd.provider.v1")'), 'chatgpt')
    assert.equal(await evaluate(client, `document.querySelector('.n-session [data-session-pin]')?.getAttribute('aria-pressed')`), 'true', 'the pin survives a restart')
    const catalog = await value('window.najdProviders.catalog()')
    assert.equal(catalog.find(item => item.id === 'openai-api').verified, true)
    assert.equal(catalog.find(item => item.id === 'chatgpt').verified, true)
    await press('.n-session .n-row')
    await replied('NAJD subscription test OK')

    // Skills: a card opens its details, the built-in guide is shown, and Use puts the skill's name and id in the composer.
    await press('[data-nav="skills-plugins"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-hub-tab=skill]")'))
    await press('[data-hub-tab=skill]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-entry=najd-humanizer]")'))
    assert.equal(await evaluate(client, 'document.querySelector("[data-entry=najd-humanizer]").dataset.state'), 'AVAILABLE', 'built-in skills are ready when their checks pass')
    await press('[data-entry=najd-humanizer]')
    await press('[data-details-guide]')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-details-guide-text]")?.textContent || ""')).includes('# Humanizer') && !(await evaluate(client, 'document.querySelector("[data-details-guide-text]").textContent')).includes('name: najd-humanizer'))
    await press('[data-details-use]')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("#prompt")?.value || ""')).includes('(najd-humanizer)'))
    // A saved personal skill is edited in place (original improvement): purpose and steps, saved as the next version, with Roll back.
    await press('[data-nav="skills-plugins"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-hub-tab=skill]")'))
    await press('[data-hub-tab=skill]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-entry=my-monthly-budget]")'))
    await press('[data-entry=my-monthly-budget]')
    await press('[data-skill-edit-open]')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-skill-edit-steps]")?.value || ""')).startsWith('1. Ask for income and expenses.'))
    assert.equal(await evaluate(client, 'document.querySelector("[data-skill-edit-steps]").value'), '1. Ask for income and expenses.\n2. Write the workbook with najd_python_run.', 'the saved steps, without the name heading')
    assert.equal(await evaluate(client, 'document.querySelector("[data-skill-edit-description]").value'), 'Use when the user wants a monthly budget workbook.')
    await evaluate(client, `(() => { const box = document.querySelector('[data-skill-edit-steps]'); box.value = box.value + '\\n3. Add a chart of the expenses.'; box.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await press('[data-skill-edit-save]')
    await waitFor(async () => !(await evaluate(client, '!!document.querySelector("[data-skill-edit]")')))
    const awaited = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error('rejected'); return result.result.value }
    const edited = await awaited('window.najdWorkstation.skillEditable("my-monthly-budget")')
    assert.equal(edited.version, '1.0.1', 'saved as the next version')
    assert.equal(edited.steps, '1. Ask for income and expenses.\n2. Write the workbook with najd_python_run.\n3. Add a chart of the expenses.', 'the edited steps are saved')
    assert.equal(edited.name, 'Monthly budget', 'the name stays')
    await evaluate(client, 'document.querySelector("[data-details-close]")?.click()')
    await assert.rejects(awaited('window.najdWorkstation.skillEditable("najd-humanizer")'), /rejected/, 'only a personal skill can be edited')

    // Delete asks first; declining keeps the conversation, confirming removes it from the rail and from disk.
    // The app's own confirmation (not a system box): Cancel keeps the conversation, Delete removes it.
    await press('[data-session-delete]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-confirm-dialog]")'))
    await press('[data-confirm=cancel]')
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(await evaluate(client, 'document.querySelectorAll(".n-session").length'), 1)
    await press('[data-session-delete]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-confirm-dialog]")'))
    await press('[data-confirm=ok]')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".n-session").length === 0'))
    assert.deepEqual(JSON.parse(await fs.readFile(sessionsFile, 'utf8')).sessions, [])
    console.log(`PASS${packaged ? ' (packaged)' : ''}: Vue desktop flows: engine status, API key never stored in clear, ChatGPT sign-in, model tests, saved conversation, attached picture thumbnails, full thinking on click, backup model on failure, read aloud, retry with another model, save as a skill, run receipt, my prompts, continue a stopped run, rename, pinned conversations, branch from a message, find in conversation, approval deny/allow with journal, export without overwrite, PDF and Markdown export, full-text search, restart, delete; file cards with in-app preview; usage panel (calls, tools by name, unknown tokens as —); skill details, guide and Use.`)
  } catch (error) {
    if (instance && instance.process.exitCode === null) console.error('UI state at failure:', await evaluate(instance.client, '(document.querySelector("[data-setup]") || document.querySelector("[data-approval]") || document.querySelector(".ws-main") || document.body).innerText.slice(0, 1500)').catch(() => null))
    throw error
  } finally {
    if (instance && instance.process.exitCode === null) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(root + '-documents', { recursive: true, force: true })
    await fs.rm(root + '-imports', { recursive: true, force: true }).catch(() => {})
  }
}

let completed = false
process.once('beforeExit', () => { if (!completed) { console.error('Desktop flows smoke did not reach completion'); process.exitCode = 1 } })
main().then(() => { completed = true }, error => { completed = true; console.error(error); process.exitCode = 1 })
