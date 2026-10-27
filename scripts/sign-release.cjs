const fs = require('node:fs/promises'), path = require('node:path'), {createReadStream} = require('node:fs')
const { createHash, sign } = require('node:crypto')
const { publisherKey } = require('./publisher-key.cjs')
const { verifyManifest, verifyInstaller } = require('../electron/update-manifest.cjs')
async function main() {
  require('./release-gates.cjs').assertEvidence() // missing, failed, stale or mismatched gate evidence stops signing
  const version = require('../package.json').version, config = require('../electron/update-config.json')
  const directory = path.resolve(__dirname,'../release',version), filename = `NAJD-AGENT-Setup-${version}.exe`, installer = path.join(directory,filename)
  const stat = await fs.lstat(installer)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024**3)throw Error('Invalid installer')
  const hash=createHash('sha512');for await(const bytes of createReadStream(installer))hash.update(bytes)
  const notes=(await fs.readFile(path.resolve(__dirname,`../docs/releases/${version}.md`),'utf8')).trim()
  const record={format:'najd-update-v1',channel:config.channel,platform:'win32-x64',version,publishedAt:new Date().toISOString(),notes:notes.trim(),file:{name:filename,size:stat.size,sha512:hash.digest('base64')}}
  const key=await publisherKey(), bytes=Buffer.from(JSON.stringify(record))
  const envelope=JSON.stringify({payload:bytes.toString('base64'),signature:sign(null,bytes,key).toString('base64')})+'\n'
  verifyManifest(envelope,config);await verifyInstaller(installer,record)
  await fs.writeFile(path.join(directory,'najd-update.json'),envelope,{flag:'wx'})
  console.log(`Verified signed development release ${version}; publisher key was not exported.`)
}
main().catch(error=>{console.error(error?.problems?error.message:'Release signing failed; existing files preserved.');process.exitCode=1})
