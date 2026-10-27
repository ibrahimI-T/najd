// Settings > Accounts through the real desktop app (isolated profile) and the real Windows Credential Manager with a TEST account:
// add, list, auto sign-in switch, revoke with confirmation. The password must not reach the page, the accounts file or any IPC result,
// and revoking must delete it from Credential Manager. Usage: npm run smoke:accounts-ui
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')
const { createWindowsCredentialStore } = require('../electron/windows-credential-store.cjs')

const PASSWORD = 'Smoke-Test-pw-4471'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const shots = path.resolve('release/qa-accounts-' + require('../package.json').version)
  await fs.mkdir(shots, { recursive: true })
  let instance, accountId = null
  const store = createWindowsCredentialStore()
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const shot = async name => { const data = await client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(data.data, 'base64')) }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const language of ['ar', 'en']) {
      await run(`localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:'graphite',accent:'#2f8cff',fontScale:1,design:4}))`)
      await client.send('Page.reload')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
      await click(client, `.sidebar-link[aria-label="${language === 'ar' ? 'الإعدادات' : 'Settings'}"]`)
      await click(client, '[data-section="accounts"]')
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".accounts-form")'))
      if (language === 'en') continue
      // Add a test account through the form like a user would.
      const fill = (selector, value) => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await fill('.accounts-form label:nth-of-type(1) input', 'Smoke test account')
      await fill('.accounts-form label:nth-of-type(2) input', 'https://smoke-test.example.com')
      await fill('.accounts-form label:nth-of-type(3) input', 'smoke@example.com')
      await fill('.accounts-form input[type=password]', PASSWORD)
      await click(client, '.accounts-save')
      await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".accounts-list li").length === 1'))
      assert.equal(await evaluate(client, 'document.querySelector(".accounts-form input[type=password]").value'), '', 'the password field is cleared after saving')
      const page = await evaluate(client, 'document.body.innerText + document.documentElement.innerHTML')
      assert.ok(!page.includes(PASSWORD), 'the password never appears in the page')
      const listed = await run('window.najdAccounts.list()')
      accountId = listed[0].id
      assert.ok(!JSON.stringify(listed).includes(PASSWORD))
      const file = await fs.readFile(path.join(root, 'najd-data', 'accounts', 'accounts.json'), 'utf8')
      assert.ok(!file.includes(PASSWORD), 'the password is not in the accounts file')
      const saved = await store.read('NAJD AGENT/account/' + accountId)
      assert.equal(saved?.secret, PASSWORD, 'the password is in Windows Credential Manager')
      await shot('01-accounts-ar')
      // Auto sign-in switch.
      await click(client, '.accounts-list input[type=checkbox]')
      await waitFor(async () => (await run('window.najdAccounts.list()'))[0].autoLogin === true)
      // Revoke with confirmation: the account and the saved password are gone.
      await click(client, '.accounts-remove')
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".accounts-confirm .danger")'))
      await shot('02-accounts-confirm-ar')
      await click(client, '.accounts-confirm .danger')
      await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".accounts-list li").length === 0'))
      assert.equal(await store.read('NAJD AGENT/account/' + accountId), null, 'revoking deleted the saved password')
      accountId = null
      assert.deepEqual(await run('window.najdAccounts.list()'), [])
    }
    await shot('03-accounts-en')
    console.log('PASS: Settings > Accounts (ar/en): add with a real Credential Manager entry, no password in page, IPC or file, auto sign-in switch, revoke deletes the password. Screenshots in ' + shots)
  } finally {
    if (accountId) await store.remove('NAJD AGENT/account/' + accountId).catch(() => {})
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
