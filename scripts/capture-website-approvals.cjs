// Capture the real approval UI for the bilingual public website, using only an isolated test profile.
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, evaluate, click, waitFor } = require('../tests/electron-ui-smoke.cjs')

async function capture(language) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const output = path.resolve('release/qa-website-approvals')
  await fs.mkdir(output, { recursive: true })
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await run(`localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:'graphite',accent:'#2f8cff',fontScale:1,design:4}))`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});await window.najdProviders.testModel('openai-api','gpt-6.1-sol');localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'activity showcase fixture: write a short report in the workspace' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".approval-card")'))
    const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await fs.writeFile(path.join(output, `approval-${language}.png`), Buffer.from(image.data, 'base64'))
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw new Error('Unsafe cleanup')
    for (const directory of [resolved, resolved + '-documents']) await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}

async function main() {
  await capture('ar')
  await capture('en')
  console.log('PASS: bilingual approval screenshots captured in release/qa-website-approvals')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
