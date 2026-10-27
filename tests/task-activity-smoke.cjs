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
    await client.send('Page.reload')
    await waitFor(async()=>await evaluate(client,'!!document.querySelector(".task-duration")'))
    assert.equal(await evaluate(client,'document.querySelectorAll(".task-activity").length'),0)
    assert.equal(await evaluate(client,'getComputedStyle(document.querySelector(".task-duration")).borderBottomWidth'),'0px')
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
    await waitFor(async()=>await evaluate(client,'!!document.querySelector(".task-activity")'))
    await click(client,'.task-activity .act-toggle')
    assert.equal(await evaluate(client,'document.querySelector(".task-activity .act-toggle").getAttribute("aria-expanded")'),'true')
    assert.equal(await evaluate(client,'!!document.querySelector(".task-activity .act-row.kind-file-read")'),true)
    await click(client,'.task-activity .act-row.kind-file-read .act-line')
    assert.equal(await evaluate(client,'document.querySelector(".task-activity").textContent.includes("read-file")'),true)
    assert.equal(await evaluate(client,'document.querySelector(".task-activity").textContent.includes("OWNED-FIXTURE-BODY")'),false)
    const history=JSON.parse(await fs.readFile(path.join(root,'najd-data','sessions.json'),'utf8'))
    assert.ok(history.sessions[0].messages.some(m=>m.activity?.events.some(e=>e.type==='tool.completed')))
    const output=path.resolve('release/qa-activity-'+require('../package.json').version);await fs.mkdir(output,{recursive:true})
    const shot=await client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'tool-history.png'),Buffer.from(shot.data,'base64'))
    console.log('PASS: plain response duration; actual approved tool and denied skill timelines survive full process restart, remain expandable and exclude file bodies.')
  }finally{
    if(instance)await stop(instance)
    if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('najd-desktop-test-'))throw Error('Unsafe cleanup')
    await fs.rm(root,{recursive:true,force:true})
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
