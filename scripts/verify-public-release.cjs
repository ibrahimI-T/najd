const { createHash } = require('node:crypto')
const { verifyManifest } = require('../electron/update-manifest.cjs')
const { fetchManifest, createUpdateService } = require('../electron/updates.cjs')
async function main() {
  const config=require('../electron/update-config.json'), version=require('../package.json').version
  const base=`https://github.com/${config.owner}/${config.repo}/releases/`
  const raw=await fetchManifest(base+'latest/download/najd-update.json'), record=verifyManifest(raw,config)
  if(record.version!==version)throw Error('Published baseline version differs')
  const service=createUpdateService({config,version,enabled:true,getManifest:async()=>raw,createUpdater:()=>{throw Error('Current baseline must not invoke a download')}})
  if((await service.check()).state!=='current')throw Error('Public consumer check failed')
  await service.dispose()
  const response=await fetch(base+'download/v'+version+'/'+record.file.name,{signal:AbortSignal.timeout(300000)})
  if(!response.ok)throw Error('Public installer download unavailable')
  let size=0;const hash=createHash('sha512')
  for await(const bytes of response.body){size+=bytes.length;if(size>record.file.size)throw Error('Public installer exceeds signed length');hash.update(bytes)}
  if(size!==record.file.size||hash.digest('base64')!==record.file.sha512)throw Error('Public installer integrity differs')
  console.log(`PASS: public unauthenticated ${version} consumer check, pinned signature and complete ${size}-byte installer download verified.`)
}
main().catch(error=>{console.error('Public release verification failed:',error.message);process.exitCode=1})
