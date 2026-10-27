// Explicit publisher command; credentials stay in memory and never enter app artifacts.
const fs = require('node:fs/promises'), path = require('node:path'), { createReadStream } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { verifyManifest, verifyInstaller } = require('../electron/update-manifest.cjs')
let staging=null // the private copy is removed when the run ends, whether it succeeded or stopped
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(staging)require('node:fs').rmSync(staging,{recursive:true,force:true});process.exit(130)})
const STAGING_MARK='.najd-publisher-staging'
async function main() {
  if(process.argv[2]!=='--publish')throw Error('Explicit publish flag required')
  // Copies left by a run that was killed outright are swept before a new one starts: only directories directly in the
  // temp folder, with the mkdtemp name shape, that hold the marker file this publisher writes first.
  const temp=require('node:os').tmpdir()
  for(const entry of await fs.readdir(temp,{withFileTypes:true})){
    if(!entry.isDirectory()||!/^najd-publish-[A-Za-z0-9]{6}$/.test(entry.name))continue
    const mark=await fs.lstat(path.join(temp,entry.name,STAGING_MARK)).catch(()=>null)
    if(mark?.isFile())await fs.rm(path.join(temp,entry.name),{recursive:true,force:true})
  }
  require('./release-gates.cjs').assertEvidence() // gate evidence must match this commit, version and installer
  const root=path.resolve(__dirname,'..'), npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')
  for(const args of [['test'],['run','build'],['run','notices'],['audit','--omit=dev','--audit-level=high']]){
    try{execFileSync(process.execPath,[npm,...args],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:1048576})}
    catch(error){await fs.writeFile(path.join(root,'.runtimes/publisher-gate-failure.log'),(error.stdout||'')+'\n'+(error.stderr||''));throw Error('Publication quality gate failed: '+args.join(' '))}
  }
  console.log('Publication tests/build/notices/security gates passed.')
  await require('./verify-package.cjs').verifyPackage()
  const config=require('../electron/update-config.json'), version=require('../package.json').version
  const output=path.resolve(__dirname,'../release',version)
  const record=verifyManifest(await fs.readFile(path.join(output,'najd-update.json'),'utf8'),config)
  if(record.version!==version)throw Error('Release version mismatch')
  const names=[record.file.name,record.file.name+'.blockmap','latest.yml','najd-update.json']
  // Everything below reads a private copy, so the verified, hashed and uploaded bytes are the same files.
  const directory=staging=await fs.mkdtemp(path.join(temp,'najd-publish-'))
  await fs.writeFile(path.join(directory,STAGING_MARK),'')
  for(const name of names){const s=await fs.lstat(path.join(output,name));if(!s.isFile()||s.isSymbolicLink())throw Error('Invalid release artifact');await fs.copyFile(path.join(output,name),path.join(directory,name))}
  const raw=await fs.readFile(path.join(directory,'najd-update.json'),'utf8')
  if(JSON.stringify(verifyManifest(raw,config))!==JSON.stringify(record))throw Error('Release manifest changed while publishing')
  await verifyInstaller(path.join(directory,record.file.name),record)
  const metadata=require('js-yaml').load(await fs.readFile(path.join(directory,'latest.yml'),'utf8'))
  if(metadata?.version!==version || !Array.isArray(metadata.files) || metadata.files.length!==1 ||
    metadata.files[0].url!==record.file.name || metadata.files[0].sha512!==record.file.sha512 || metadata.files[0].size!==record.file.size)throw Error('Unsigned library metadata differs from authenticated release')
  let token=process.env.GH_TOKEN
  if(!token){
    const raw=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\npath='+config.owner+'/'+config.repo+'.git\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},stdio:['pipe','pipe','pipe'],timeout:15000})
    token=raw.split('\n').find(line=>line.startsWith('password='))?.slice(9).trim()
  }
  if(!token)throw Error('Publisher authentication unavailable')
  const headers={Authorization:'Bearer '+token,'User-Agent':'NAJD-Publisher','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
  async function api(route,method='GET',body){const r=await fetch('https://api.github.com'+route,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error'});if(r.status===404)return null;if(!r.ok)throw Error('GitHub operation rejected ('+r.status+')');return r.status===204?null:r.json()}
  const user=await api('/user');if(user.login.toLowerCase()!==config.owner.toLowerCase())throw Error('Publisher owner mismatch')
  const targets=[config.repo,...(config.legacyRepos||[])], source=execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true}).trim()
  const checked=[], digests={}
  const sha256=file=>new Promise((resolve,reject)=>{const hash=require('node:crypto').createHash('sha256');createReadStream(file).on('error',reject).on('data',chunk=>hash.update(chunk)).on('end',()=>resolve('sha256:'+hash.digest('hex')))})
  for(const name of names)digests[name]=await sha256(path.join(directory,name))
  for(const target of targets){
    const repo=await api(`/repos/${config.owner}/${target}`)
    if(!repo){if(target===config.repo){checked.push({target,repo:null});continue}throw Error('Expected public release repository: '+target)}
    if(repo.private || repo.owner.login.toLowerCase()!==config.owner.toLowerCase())throw Error('Expected public release repository: '+target)
    // A retry after a partial run skips a repository whose release already holds these exact bytes (GitHub's asset
    // SHA-256 digest); a draft, a missing digest or any difference is preserved for review.
    const existing=await api(`/repos/${config.owner}/${target}/releases/tags/v${version}`)
    if(existing){
      if(existing.draft || !names.every(name=>existing.assets?.some(asset=>asset.name===name&&asset.state==='uploaded'&&asset.digest===digests[name])))throw Error('Different or incomplete release tag already exists in '+target+'; preserve it')
      console.log('Already published to '+target);continue
    }
    checked.push({target,repo})
  }
  // Every target was checked first, so a missing new repository is created only when the whole run can proceed.
  for(const entry of checked)if(!entry.repo){
    entry.repo=await api('/user/repos','POST',{name:entry.target,description:'NAJD AGENT for Windows.',private:false,auto_init:true,has_issues:false,has_wiki:false})
    if(!entry.repo || entry.repo.private)throw Error('Expected public release repository: '+entry.target)
  }
  // Installations from before the move to config.repo still read legacyRepos, so every release goes to each repository.
  for(const {target,repo} of checked){
    const base=`/repos/${config.owner}/${target}/releases`
    const release=await api(base,'POST',{tag_name:'v'+version,target_commitish:repo.default_branch,name:'NAJD AGENT '+version+' — Development',body:record.notes+'\n\nDevelopment build. Windows trusted-publisher certificate is not yet configured. In-app updates verify the pinned NAJD channel signature. Keep your existing data; install once, then use About and updates.\n\nSource checkpoint: '+source,draft:true,prerelease:false})
    for(const name of names){
      const file=path.join(directory,name), stat=await fs.stat(file)
      const url=release.upload_url.replace('{?name,label}','')+'?name='+encodeURIComponent(name)
      const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(stat.size)},body:createReadStream(file),duplex:'half',redirect:'error',signal:AbortSignal.timeout(600000)})
      if(!response.ok)throw Error('Artifact upload rejected ('+response.status+'); draft preserved')
      // The release goes public only when GitHub holds exactly the bytes that were hashed and signed.
      let asset=await response.json()
      if(!asset.digest)asset=await api(`/repos/${config.owner}/${target}/releases/assets/${asset.id}`)
      if(asset?.digest!==digests[name])throw Error('Uploaded '+name+' differs from the verified artifact; draft preserved')
      console.log('Uploaded '+name+' to '+target)
    }
    const published=await api(base+'/'+release.id,'PATCH',{draft:false,make_latest:'true'})
    console.log('Published development release: '+published.html_url)
  }
}
main().catch(error=>{console.error('Release publication stopped:',error.message.replace(/https?:\/\/\S+/g,'[URL]'));process.exitCode=1})
  .finally(()=>staging&&fs.rm(staging,{recursive:true,force:true}))
