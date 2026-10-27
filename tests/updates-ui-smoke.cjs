const assert=require('node:assert/strict'), fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os')
const {launch,stop,click,evaluate,waitFor}=require('./electron-ui-smoke.cjs')
async function main(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'najd-desktop-test-'));let instance
  process.env.NAJD_TEST_UPDATE_FIXTURE='1'
  try{
    instance=await launch(root);const client=instance.client
    const exists=selector=>evaluate(client,`!!document.querySelector(${JSON.stringify(selector)})`)
    const state=value=>waitFor(()=>exists(`[data-update-state=${value}]`))
    async function operation(code){const result=await client.send('Runtime.evaluate',{expression:code,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description);return result.result.value}
    await waitFor(()=>exists('.sidebar-link[aria-label="الإعدادات"]'))
    await click(client,'.sidebar-link[aria-label="الإعدادات"]');await state('idle')
    assert.equal(await evaluate(client,'document.querySelector("[data-update=current-version]").textContent'),'0.6.0')
    await click(client,'[data-update=check]');await state('available')
    await click(client,'.topbar-back');await waitFor(()=>exists('[data-update=notice]'));await click(client,'[data-update=notice]');await state('available')
    await waitFor(async()=>await evaluate(client,'document.querySelector(".update-card").getBoundingClientRect().top < innerHeight-100'))
    await click(client,'[data-update=download]');await state('downloading');await click(client,'[data-update=cancel]');await state('cancelled')
    console.log('PASS: actual source Electron check, notification, manual download/progress/cancel with signed private fixture.')
    await click(client,'[data-update=check]');await state('available');await click(client,'[data-update=download]');await state('ready')
    await operation(`void window.najdMemory.save({title:'Failed write proof',text:'BLOCK-UPDATE-FIXTURE'}).catch(()=>{})`)
    const writeRefused=await operation('window.najdUpdates.install()')
    assert.equal(writeRefused.errorCode,'UPDATE_BUSY')
    assert.equal(await fs.access(path.join(root,'update-install-proof.json')).then(()=>true,()=>false),false)
    await state('error');await click(client,'[data-update=check]');await state('available');await click(client,'[data-update=download]');await state('ready')
    await operation(`window.najdCore.startTask('/read fixture.txt','update-busy-proof')`)
    const refused=await operation('window.najdUpdates.install()')
    assert.equal(refused.errorCode,'UPDATE_BUSY')
    assert.equal(await fs.access(path.join(root,'update-install-proof.json')).then(()=>true,()=>false),false)
    await operation(`(async()=>{const task=await window.najdCore.startTask('/read fixture.txt','update-busy-proof');await window.najdCore.respondApproval(task.approvalId,'DENY')})()`)
    await state('error');await click(client,'[data-update=check]');await state('available');await click(client,'[data-update=download]');await state('ready')
    for(const lang of ['ar','en']){
      await click(client,`.settings-group .setting-row:first-child .segmented button:${lang==='ar'?'first':'last'}-child`)
      for(const width of [360,480,768,1024,1440]){
        await client.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
        await waitFor(async()=>await evaluate(client,`(innerWidth<=680?document.querySelector('.sidebar').getBoundingClientRect().width===0&&Math.abs(document.querySelector('.app-rail').getBoundingClientRect().width-56)<1:Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-(innerWidth<=1100?228:264))<1)`))
        await click(client,'.settings-nav-item:first-child')
        assert.equal(await evaluate(client,`['html','.settings-panel','.settings-scroll'].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1})`),true,`${lang}/${width}`)
        if([360,1440].includes(width)){
          await evaluate(client,'document.querySelector(".update-card").scrollIntoView({block:"start"})')
          const capture=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}), directory=path.resolve(__dirname,'../release/qa-updates')
          await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,`${lang}-${width}.png`),Buffer.from(capture.data,'base64'))
        }
      }
    }
    await click(client,'[data-update=install]')
    await waitFor(async()=>{try{return JSON.parse(await fs.readFile(path.join(root,'update-install-proof.json'),'utf8')).verified}catch{return false}},30000)
    console.log('PASS: main rejects installation while approval is pending; bilingual five-width UI; explicit install invokes only the verified fixture after stopping owned services.')
  }finally{
    if(instance&&instance.process.exitCode===null)await stop(instance)
    delete process.env.NAJD_TEST_UPDATE_FIXTURE
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.match(path.basename(root),/^najd-desktop-test-/);await fs.rm(root,{recursive:true,force:true})
  }
}
let completed=false
process.once('beforeExit',()=>{if(!completed){console.error('Update UI smoke incomplete');process.exitCode=1}})
main().then(()=>{completed=true},error=>{completed=true;console.error(error);process.exitCode=1})
