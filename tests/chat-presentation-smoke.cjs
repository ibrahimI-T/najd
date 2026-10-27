const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const {launch, stop, evaluate, click, waitFor} = require('./electron-ui-smoke.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const screenshots = path.resolve('release/qa-chat-' + require('../package.json').version)
  await fs.mkdir(screenshots,{recursive:true})
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    async function run(expression) {
      const result = await client.send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true})
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const markdown = '**Fixture answer**\n\n- First\n- Second\n\n```html\n<div dir="rtl">NAJD fixture</div>\n```\n\n```prompt\nاكتب برومبت تجريبي\n```\n\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n\n| Name | Value |\n| --- | --- |\n| Test | OK |\n\n' + 'Long fixture paragraph for scrolling.\n\n'.repeat(35)
    await run(`(async()=>{const s=await window.najdSessions.create();await window.najdSessions.append(s.id,'user','Presentation fixture');await window.najdSessions.append(s.id,'assistant',${JSON.stringify(markdown)});return s.id})()`)
    for (const language of ['ar','en']) {
      await run(`localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:'dark',accent:'#467de7',fontScale:1}))`)
      await client.send('Page.reload')
      await waitFor(async()=>await evaluate(client,'!!document.querySelector(".code-block")'))
      await waitFor(async()=>await evaluate(client,'(()=>{const e=document.querySelector(".chat-scroll");return e.scrollHeight-e.scrollTop-e.clientHeight<80})()'))
      assert.equal(await evaluate(client,'document.querySelector(".message-brand").textContent'),'NAJD')
      assert.equal(await evaluate(client,'(()=>{const s=getComputedStyle(document.querySelector(".message.assistant"));return s.backgroundColor==="rgba(0, 0, 0, 0)"&&s.borderTopWidth==="0px"})()'),true)
      assert.equal(await evaluate(client,'!!document.querySelector(".message-body strong") && !!document.querySelector(".message-body table")'),true)
      assert.equal(await evaluate(client,'document.querySelector(".code-block").dir'),'ltr')
      // Prompts are a copy box; a Mermaid diagram is drawn as an image; Run opens an HTML block in the isolated canvas.
      assert.equal(await evaluate(client,'!!document.querySelector(".prompt-block [data-block=copy]") && document.querySelector(".prompt-text").dir === "auto"'),true)
      await waitFor(async()=>await evaluate(client,'!!document.querySelector(".code-block[data-lang=mermaid] img[src^=\\"data:image/svg+xml\\"]")'))
      await evaluate(client,'document.querySelector(".code-block[data-lang=html] [data-block=run]").click()')
      await waitFor(async()=>await evaluate(client,'document.querySelector(".canvas-panel iframe")?.getAttribute("sandbox") === "allow-scripts"'))
      await evaluate(client,'document.querySelector("[data-canvas=close]").click()')
      await waitFor(async()=>await evaluate(client,'!document.querySelector(".canvas-panel")'))
      assert.equal(await evaluate(client,'document.querySelectorAll(".composer-note,.composer-info").length'),0)
      for (const theme of ['dark','light','navy','system']) {
        await click(client,`.sidebar-link[aria-label="${language==='ar'?'الإعدادات':'Settings'}"]`)
        await click(client,`.settings-group button[data-theme="${theme}"]`)
        await click(client,'.topbar-back')
      for (const width of [360,480,768,1024,1440]) {
        await client.send('Emulation.setDeviceMetricsOverride',{width,height:width===768?600:850,deviceScaleFactor:1,mobile:false})
        await waitFor(async()=>await evaluate(client,'(()=>{const a=document.querySelector(".access-menu").getBoundingClientRect(),b=document.querySelector(".send-button").getBoundingClientRect();return a.right<=b.left})()'))
        const geometry = await evaluate(client,`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const a=r('.access-menu'),b=r('.send-button'),c=r('.composer');return {order:a.right<=b.left,visible:c.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
        assert.deepEqual(geometry,{order:true,visible:true,overflow:false}, `${language} ${width}`)
        assert.equal(await evaluate(client,'document.querySelector(".attach-button").getBoundingClientRect().right<=document.querySelector(".access-menu").getBoundingClientRect().left'),true,`attachment physical order ${language} ${width}`)
        await click(client,'.attach-button')
        const attachmentBounds = await evaluate(client,'(()=>{const r=document.querySelector(".attachment-popover").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()')
        assert.ok(attachmentBounds.left>=0&&attachmentBounds.right<=attachmentBounds.width&&attachmentBounds.top>=0&&attachmentBounds.bottom<=attachmentBounds.height,`library popup ${language} ${width}: ${JSON.stringify(attachmentBounds)}`)
        await click(client,'.attach-button')
        await click(client,'.access-menu summary')
        const popup=await evaluate(client,'(()=>{const r=document.querySelector(".access-menu .provider-options").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()')
        assert.ok(popup.left>=0&&popup.right<=popup.width&&popup.top>=0&&popup.bottom<=popup.height,`access popup ${language} ${width}: ${JSON.stringify(popup)}`)
        await click(client,'.access-menu summary')
        await click(client,'.composer-models .provider-menu summary')
        assert.equal(await evaluate(client,'(()=>{const r=document.querySelector(".composer-models .provider-options").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),true,`provider popup ${language} ${width}`)
        await click(client,'.composer-models .provider-menu summary')
        const shot=await client.send('Page.captureScreenshot',{format:'png'})
        await fs.writeFile(path.join(screenshots,`${language}-${theme}-${width}.png`),Buffer.from(shot.data,'base64'))
      }
      }
      await evaluate(client,'(()=>{const e=document.querySelector(".chat-scroll");e.scrollTop=0;e.dispatchEvent(new Event("scroll"))})()')
      await waitFor(async()=>await evaluate(client,'!!document.querySelector(".jump-latest")'))
      const codeShot=await client.send('Page.captureScreenshot',{format:'png'})
      await fs.writeFile(path.join(screenshots,`${language}-code.png`),Buffer.from(codeShot.data,'base64'))
      await run('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.__fixtureCopied=text}}})')
      await click(client,'.code-block [data-block=copy]')
      assert.equal(await evaluate(client,'window.__fixtureCopied'),'<div dir="rtl">NAJD fixture</div>')
      await evaluate(client,'(()=>{const e=document.querySelector(".chat-scroll");e.scrollTop=0;e.dispatchEvent(new Event("scroll"))})()')
      await evaluate(client,'document.querySelector(".message-list").appendChild(Object.assign(document.createElement("p"),{textContent:"Layout growth fixture"}))')
      await client.send('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',awaitPromise:true})
      assert.equal(await evaluate(client,'document.querySelector(".chat-scroll").scrollTop'),0)
      await click(client,'.jump-latest')
      await waitFor(async()=>await evaluate(client,'!document.querySelector(".jump-latest")'))
      await click(client,'#prompt');await client.send('Input.insertText',{text:'Scroll follow fixture'})
      await click(client,'.send-button')
      await waitFor(async()=>await evaluate(client,'Array.from(document.querySelectorAll(".message.user")).some(e=>e.textContent.includes("Scroll follow fixture"))'))
      await waitFor(async()=>await evaluate(client,'(()=>{const e=document.querySelector(".chat-scroll");return e.scrollHeight-e.scrollTop-e.clientHeight<80})()'))
      await waitFor(async()=>await evaluate(client,'!!document.querySelector(".task-duration, .task-activity")'))
      assert.equal(await evaluate(client,'document.querySelector(".message.assistant .task-activity")===null'),true)
    }
    console.log('PASS: actual chat markdown/code-copy/tables, two languages x four themes x five widths composer/popup geometry (including 600px height), no footer notes, bottom following, reader pause/jump, real task status disclosure.')
  } finally {
    if(instance) await stop(instance)
    const resolved=path.resolve(root)
    if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('najd-desktop-test-'))throw Error('Unsafe fixture cleanup')
    await fs.rm(resolved,{recursive:true,force:true})
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
