// The memory map in the real desktop app (isolated profile): saved notes appear as stars joined to the soul and to each
// other, a note added while the page is open appears as a new star, a star opens an editor that saves, and the tool map
// and the context-use tab render.
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
    await run(`window.najdMemory.save({ title: 'Build rule', text: 'Run npm.cmd test before the build of the project in package.json' })`)
    await run(`window.najdMemory.save({ title: 'Release rule', text: 'Before a release update package.json and run the smoke tests' })`)
    await click(client, '.sidebar-link[aria-label]')
    await click(client, '.settings-nav-item[data-section=memory]')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".graph-svg .graph-node").length > 3'), 20000)
    const counts = await run(`({ notes: document.querySelectorAll('.graph-node.note').length, soul: document.querySelectorAll('.graph-node.soul').length, sections: document.querySelectorAll('.graph-node.section').length,
      stars: document.querySelectorAll('.graph-node.topic').length, edges: document.querySelectorAll('.graph-edge').length })`)
    assert.equal(counts.notes, 2); assert.equal(counts.soul, 1); assert.ok(counts.sections >= 8); assert.ok(counts.stars >= 1, 'package.json joins the two notes'); assert.ok(counts.edges >= 10)
    // The map turns and zooms like a globe: the wheel zooms, a drag turns it, the buttons turn it left and right.
    const camera = () => run(`(() => { const s = document.querySelector('.graph-svg'); return { yaw: Number(s.dataset.yaw), zoom: Number(s.dataset.zoom) } })()`)
    const before = await camera()
    await run(`document.querySelector('.graph-svg').dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }))`)
    await waitFor(async () => (await camera()).zoom > before.zoom + 0.2, 8000)
    const turned = await camera()
    await run(`(() => { const s = document.querySelector('.graph-svg'); const at = (type, x) => s.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 200, bubbles: true, isPrimary: true }))
      at('pointerdown', 300); at('pointermove', 340); at('pointermove', 420); at('pointermove', 520); at('pointerup', 520) })()`)
    await waitFor(async () => Math.abs((await camera()).yaw - turned.yaw) > 0.3, 8000)
    const dragged = await camera()
    await click(client, '[data-graph-tool=right]')
    await waitFor(async () => Math.abs((await camera()).yaw - dragged.yaw) > 0.05, 8000)
    await click(client, '[data-graph-tool=reset]')
    await waitFor(async () => { const c = await camera(); return Math.abs(c.zoom - 1.35) < 0.05 }, 8000)
    // A memory saved while the page is open appears by itself, marked as new.
    await run(`window.najdMemory.save({ title: 'Telegram', text: 'The Telegram bot needs a BotFather token' })`)
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".graph-node.note").length === 3'), 15000)
    assert.ok(await run(`!!document.querySelector('.graph-node.note.new')`), 'the new star glows')
    // Clicking a star opens its editor, with the full text, and saving changes it.
    await run(`document.querySelector('.graph-node.note').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-graph=title]")'), 10000)
    await run(`(() => { const e = document.querySelector('[data-graph=title]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, 'Edited from the map'); e.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await click(client, '[data-graph=save]')
    await waitFor(async () => (await run(`window.najdMemory.list().then(list => list.some(note => note.title === 'Edited from the map'))`)) === true, 10000)
    // The tool map and the context-use tab.
    await click(client, '[data-graph-tab=tools]')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".graph-svg .graph-node.toolset, .graph-svg .graph-node.start").length > 10'), 10000)
    assert.ok(await run(`document.querySelectorAll('.graph-node.start').length >= 3`), 'the lean start is highlighted')
    assert.ok(await run(`document.querySelectorAll('.graph-node.idle').length >= 1`), 'a group that is not connected is dimmed, even when a lean run would start with it')
    await click(client, '[data-graph-tab=usage]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".graph-usage, .graph-card .browser-note")'), 10000)
    console.log('PASS: memory map (3D, turns and zooms) shows notes, shared stars and the soul, a new memory appears live and glows, a star edits its note, and the tool map and context-use tabs render.')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
