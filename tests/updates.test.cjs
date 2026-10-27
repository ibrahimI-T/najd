const { test } = require('node:test'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { generateKeyPairSync, sign, createHash } = require('node:crypto')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { createUpdateService, fetchManifest } = require('../electron/updates.cjs')
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-update-test-'))
  const bytes = Buffer.from('installer fixture'), filename = path.join(root,'installer.exe')
  await fs.writeFile(filename,bytes)
  const keys = generateKeyPairSync('ed25519')
  const record = { format:'najd-update-v1',channel:'development',platform:'win32-x64',version:'0.6.1',publishedAt:new Date().toISOString(),notes:'Proof',file:{name:'NAJD-AGENT-Setup-0.6.1.exe',size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')} }
  const payload = Buffer.from(JSON.stringify(record));const envelope = JSON.stringify({payload:payload.toString('base64'),signature:sign(null,payload,keys.privateKey).toString('base64')})
  let installations=0,checks=0,downloads=0
  const adapter = Object.assign(new EventEmitter(), {
    checkForUpdates:async()=>{checks++;return{updateInfo:{version:record.version,files:[{url:record.file.name,...record.file}]},cancellationToken:{cancel(){}}}},
    downloadUpdate:async()=>{downloads++;return[filename]},quitAndInstall(){installations++}
  })
  const service = createUpdateService({config:{channel:'development',publicKey:keys.publicKey},version:'0.6.0',enabled:true,createUpdater:()=>adapter,getManifest:async()=>envelope,...options})
  t.after(async()=>{await service.dispose();assert.match(path.basename(root),/^najd-update-test-/);await fs.rm(root,{recursive:true,force:true})})
  return{service,adapter,filename,record,counts:()=>({installations,checks,downloads})}
}
test('updates require explicit check, download and install; quitting cannot auto-install',async t=>{
  const f=await fixture(t)
  assert.equal(f.service.status().state,'idle');assert.deepEqual(f.counts(),{installations:0,checks:0,downloads:0})
  assert.equal((await f.service.check()).state,'available')
  assert.equal(f.adapter.autoDownload,false);assert.equal(f.adapter.autoInstallOnAppQuit,false)
  assert.equal(f.adapter.allowDowngrade,false);assert.equal(f.adapter.disableWebInstaller,true)
  assert.equal(f.adapter.disableDifferentialDownload,false)
  assert.equal((await f.service.download()).state,'ready');assert.equal(f.counts().installations,0)
  assert.equal((await f.service.install()).state,'installing');assert.equal(f.counts().installations,1)
  await assert.rejects(f.service.install(),{code:'UPDATE_INVALID'})
})
test('untrusted metadata mismatch or changed cached installer is never executed',async t=>{
  const f=await fixture(t)
  f.adapter.checkForUpdates=async()=>({updateInfo:{version:'0.6.1',files:[{url:'attacker.exe',...f.record.file}]}})
  assert.equal((await f.service.check()).errorCode,'UPDATE_SIGNATURE_INVALID')
  await assert.rejects(f.service.download(),{code:'UPDATE_INVALID'})
  f.adapter.checkForUpdates=async()=>({updateInfo:{version:'0.6.1',files:[{url:f.record.file.name,...f.record.file}]}})
  await f.service.check();await f.service.download();await fs.writeFile(f.filename,'tampered')
  assert.equal((await f.service.install()).errorCode,'UPDATE_SIGNATURE_INVALID');assert.equal(f.counts().installations,0)
})
test('busy application refuses installation and provider/network errors expose only stable codes',async t=>{
  const f=await fixture(t,{beforeInstall:async()=>{throw Object.assign(Error('private details'),{code:'UPDATE_BUSY'})}})
  await f.service.check();await f.service.download()
  assert.equal((await f.service.install()).errorCode,'UPDATE_BUSY');assert.equal(f.counts().installations,0)
  const bad=await fixture(t,{getManifest:async()=>{throw Error('private network/key/path details')}})
  assert.equal((await bad.service.check()).errorCode,'UPDATE_UNAVAILABLE')
  assert.equal(JSON.stringify(bad.service.status()).includes('private'),false)
})
test('cancelled/stale downloads never install; concurrent operations cannot duplicate effects',async t=>{
  const f=await fixture(t);await f.service.check()
  let release,entered
  const ready=new Promise(resolve=>{entered=resolve})
  f.adapter.downloadUpdate=async()=>{entered();await new Promise(resolve=>{release=resolve});return[f.filename]}
  const work=f.service.download();await ready
  await assert.rejects(f.service.download(),{code:'UPDATE_INVALID'})
  const cancel=f.service.cancel();release();await cancel;await work
  assert.equal(f.service.status().state,'cancelled');assert.equal(f.counts().installations,0)
})
test('development source is disabled; same/newer installed version never downloads',async t=>{
  const disabled=await fixture(t,{enabled:false})
  assert.equal((await disabled.service.check()).state,'disabled');assert.equal(disabled.counts().checks,0)
  const current=await fixture(t,{version:'0.6.1'})
  assert.equal((await current.service.check()).state,'current');assert.equal(current.counts().checks,0)
})
test('manifest fetch preserves absence, bounds bytes and never forwards arbitrary response text',async()=>{
  await assert.rejects(fetchManifest('https://example.test',async()=>new Response('private',{status:404})),{code:'UPDATE_NOT_PUBLISHED'})
  await assert.rejects(fetchManifest('https://example.test',async()=>new Response('private',{status:500})),{code:'UPDATE_UNAVAILABLE'})
  await assert.rejects(fetchManifest('https://example.test',async()=>new Response('x'.repeat(32769))),{code:'UPDATE_INVALID'})
})
test('a release without a signed manifest is announced once for a manual install and never downloaded',async t=>{
  const notes=[];const unpublished=async()=>{throw Object.assign(new Error('x'),{code:'UPDATE_NOT_PUBLISHED'})}
  const f=await fixture(t,{getManifest:unpublished,getLatestVersion:async()=>'0.7.0',notify:value=>notes.push(value)})
  const first=await f.service.check()
  assert.equal(first.state,'manual');assert.equal(first.version,'0.7.0');assert.equal(f.counts().checks,0)
  await assert.rejects(f.service.download(),{code:'UPDATE_INVALID'});assert.equal(f.counts().downloads,0)
  await f.service.check();assert.deepEqual(notes,[{version:'0.7.0',manual:true}])
})
test('a manual-release check reports current when GitHub has nothing newer, and a signed update is announced too',async t=>{
  const unpublished=async()=>{throw Object.assign(new Error('x'),{code:'UPDATE_NOT_PUBLISHED'})}
  const older=await fixture(t,{getManifest:unpublished,getLatestVersion:async()=>'0.6.0'})
  assert.equal((await older.service.check()).state,'current')
  const empty=await fixture(t,{getManifest:unpublished,getLatestVersion:unpublished})
  assert.equal((await empty.service.check()).state,'current')
  const down=await fixture(t,{getManifest:unpublished,getLatestVersion:async()=>{throw Object.assign(new Error('x'),{code:'UPDATE_UNAVAILABLE'})}})
  assert.equal((await down.service.check()).state,'error')
  const notes=[];const signed=await fixture(t,{notify:value=>notes.push(value)})
  assert.equal((await signed.service.check()).state,'available');assert.deepEqual(notes,[{version:'0.6.1',manual:false}])
})
test('the latest-release reader takes only a published x.y.z tag',async()=>{
  const { fetchLatestVersion } = require('../electron/updates.cjs')
  const reply=(body,status=200)=>async()=>({ok:status===200,status,body:[Buffer.from(JSON.stringify(body))]})
  assert.equal(await fetchLatestVersion('u',reply({tag_name:'v0.10.7',draft:false,prerelease:false})),'0.10.7')
  await assert.rejects(fetchLatestVersion('u',reply({tag_name:'v1.0.0-beta',draft:false})),{code:'UPDATE_NOT_PUBLISHED'})
  await assert.rejects(fetchLatestVersion('u',reply({tag_name:'v1.0.0',prerelease:true})),{code:'UPDATE_NOT_PUBLISHED'})
  await assert.rejects(fetchLatestVersion('u',reply({},404)),{code:'UPDATE_NOT_PUBLISHED'})
  await assert.rejects(fetchLatestVersion('u',reply({},500)),{code:'UPDATE_UNAVAILABLE'})
})
