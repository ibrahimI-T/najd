const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { launch, stop, click, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    let client = instance.client
    const exists = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    async function page() {
      if (!await exists('.settings-nav')) await click(client, '.sidebar-link[aria-label]')
      await click(client, '.settings-nav-item:nth-child(8)')
      await waitFor(() => exists('[data-learning=mode]'))
    }
    async function mode(value) {
      await waitFor(async () => !await evaluate(client, 'document.querySelector("[data-learning=mode]").disabled'))
      await evaluate(client, `(() => {const e=document.querySelector('[data-learning=mode]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      await waitFor(async () => await evaluate(client, `document.querySelector('[data-learning=mode]').value===${JSON.stringify(value)} && !document.querySelector('[data-learning=mode]').disabled`))
    }
    async function act(selector) {
      await waitFor(async () => await exists(selector) && !await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).disabled`))
      await click(client, selector)
    }
    async function chat(text) {
      const result = await client.send('Runtime.evaluate', { expression: `(async () => {
        const before=(await window.najdProviders.limits()).cloudAttempts;
        let task=await window.najdCore.startTask(${JSON.stringify(text)},crypto.randomUUID(),'openai-api','gpt-6.1-sol',undefined,'low');
        for(let i=0;i<200&&['QUEUED','RUNNING'].includes(task.state);i++){await new Promise(resolve=>setTimeout(resolve,50));task=await window.najdCore.getTask(task.id)}
        await new Promise(resolve=>setTimeout(resolve,100));
        return {state:task.state,output:task.output,code:task.errorCode,attempts:(await window.najdProviders.limits()).cloudAttempts-before};
      })()`, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      assert.deepEqual(result.result.value, { state: 'COMPLETED', output: 'NAJD API test OK', code: null, attempts: 1 })
    }
    const pref = '[data-learning-kind=preference]', lesson = '[data-learning-kind=experience]'
    const approved = kind => `${kind} [data-learning-status=approved]`
    const pending = kind => `${kind} [data-learning-status=pending]`
    await waitFor(() => exists('.sidebar-link[aria-label="الإعدادات"]'))
    const setup = await client.send('Runtime.evaluate', { expression: `(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const {policy}=await window.najdProviders.limits();await window.najdProviders.setLimits({...policy,maxOutputTokens:1024,maxCloudAttempts:30})})()`, awaitPromise: true })
    assert.equal(setup.exceptionDetails, undefined)
    // Local learning is on by default (owner directive 2026-10-17).
    await page(); assert.equal(await evaluate(client, 'document.querySelector("[data-learning=mode]").value'), 'preferences')
    await mode('preferences')
    await chat('I prefer concise answers.')
    await waitFor(() => exists(`${approved(pref)} .learning-note`))
    assert.equal(await exists(`${pending(pref)} .learning-note`), false)
    assert.ok((await evaluate(client, `document.querySelector('${approved(pref)}').textContent`)).includes('I prefer concise answers.'))
    // Sharing approved preferences with the selected model is on by default.
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-learning=share]").checked && !document.querySelector("[data-learning=share]").disabled'))
    await chat('Explain one simple idea: learned preference proof')
    console.log('PASS: opt-in local capture saves a literal explicit preference; selected context receives only approved shared preferences.')

    await mode('review')
    await chat('I prefer detailed answers.')
    await waitFor(() => exists(`${pending(pref)} [data-learning=accept]`))
    await act(`${pending(pref)} [data-learning=accept]`)
    await waitFor(async () => await evaluate(client, `document.querySelectorAll('${approved(pref)} .learning-note').length===2`))
    await act(`${approved(pref)} .learning-note:last-child [data-learning=edit]`)
    await act('[data-learning=edit-text]')
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await client.send('Input.insertText', { text: 'I prefer balanced answers.' })
    await act('[data-learning=save-edit]')
    await waitFor(async () => (await evaluate(client, `document.querySelector('${approved(pref)}').textContent`)).includes('I prefer balanced answers.'))
    await chat('Explain one simple idea: corrected memory proof')
    await chat('Workflow lesson: verify results.')
    await waitFor(() => exists(`${pending(lesson)} [data-learning=accept]`))
    assert.equal(await exists(`${approved(lesson)} .learning-note`), false)
    await act(`${pending(lesson)} [data-learning=accept]`)
    await waitFor(() => exists(`${approved(lesson)} .learning-note`))
    // Lesson sharing is on by default; switch it off to prove private lessons stay out of requests.
    await act('[data-learning=share-experiences]')
    await waitFor(async () => await evaluate(client, '!document.querySelector("[data-learning=share-experiences]").checked && !document.querySelector("[data-learning=share-experiences]").disabled'))
    await chat('Verify results: lesson private proof')
    await act('[data-learning=share-experiences]')
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-learning=share-experiences]").checked && !document.querySelector("[data-learning=share-experiences]").disabled'))
    await chat('Verify results: lesson shared proof')
    await chat('Explain a cooking recipe: unrelated lesson proof')
    console.log('PASS: correction and distinct workflow knowledge; lesson context requires approval, separate consent and matching request words; one model attempt per foreground turn.')

    await act(`${pref} > .browser-actions [data-learning=export]`)
    await waitFor(async () => { try { await fs.access(path.join(root,'najd-learning-preference.json'));return true } catch {return false} })
    const backup = await fs.readFile(path.join(root, 'najd-learning-preference.json'), 'utf8')
    assert.equal(JSON.parse(backup).notes.length, 2)
    while (await exists(`${approved(pref)} [data-learning=remove]`)) {
      const count = await evaluate(client, `document.querySelectorAll('${approved(pref)} .learning-note').length`)
      await act(`${approved(pref)} [data-learning=remove]`)
      await waitFor(async () => await evaluate(client, `document.querySelectorAll('${approved(pref)} .learning-note').length<${count}`))
    }
    await act(`${pref} > .browser-actions [data-learning=import]`)
    await waitFor(async () => await evaluate(client, `document.querySelectorAll('${approved(pref)} .learning-note').length===2`))
    await stop(instance); instance = null
    instance = await launch(root); client = instance.client
    await waitFor(() => exists('.sidebar-link[aria-label="الإعدادات"]')); await page()
    assert.equal(await evaluate(client, 'document.querySelector("[data-learning=mode]").value'), 'review')
    assert.equal(await evaluate(client, `document.querySelectorAll('${approved(pref)} .learning-note').length`), 2)
    assert.equal(await evaluate(client, 'document.querySelector("[data-learning=share-experiences]").checked'), true)
    await act('[data-learning=share-experiences]')
    await waitFor(async () => await evaluate(client, '!document.querySelector("[data-learning=share-experiences]").checked && !document.querySelector("[data-learning=share-experiences]").disabled'))
    await act('[data-learning=share]')
    await waitFor(async () => !await evaluate(client, 'document.querySelector("[data-learning=share]").checked || document.querySelector("[data-learning=share]").disabled'))
    await chat('Explain one simple idea: disabled learned proof')
    await mode('off')
    console.log('PASS: learned backup/restore/restart; disabling sharing removes preferences from subsequent requests.')

    const output = path.resolve(__dirname, '../release/qa-learning'); await fs.mkdir(output,{recursive:true})
    for (const language of ['ar','en']) {
      await click(client,'.settings-nav-item:first-child')
      await click(client,`.settings-group .setting-row:first-child .segmented button:${language==='ar'?'first':'last'}-child`)
      for (const width of [360,480,768,1024,1440]) {
        await client.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
        await waitFor(async()=>await evaluate(client,`(innerWidth<=680?document.querySelector('.sidebar').getBoundingClientRect().width===0&&Math.abs(document.querySelector('.app-rail').getBoundingClientRect().width-56)<1:Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-(innerWidth<=1100?228:264))<1)`))
        await page()
        assert.equal(await evaluate(client,`['html','.settings-scroll','.settings-panel'].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1})`),true,`${language}/${width} learning overflow`)
        if ([360,1440].includes(width)) {
          await evaluate(client,'document.querySelector(".learning-panel").scrollIntoView({block:"start"})')
          const capture = await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
          await fs.writeFile(path.join(output,`${language}-${width}.png`),Buffer.from(capture.data,'base64'))
        }
      }
    }
    await client.send('Emulation.clearDeviceMetricsOverride')
    console.log('PASS: bilingual five-width learning management UI with actual fixture screenshots.')
  } catch (error) {
    if (instance) {
      try { const diagnostic=await instance.client.send('Runtime.evaluate',{expression:'window.najdLearning.list()',awaitPromise:true,returnByValue:true});console.error('Learning fixture diagnostic: '+JSON.stringify(diagnostic.result.value)) } catch {}
    }
    throw error
  } finally {
    if (instance && instance.process.exitCode === null) await stop(instance)
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.match(path.basename(root),/^najd-desktop-test-/)
    await fs.rm(root,{recursive:true,force:true})
  }
}
let completed=false
process.once('beforeExit',()=>{if(!completed){console.error('Learning UI smoke incomplete');process.exitCode=1}})
main().then(()=>{completed=true},error=>{completed=true;console.error(error);process.exitCode=1})
