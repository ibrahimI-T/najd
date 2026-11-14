const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
const {launch,stop,evaluate,click,waitFor}=require('./electron-ui-smoke.cjs')
async function main(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'najd-desktop-test-'))
  let instance
  try{
    await fs.mkdir(path.join(root,'read-fixtures'))
    await fs.writeFile(path.join(root,'read-fixtures','activity.txt'),'OWNED-FIXTURE-BODY')
    instance=await launch(root)
    let client=instance.client
    async function run(expression){const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value}
    await run(`(async()=>{
      const s=await window.najdSessions.create();window.__activitySession=s.id;
      await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const limits=await window.najdProviders.limits();await window.najdProviders.setLimits({...limits.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      await window.najdProviders.testModel('openai-api','gpt-6.1-sol');
      const text='NAJD API manual effort fixture';await window.najdSessions.append(s.id,'user',text);
      let t=await window.najdCore.startTask(text,crypto.randomUUID(),'openai-api','gpt-6.1-sol',[{role:'user',text}],'max');
      for(let i=0;i<100&&['QUEUED','RUNNING'].includes(t.state);i++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}
      if(t.state!=='COMPLETED')throw Error('Ordinary task failed');
      await window.najdSessions.append(s.id,'assistant',t.output,t.id);
      await window.najdFiles.grantRoot();return true
    })()`)
    const filename=path.join(root,'read-fixtures','activity.txt')
    const waitingTask=await run(`(async()=>{
      const text=${JSON.stringify('/read '+filename)};await window.najdSessions.append(window.__activitySession,'user',text);
      let t=await window.najdCore.startTask(text,crypto.randomUUID());
      for(let i=0;i<100&&['QUEUED','RUNNING'].includes(t.state);i++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}
      if(t.state!=='WAITING_APPROVAL')throw Error('Missing read approval');
      return t.id
    })()`)
    // Vue renderer (B-003): the activity of a finished run is the folded `.a-box[data-activity=done]` under its answer.
    await client.send('Page.reload')
    await waitFor(async()=>await evaluate(client,'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("#prompt")'),60000)
    assert.equal(await evaluate(client,'document.querySelectorAll(".a-box").length'),0,'nothing is shown before a conversation is opened')
    const tasks=await run(`window.najdSessions.list()`)
    const sessionId=tasks[0].id
    const result=await run(`(async()=>{
      let t=await window.najdCore.getTask(${JSON.stringify(waitingTask)});
      for(let i=0;i<100&&['QUEUED','RUNNING'].includes(t.state);i++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}
      if(t.state!=='WAITING_APPROVAL')throw Error('Missing owned approval');
      t=await window.najdCore.respondApproval(t.approvalId,'ALLOW_ONCE');
      for(let i=0;i<100&&['QUEUED','RUNNING'].includes(t.state);i++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}
      if(t.state!=='COMPLETED')throw Error('Owned tool failed');
      await window.najdSessions.append(${JSON.stringify(sessionId)},'assistant',t.output,t.id);return t.activity
    })()`)
    assert.ok(result.events.some(e=>e.type==='tool.started'))
    assert.ok(result.events.some(e=>e.type==='tool.completed'))
    assert.equal(JSON.stringify(result).includes('OWNED-FIXTURE-BODY'),false)
    const skill=await run(`(async()=>{
      await window.najdCapabilities.install('najd-read-document');await window.najdCapabilities.setEnabled('najd-read-document',true);
      let t=await window.najdCapabilities.run('najd-read-document',{path:${JSON.stringify(filename)}},crypto.randomUUID());
      for(let i=0;i<100&&['QUEUED','RUNNING'].includes(t.state);i++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}
      if(t.state!=='WAITING_APPROVAL')throw Error('Missing skill approval');
      t=await window.najdCore.respondApproval(t.approvalId,'DENY');
      await window.najdSessions.append(${JSON.stringify(sessionId)},'assistant','Skill denied by fixture user',t.id);return t.activity
    })()`)
    assert.ok(skill.events.some(e=>e.skill==='najd-read-document'))
    assert.equal(skill.events.some(e=>e.type==='tool.started'),false)
    await stop(instance);instance=await launch(root);client=instance.client
    await waitFor(async()=>await evaluate(client,'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector(".n-session .n-row")'),60000)
    await click(client,'.n-session .n-row')
    await waitFor(async()=>await evaluate(client,'document.querySelectorAll(".a-box").length>=2'))
    // The plain answer has no steps; the approved read and the denied skill each have a folded timeline with a summary line.
    assert.equal(await evaluate(client,'[...document.querySelectorAll(".a-box")].every(box=>box.dataset.activity==="done")'),true)
    assert.equal(await evaluate(client,'[...document.querySelectorAll(".a-box .a-head")].every(head=>head.getAttribute("aria-expanded")==="false")'),true,'finished runs are folded')
    const heads=await evaluate(client,'[...document.querySelectorAll(".a-box .a-head")].map(head=>head.textContent)')
    assert.ok(heads.length>=2,'two timelines: '+JSON.stringify(heads))
    for(let index=0;index<heads.length;index++){
      await evaluate(client,`document.querySelectorAll(".a-box .a-head")[${index}].click()`)
      await waitFor(async()=>await evaluate(client,`document.querySelectorAll(".a-box")[${index}].querySelectorAll(".a-step").length>0`))
    }
    const text=await evaluate(client,'[...document.querySelectorAll(".a-box")].map(box=>box.textContent).join(" | ")')
    assert.match(text,/read/i,'the approved read step is listed: '+text)
    assert.equal(text.includes('OWNED-FIXTURE-BODY'),false,'the file body is not in the timeline')
    const history=JSON.parse(await fs.readFile(path.join(root,'najd-data','sessions.json'),'utf8'))
    assert.ok(history.sessions[0].messages.some(m=>m.activity?.events.some(e=>e.type==='tool.completed')))
    console.log('PASS (Vue): the approved tool and the denied skill timelines survive a full process restart, are folded, expand to their steps and exclude file bodies.')
  }finally{
    if(instance)await stop(instance)
    if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('najd-desktop-test-'))throw Error('Unsafe cleanup')
    await fs.rm(root,{recursive:true,force:true})
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
