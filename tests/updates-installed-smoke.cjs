// Real NSIS install -> in-app update -> NSIS replacement -> relaunch, under a unique test app identity.
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os'), http=require('node:http')
const {createReadStream}=require('node:fs'), {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util')
const {generateKeyPairSync,createHash,sign,randomUUID}=require('node:crypto')
const {connect,freePort,waitForPage,click,evaluate,waitFor,stop}=require('./electron-ui-smoke.cjs')
const execute=promisify(execFile), project=path.resolve(__dirname,'..')
// Rewritten or appended by every start (the process record, the per-version start counter, the window position and the
// activity and error logs), so they are checked for validity, not bytes. Chats, memory, persona and keys are compared exactly.
const SESSION_STATE=new Set(['process-lifecycle.json','startup.json','window-state.json','activity-log.jsonl','errors.jsonl'])
// A SQLite database (memory-graph.db) is compared by its rows: opening it may rewrite pages without changing any data.
async function fingerprint(file){
  if(!/\.db$/i.test(file))return createHash('sha256').update(await fs.readFile(file)).digest('hex')
  const {DatabaseSync}=require('node:sqlite'), db=new DatabaseSync(file,{readOnly:true}), hash=createHash('sha256')
  try{for(const{name}of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all())
    hash.update(name+'\n'+db.prepare(`SELECT * FROM "${name.replace(/"/g,'""')}"`).all().map(row=>JSON.stringify(row,(key,value)=>typeof value==='bigint'?String(value):value instanceof Uint8Array?Buffer.from(value).toString('base64'):value)).sort().join('\n')+'\n')}
  finally{db.close()}
  return hash.digest('hex')
}
async function main(){
  assert.equal(process.platform,'win32')
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'najd-installed-update-test-')), id=randomUUID().slice(0,8)
  const product='NAJD Upgrade Proof '+id, install=path.join(root,'installed'), profile=path.join(root,'profile')
  const port=await freePort(), nextPort=await freePort(), files=new Map(), key=generateKeyPairSync('ed25519')
  assert.notEqual(port,nextPort)
  let instance, server, installed=false, stage='build', failure=null
  try{
    await fs.mkdir(profile,{recursive:true});await fs.mkdir(path.join(root,'local'),{recursive:true})
    server=http.createServer((req,res)=>{const filename=files.get(new URL(req.url,'http://127.0.0.1').pathname);if(!filename){res.writeHead(404).end();return}fs.stat(filename).then(stat=>{res.writeHead(200,{'Content-Length':stat.size,'Content-Type':'application/octet-stream'});createReadStream(filename).pipe(res)}).catch(()=>res.writeHead(500).end())})
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const feed=`http://127.0.0.1:${server.address().port}/`
    const bootstrap=path.join(root,'upgrade-proof.cjs')
    await fs.writeFile(bootstrap,`
const path=require('node:path');const {app}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});
process.env.LOCALAPPDATA=${JSON.stringify(path.join(root,'local'))};
app.commandLine.appendSwitch('remote-debugging-port',app.getVersion()==='0.6.0'?${JSON.stringify(String(port))}:${JSON.stringify(String(nextPort))});
const updates=require('./electron/updates.cjs'), factory=updates.createUpdateService;
updates.createUpdateService=options=>factory({...options,config:{...options.config,publicKey:${JSON.stringify(key.publicKey.export({format:'pem',type:'spki'}))}},getManifest:signal=>updates.fetchManifest(${JSON.stringify(feed+'najd-update.json')},fetch,signal),createUpdater:()=>{const {NsisUpdater}=require('electron-updater');const updater=new NsisUpdater({provider:'generic',url:${JSON.stringify(feed)}});updater.on('error',error=>require('node:fs').appendFileSync(${JSON.stringify(path.join(root,'updater-diagnostic.txt'))},String(error.message).slice(0,4000)+'\\n'));return updater}});
require('./electron/main.cjs');
`)
    for(const version of ['0.6.0','0.6.1']){
      const output=path.join(root,version), configuration=path.join(root,version+'.json')
      const base=require('../package.json').build
      await fs.writeFile(configuration,JSON.stringify({...base,appId:'com.najd.agent.upgradeproof.'+id,productName:product,
        directories:{output},extraMetadata:{name:'najd-upgrade-proof-'+id,version,main:'upgrade-proof.cjs'},
        files:[...base.files,{from:root,to:'.',filter:['upgrade-proof.cjs']}],
        publish:[{provider:'generic',url:feed}],
        nsis:{...base.nsis,shortcutName:product,createDesktopShortcut:false,createStartMenuShortcut:false}}))
      let result
      try { result=await execute(process.execPath,[path.join(project,'node_modules/electron-builder/cli.js'),'--win','nsis','--x64','--config',configuration,'--publish','never'],{cwd:project,env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'},windowsHide:true,timeout:300000,maxBuffer:262144}) }
      catch(error){await fs.writeFile(path.join(project,'.runtimes',`updates-installed-build-${version}.log`),(error.stdout||'')+'\n'+(error.stderr||''));throw Error('Isolated installer build failed; see updates-installed-build-'+version+'.log')}
      await fs.writeFile(path.join(project,'.runtimes',`updates-installed-build-${version}.log`),result.stdout+'\n'+result.stderr)
      console.log('Built isolated actual NSIS '+version)
    }
    const target=path.join(root,'0.6.1'), name='NAJD-AGENT-Setup-0.6.1.exe', installer=path.join(target,name)
    const hash=createHash('sha512');for await(const bytes of createReadStream(installer))hash.update(bytes)
    const record={format:'najd-update-v1',channel:require('../electron/update-config.json').channel,platform:'win32-x64',version:'0.6.1',publishedAt:new Date().toISOString(),notes:'Owned installed upgrade acceptance',file:{name,size:(await fs.stat(installer)).size,sha512:hash.digest('base64')}}
    const payload=Buffer.from(JSON.stringify(record));await fs.writeFile(path.join(target,'najd-update.json'),JSON.stringify({payload:payload.toString('base64'),signature:sign(null,payload,key.privateKey).toString('base64')}))
    for(const file of [name,name+'.blockmap','latest.yml','najd-update.json'])files.set('/'+file,path.join(target,file))
    const env={...process.env,LOCALAPPDATA:path.join(root,'local')}
    stage='baseline install'
    // The installer waits for the app to unpack and verify about 1 GB of components (installer.nsh): minutes, not seconds.
    installed=true
    await execute(path.join(root,'0.6.0','NAJD-AGENT-Setup-0.6.0.exe'),['/S','/D='+install],{windowsHide:true,env,timeout:900000,maxBuffer:16384})
    async function attach(){
      const page=await waitForPage(port);const client=await connect(page.webSocketDebuggerUrl)
      return{client,process:{exitCode:null,once(){}},page}
    }
    // Some NSIS modes do not auto-run a fresh silent install; launch only our exact installed test executable.
    const exe=path.join(install,product+'.exe')
    let page
    try{const response=await fetch(`http://127.0.0.1:${port}/json/list`);page=(await response.json()).find(item=>item.type==='page')}catch{}
    if(!page)spawn(exe,[],{windowsHide:true,env,stdio:'ignore'})
    instance=await attach();let client=instance.client
    async function api(code){const r=await client.send('Runtime.evaluate',{expression:code,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'IPC failure');return r.result.value}
    await waitFor(async()=>Boolean(await evaluate(client,'window.najdUpdates')))
    assert.equal((await api('window.najdUpdates.status()')).currentVersion,'0.6.0')
    console.log('PASS: actual baseline installer starts the isolated 0.6.0 app.')
    await api(`(async()=>{await window.najdMemory.save({title:'Upgrade retention',text:'OWNED-UPGRADE-MEMORY'});await window.najdPersonality.save({enabled:false,name:'Upgrade proof',instructions:'Keep local data.'});await window.najdProviders.saveKey('openai-api','sk-najd-UPGRADE-FAKE-KEY')})()`)
    const data=path.join(profile,'najd-data'), baseline=new Map()
    for(const file of await fs.readdir(data)){const full=path.join(data,file);if((await fs.stat(full)).isFile()&&!/-(wal|shm|journal)$/i.test(file)&&!SESSION_STATE.has(file))baseline.set(file,await fingerprint(full))}
    await click(client,'.sidebar-link[aria-label="الإعدادات"]')
    await click(client,'.settings-group .setting-row:first-child .segmented button:last-child')
    await click(client,'button[data-theme=navy]')
    stage='check'
    await click(client,'[data-update=check]');await waitFor(async()=>await evaluate(client,'!!document.querySelector("[data-update-state=available]")'),30000)
    console.log('PASS: actual installed app discovers signed 0.6.1 metadata.')
    stage='download'
    await click(client,'[data-update=download]');await waitFor(async()=>await evaluate(client,'!!document.querySelector("[data-update-state=ready]")'),120000)
    console.log('PASS: actual installed app downloads and verifies the complete NSIS update.')
    stage='install/relaunch'
    await click(client,'[data-update=install]');client.close();instance=null
    const deadline=Date.now()+600000 // the silent update also runs component preparation
    while(!instance && Date.now()<deadline){
      try{const pages=await(await fetch(`http://127.0.0.1:${nextPort}/json/list`,{signal:AbortSignal.timeout(1000)})).json(),page=pages.find(item=>item.type==='page'&&item.title==='NAJD AGENT');if(!page)throw Error('No new page');const next=await connect(page.webSocketDebuggerUrl);let current
        try{const result=await next.send('Runtime.evaluate',{expression:'window.najdUpdates?.status()',awaitPromise:true,returnByValue:true});current=result.result.value?.currentVersion}catch{}
        if(current==='0.6.1'){client=next;instance={client:next}}else next.close()
      }catch{}
      if(!instance)await new Promise(resolve=>setTimeout(resolve,200))
    }
    assert.ok(instance,'Updated installed app did not expose its own test debugger within the deadline')
    assert.equal((await api('window.najdUpdates.status()')).currentVersion,'0.6.1')
    assert.equal((await api('window.najdMemory.list()'))[0].text,'OWNED-UPGRADE-MEMORY')
    assert.equal((await api('window.najdPersonality.get()')).name,'Upgrade proof')
    assert.equal(await evaluate(client,'document.documentElement.lang'),'en')
    assert.equal(await evaluate(client,'document.documentElement.dataset.theme'),'navy')
    for(const[file,digest]of baseline)assert.equal(await fingerprint(path.join(data,file)),digest,'Upgrade changed canonical '+file)
    assert.equal(JSON.parse(await fs.readFile(path.join(data,'process-lifecycle.json'),'utf8')).format,'najd-process-lifecycle-v1','the process record stays readable')
    assert.equal(JSON.parse(await fs.readFile(path.join(data,'startup.json'),'utf8')).version,'0.6.1','the start counter belongs to the new version')
    assert.equal((await api('window.najdUpdates.check()')).state,'current')
    console.log('PASS: real isolated NSIS 0.6.0 -> signed-manifest download -> explicit in-app NSIS upgrade -> actual installed 0.6.1 relaunch. Memory, persona and encrypted credential bytes retained; no real account/profile used.')
  }catch(error){
    failure=error
    console.error('Installed upgrade stage: '+stage+': '+String(error?.message||error).slice(0,500))
    if(instance)try{const r=await instance.client.send('Runtime.evaluate',{expression:'window.najdUpdates?.status()',awaitPromise:true,returnByValue:true});console.error('Own fixture state: '+JSON.stringify(r.result.value))}catch{}
    try{const detail=await fs.readFile(path.join(root,'updater-diagnostic.txt'),'utf8');await fs.writeFile(path.join(project,'.runtimes/updates-installed-diagnostic.log'),detail);console.error(detail.slice(0,2000))}catch{}
    throw error
  }finally{
    if(instance){void instance.client.send('Page.close').catch(()=>{});instance.client.close();await new Promise(resolve=>setTimeout(resolve,2000))}
    if(installed && await fs.access(path.join(install,'Uninstall '+product+'.exe')).then(()=>true,()=>false))try{
      assert.ok(path.resolve(install).startsWith(path.resolve(root)+path.sep))
      // Only this test's own processes are stopped: the installed app and the components it started, whose executables all
      // live in this test's temp folder. They hold the components open, so the uninstaller could not remove them.
      await execute(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',
        `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${(path.resolve(root)+path.sep).replace(/'/g,"''")}', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force`],{windowsHide:true,timeout:30000}).catch(()=>{})
      await new Promise(resolve=>setTimeout(resolve,2000))
      // Uninstall (Phase 15): the program and this test's components go; the user's chats, memory and keys stay, and the
      // components of the NAJD installed for the real user are never touched (the uninstaller reads LOCALAPPDATA).
      const real=process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'NAJD AGENT','runtime'):null
      const realBefore=real?await fs.stat(real).then(stat=>stat.mtimeMs,()=>null):null
      const kept=new Map();for(const file of await fs.readdir(path.join(profile,'najd-data')).catch(()=>[])){const full=path.join(profile,'najd-data',file);if((await fs.stat(full)).isFile()&&!/-(wal|shm|journal)$/i.test(file))kept.set(file,await fingerprint(full))}
      const uninstaller=path.join(install,'Uninstall '+product+'.exe')
      await execute(uninstaller,['/S'],{windowsHide:true,timeout:60000,maxBuffer:16384,env:{...process.env,LOCALAPPDATA:path.join(root,'local')}})
      // The NSIS uninstaller copies itself to a temporary folder and finishes there after the first process exits.
      const exists=file=>fs.access(file).then(()=>true,()=>false)
      await waitFor(async()=>!await exists(path.join(install,product+'.exe'))&&!await exists(path.join(root,'local','NAJD AGENT','runtime')),180000).catch(()=>{})
      assert.equal(await fs.access(path.join(root,'local','NAJD AGENT','runtime')).then(()=>true,()=>false),false,'the test components were removed')
      assert.ok(kept.size>0,'the profile had user data');for(const[file,digest]of kept)assert.equal(await fingerprint(path.join(profile,'najd-data',file)),digest,'uninstall changed user data '+file)
      if(real)assert.equal(await fs.stat(real).then(stat=>stat.mtimeMs,()=>null),realBefore,'the real user components were not touched')
      console.log('PASS: uninstall removed the program and its components, kept '+kept.size+' user data files unchanged, and left the real user components alone.')
    }catch(error){if(!failure)throw error;console.error('Uninstall check after the earlier failure: '+error.message)}
    if(server)await new Promise(resolve=>server.close(resolve))
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.match(path.basename(root),/^najd-installed-update-test-/)
    // A folder still in use is reported, never allowed to hide the test's own error.
    await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:500}).catch(error=>console.warn('cleanup left '+root+' '+error.code))
  }
}
let completed=false;process.once('beforeExit',()=>{if(!completed){console.error('Installed update smoke incomplete');process.exitCode=1}})
main().then(()=>{completed=true},error=>{completed=true;console.error(error.message);process.exitCode=1})
