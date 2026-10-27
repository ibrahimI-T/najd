const fs=require('node:fs/promises'), path=require('node:path'), asar=require('@electron/asar')
async function verifyPackage(candidateRoot){
  const root=path.resolve(__dirname,'..'), version=require('../package.json').version
  const directory=candidateRoot?path.resolve(candidateRoot,'win-unpacked'):path.join(root,'release',version,'win-unpacked'), archive=path.join(directory,'resources/app.asar')
  if(!directory.startsWith(path.join(root,'release')+path.sep))throw Error('Candidate must be under release directory')
  const manifest=JSON.parse(asar.extractFile(archive,'package.json').toString())
  if(manifest.version!==version||manifest.name!=='najd-agent'||manifest.main!=='electron/main.cjs')throw Error('Wrong packaged application identity')
  let count=0
  async function visit(relative){for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    const file=path.join(relative,entry.name)
    if(entry.isSymbolicLink())throw Error('Unexpected source link')
    if(entry.isDirectory()){await visit(file);continue}
    if(!Buffer.from(asar.extractFile(archive,file)).equals(await fs.readFile(path.join(root,file))))throw Error('Package differs from current source: '+file)
    count++
  }}
  await visit('electron');await visit('dist')
  const files=asar.listPackage(archive).map(file=>file.split(path.sep).join('/'))
  if(files.some(file=>/^\/(?:tests|scripts|secrets)\//.test(file)||/\.(?:dpapi|pfx|key)$/.test(file)||file==='/upgrade-proof.cjs'))throw Error('Unexpected publisher/test material in app')
  if(!Buffer.from(await fs.readFile(path.join(directory,'resources/THIRD-PARTY-NOTICES.txt'))).equals(await fs.readFile(path.join(root,'build/THIRD-PARTY-NOTICES.txt'))))throw Error('Stale notices')
  const shipped=JSON.parse(await fs.readFile(path.join(directory,'resources/najd-runtime/bundle.json'),'utf8')), staged=JSON.parse(await fs.readFile(path.join(root,'build/bundle/najd-runtime-packed/bundle.json'),'utf8'))
  if(JSON.stringify(shipped)!==JSON.stringify(staged)||shipped.format!=='najd-runtime-bundle-v2')throw Error('Bundled runtime missing or stale')
  const updater=JSON.parse(asar.extractFile(archive,path.join('node_modules','electron-updater','package.json')))
  if(updater.version!=='6.8.9')throw Error('Wrong updater pin')
  console.log(`PASS: ${version} package matches all ${count} current Electron/renderer files, identity, trust config, updater and notices; no publisher key/test bootstrap shipped.`)
}
module.exports={verifyPackage}
if(require.main===module)verifyPackage().catch(error=>{console.error(error.message);process.exitCode=1})
