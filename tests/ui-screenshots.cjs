// Visual QA: real Electron app with an isolated profile; captures welcome, settings and an
// active conversation (fixture model) in Arabic and English at two window sizes.
//   node tests/ui-screenshots.cjs <output-folder>
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const output = path.resolve(process.argv[2] || 'release/qa-redesign')
  await fs.mkdir(output, { recursive: true })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value
    }
    const shot = async name => {
      await new Promise(r => setTimeout(r, 700))
      const image = await client.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(output, name + '.png'), Buffer.from(image.data, 'base64'))
    }
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    for (const [width, height] of [[1440, 900], [1000, 700]]) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      for (const language of ['ar', 'en']) {
        const theme = process.env.NAJD_QA_THEME
        await run(`(()=>{const p=JSON.parse(localStorage.getItem('najd.preferences.v1')||'{}');localStorage.setItem('najd.preferences.v1',JSON.stringify({...p,language:${JSON.stringify(language)}${theme ? `,theme:${JSON.stringify(theme)}` : ''}}));return true})()`)
        await client.send('Page.reload')
        await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
        if (await evaluate(client, '!!document.querySelector(".message")')) await click(client, '.rail-new')
        await waitFor(async () => await evaluate(client, '!!document.querySelector(".welcome")'))
        await shot(`${language}-${width}-welcome`)
        if (!(await run('window.najdSessions.list()')).length) {
          await click(client, '#prompt')
          await client.send('Input.insertText', { text: 'Explain NAJD in two short paragraphs with a list and code' })
          await click(client, '.send-button')
          await waitFor(async () => await evaluate(client, '!!document.querySelector(".message.assistant")'), 60000)
        } else await click(client, '.session-open')
        await waitFor(async () => await evaluate(client, '!!document.querySelector(".message.assistant")'), 20000)
        await shot(`${language}-${width}-conversation`)
        await click(client, `.rail-settings, .sidebar-link[aria-label="${language === 'ar' ? 'الإعدادات' : 'Settings'}"]`)
        await waitFor(async () => await evaluate(client, '!!document.querySelector(".settings-nav")'))
        await shot(`${language}-${width}-settings`)
        await click(client, '.settings-nav-item:nth-child(2)')
        await shot(`${language}-${width}-settings-models`)
      }
    }
    console.log('Screenshots written to', output)
  } finally {
    if (instance) await stop(instance)
    await fs.rm(root, { recursive: true, force: true }).catch(() => {}); await fs.rm(root + '-documents', { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
