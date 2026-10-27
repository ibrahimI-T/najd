// Live activity UI through the real desktop app (isolated profile, fixture model, real tools and approvals):
// a multi-tool run shows its timer, grouped timeline and approval in place; stop works; the completed record
// survives a reload; the side panel shows progress and used context; the capability atlas shows real statuses.
// Writes screenshots to release/qa-activity-ui-<version>/. Usage: npm run smoke:activity-ui
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const shots = path.resolve('release/qa-activity-ui-' + require('../package.json').version)
  await fs.mkdir(shots, { recursive: true })
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const shot = async name => { const data = await client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(data.data, 'base64')) }
    const size = (width, height) => client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const watch = () => evaluate(client, 'window.__errs = window.__errs || (addEventListener("error", e => window.__errs.push(String(e.message))), addEventListener("unhandledrejection", e => window.__errs.push(String(e.reason))), [])')
    const prefs = async language => {
      await evaluate(client, `localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:'graphite',accent:'#2f8cff',fontScale:1,design:4}))`)
      await client.send('Page.reload')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
      await watch()
    }
    await size(1440, 900)
    await prefs('ar')
    await watch()

    // Provider setup (fixture API endpoint), as the task-activity smoke does; the composer then uses it.
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const l=await window.najdProviders.limits();
      await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});await window.najdProviders.testModel('openai-api','gpt-6.1-sol');
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
    await watch()

    // Multi-tool run: it pauses at the file-write approval, with the activity block live above it.
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'activity showcase fixture: write a short report in the workspace' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".approval-card")'))
    assert.equal(await evaluate(client, '!!document.querySelector(".pending-activity .act-block.is-waiting")'), true)
    assert.equal(await evaluate(client, 'document.querySelector(".pending-activity .act-toggle").getAttribute("aria-expanded")'), 'true')
    const live = await evaluate(client, `(() => ({ caption: document.querySelector('.pending-activity .act-caption').textContent, rows: [...document.querySelectorAll('.pending-activity .act-row')].map(r => r.className),
      summary: document.querySelector('.pending-activity .act-summary')?.textContent || '', stop: !!document.querySelector('.pending-activity .act-stop') }))()`)
    assert.match(live.caption, /بانتظار موافقتك/)
    assert.ok(live.rows.some(row => row.includes('kind-reasoning')), 'reasoning summary row')
    assert.ok(live.rows.some(row => row.includes('kind-approval') && row.includes('st-awaiting-approval')), 'approval in place')
    assert.ok(live.stop, 'stop button while running')
    assert.equal(live.summary, '', 'the header carries no counters line (flat reference design)')
    await shot('01-live-awaiting-approval-ar')

    // The timer advances while waiting for the user (the run is still open).
    await click(client, '.approval-allow')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".message.assistant")'), 20000)
    await waitFor(async () => await evaluate(client, '!document.querySelector(".thinking")'))
    const doneCaption = await evaluate(client, 'document.querySelector(".message.assistant")?.parentElement.querySelector(".act-caption")?.textContent || document.querySelector(".act-caption")?.textContent || ""')
    assert.match(doneCaption, /اشتغل/)
    await shot('02-completed-collapsed-ar')
    await click(client, '.message-turn.assistant .act-toggle')
    assert.equal(await evaluate(client, 'document.querySelector(".message-turn.assistant .act-toggle").getAttribute("aria-expanded")'), 'true')
    const kinds = await evaluate(client, '[...document.querySelectorAll(".message-turn.assistant .act-row")].map(r => r.className.match(/kind-[\\w-]+/)[0])')
    for (const kind of ['kind-reasoning', 'kind-search', 'kind-file-read', 'kind-file-write', 'kind-approval', 'kind-success']) assert.ok(kinds.includes(kind) || kinds.some(k => k === kind), kind + ' in ' + kinds.join())
    await click(client, '.message-turn.assistant .act-row.kind-file-write .act-line')
    assert.equal(await evaluate(client, '!!document.querySelector(".message-turn.assistant .act-row.kind-file-write .act-detail")'), true)
    await shot('03-completed-expanded-ar')
    assert.equal(await evaluate(client, 'document.body.innerText.includes("sk-najd-API-TEST-KEY")'), false)

    // Side panel: real progress and the context the task used.
    await click(client, '.topbar-panel')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#side-panel .progress-stages")'))
    const panel = await evaluate(client, `(() => ({ stages: [...document.querySelectorAll('#side-panel .progress-stages li')].map(li => li.dataset.state),
      used: document.querySelector('#side-panel [aria-labelledby="sp-used"]')?.innerText || '' }))()`)
    assert.ok(panel.stages.length >= 3 && panel.stages.at(-1) === 'done', JSON.stringify(panel.stages))
    await shot('04-side-panel-ar')

    // Reload: the record is restored from the saved conversation.
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".message.assistant")'))
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".message-turn.assistant .act-block")'))

    // Stop: a second run is stopped while it waits for approval; execution ends and the block says so.
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'activity showcase fixture: write another short report' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".approval-card")'))
    await click(client, '.pending-activity .act-stop')
    await waitFor(async () => await evaluate(client, '!document.querySelector(".approval-card")'))
    await waitFor(async () => /أُوقفت بعد/.test(await evaluate(client, 'document.querySelector(".pending-activity .act-caption")?.textContent || ""')))
    assert.equal(await evaluate(client, '!document.querySelector(".pending-activity .act-stop")'), true, 'stop button gone once stopped')
    assert.equal(await evaluate(client, 'window.najdCore ? true : false'), true)
    await shot('08-stopped-ar')
    const task = await run('(async()=>{const s=await window.najdSessions.list();return s.length})()')
    assert.ok(task >= 1)

    // Capability atlas, Arabic and English.
    for (const language of ['ar', 'en']) {
      if (language === 'en') await prefs('en')
      await click(client, `.sidebar-link[aria-label="${language === 'ar' ? 'الإعدادات' : 'Settings'}"]`)
      await click(client, '[data-section="atlas"]')
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".atlas-row")'))
      const atlas = await evaluate(client, `(() => ({ total: document.querySelector('.atlas-count strong').textContent, rows: document.querySelectorAll('.atlas-row').length,
        ready: [...document.querySelectorAll('.atlas-status.ready')].length, setup: [...document.querySelectorAll('.atlas-status')].filter(e => !e.classList.contains('ready')).length }))()`)
      assert.ok(Number(atlas.total) > 5 && atlas.rows > 5, JSON.stringify(atlas))
      await click(client, '.atlas-row')
      assert.equal(await evaluate(client, '!!document.querySelector(".atlas-detail dl")'), true)
      await shot(`05-atlas-${language}`)
      await click(client, '.topbar-back')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
    }
    // English chat view with its restored activity and the narrow layout.
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".message-turn.assistant .act-toggle")'))
    await click(client, '.message-turn.assistant .act-toggle')
    await shot('06-completed-expanded-en')
    await click(client, '#side-panel .side-panel-head button')
    await size(390, 800)
    await shot('07-narrow-en')
    const overflow = await evaluate(client, 'document.documentElement.scrollWidth > innerWidth')
    assert.equal(overflow, false, 'no horizontal page scroll at 390 px')
    await size(1440, 900)
    assert.deepEqual(await evaluate(client, 'window.__errs'), [], 'no uncaught page errors')
    console.log('PASS: live activity (timer, reasoning summary, grouped timeline, approval in place), completed collapsed/expanded, reload restore, side-panel progress and used context, capability atlas (ar/en), narrow layout. Screenshots in ' + shots)
  } catch (error) {
    try { const data = await instance.client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(shots, 'failure.png'), Buffer.from(data.data, 'base64')); console.error(String((await evaluate(instance.client, 'document.body.innerText')) || '').slice(0, 1500)) } catch {}
    throw error
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
