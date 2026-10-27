// Model unions in the real desktop app (isolated profile): add a preset, choose an aggregator, save, reload, and see the preset as a model of "Model union".
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    await run(`window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY')`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
    await click(client, '.sidebar-link[aria-label]')
    await click(client, '.settings-nav-item:nth-child(2)')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-union]")'))
    const setValue = (selector, value) => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true })()`)
    // An Arabic name (the owner's case): kept as the label, with an English id for the model list.
    await setValue('[data-union] .union-new input', 'فريق الكتابة')
    await click(client, '[data-action="union-add"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-union] .union-pick")'))
    // aggregator: the OpenAI connection and one of its models
    await run(`(() => { const select = document.querySelectorAll('[data-union] .union-pick select')[0]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'openai-api'); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll("[data-union] .union-pick select")[1].options.length > 1'))
    const model = await run(`document.querySelectorAll('[data-union] .union-pick select')[1].options[1].value`)
    await run(`(() => { const select = document.querySelectorAll('[data-union] .union-pick select')[1]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(model)}); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    // One reference model as well (its own frame, with enabled and remove).
    await click(client, '[data-action="union-add-reference"]')
    await run(`(() => { const select = document.querySelector('[data-union] .union-row .union-pick select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'openai-api'); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll("[data-union] .union-row .union-pick select")[1].options.length > 1'))
    await run(`(() => { const select = document.querySelectorAll('[data-union] .union-row .union-pick select')[1]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(model)}); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await click(client, '[data-action="union-save"]')
    await waitFor(async () => (await run('window.najdUnions.get()')).presets['union-1']?.aggregator?.model === model)
    const saved = await run('window.najdUnions.get()')
    assert.equal(saved.default, 'union-1'); assert.equal(saved.presets['union-1'].label, 'فريق الكتابة'); assert.equal(saved.presets['union-1'].references.length, 1)
    assert.equal(await evaluate(client, '!!document.querySelector("[data-union] [role=alert]")'), false, 'no save error')
    if (process.env.NAJD_SHOT) { await run(`document.querySelector('[data-union]').scrollIntoView({ block: 'start' })`); await new Promise(resolve => setTimeout(resolve, 300)); await fs.writeFile(process.env.NAJD_SHOT, Buffer.from((await client.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')) }
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
    await waitFor(async () => (await run('window.najdProviders.models("union")')).some(item => item.id === 'union-1' && item.label === 'فريق الكتابة'))
    const entry = (await run('window.najdProviders.catalog()')).find(item => item.id === 'union')
    assert.equal(entry.configured, true)
    console.log('PASS: a model union with an Arabic name was added in Settings, saved with its aggregator and a reference model, restored after reload and listed under its name as a model of "Model union".')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
