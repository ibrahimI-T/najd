// Explicit publisher command; credentials stay in memory and never enter app artifacts.
const fs = require('node:fs/promises'), path = require('node:path'), { createReadStream } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { verifyManifest, verifyInstaller } = require('../electron/update-manifest.cjs')
async function main() {
  if(process.argv[2]!=='--publish')throw Error('Explicit publish flag required')
  require('./release-gates.cjs').assertEvidence() // gate evidence must match this commit, version and installer
  const root=path.resolve(__dirname,'..'), npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')
  for(const args of [['test'],['run','build'],['run','notices'],['audit','--omit=dev','--audit-level=high']]){
    try{execFileSync(process.execPath,[npm,...args],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:1048576})}
    catch(error){await fs.writeFile(path.join(root,'.runtimes/publisher-gate-failure.log'),(error.stdout||'')+'\n'+(error.stderr||''));throw Error('Publication quality gate failed: '+args.join(' '))}
  }
  console.log('Publication tests/build/notices/security gates passed.')
  await require('./verify-package.cjs').verifyPackage()
  const config=require('../electron/update-config.json'), version=require('../package.json').version
  const directory=path.resolve(__dirname,'../release',version), raw=await fs.readFile(path.join(directory,'najd-update.json'),'utf8')
  const record=verifyManifest(raw,config)
  if(record.version!==version)throw Error('Release version mismatch')
  await verifyInstaller(path.join(directory,record.file.name),record)
  const metadata=require('js-yaml').load(await fs.readFile(path.join(directory,'latest.yml'),'utf8'))
  if(metadata?.version!==version || !Array.isArray(metadata.files) || metadata.files.length!==1 ||
    metadata.files[0].url!==record.file.name || metadata.files[0].sha512!==record.file.sha512 || metadata.files[0].size!==record.file.size)throw Error('Unsigned library metadata differs from authenticated release')
  const names=[record.file.name,record.file.name+'.blockmap','latest.yml','najd-update.json']
  for(const name of names){const s=await fs.lstat(path.join(directory,name));if(!s.isFile()||s.isSymbolicLink())throw Error('Invalid release artifact')}
  let token=process.env.GH_TOKEN
  if(!token){
    const raw=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\npath=ibrahimI-T/najd-agent.git\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},stdio:['pipe','pipe','pipe'],timeout:15000})
    token=raw.split('\n').find(line=>line.startsWith('password='))?.slice(9).trim()
  }
  if(!token)throw Error('Publisher authentication unavailable')
  const headers={Authorization:'Bearer '+token,'User-Agent':'NAJD-Publisher','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
  async function api(route,method='GET',body){const r=await fetch('https://api.github.com'+route,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error'});if(r.status===404)return null;if(!r.ok)throw Error('GitHub operation rejected ('+r.status+')');return r.status===204?null:r.json()}
  const user=await api('/user');if(user.login.toLowerCase()!==config.owner.toLowerCase())throw Error('Publisher owner mismatch')
  let repo=await api(`/repos/${config.owner}/${config.repo}`)
  if(!repo)repo=await api('/user/repos','POST',{name:config.repo,description:'NAJD AGENT development installers and authenticated update metadata. Source publication follows product preparation.',private:false,auto_init:true,has_issues:false,has_wiki:false})
  if(repo.private || repo.owner.login.toLowerCase()!==config.owner.toLowerCase())throw Error('Expected independent public distribution repository')
  const base=`/repos/${config.owner}/${config.repo}/releases`
  if(await api(base+'/tags/v'+version))throw Error('Release tag already exists; preserve it')
  const source=execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true}).trim()
  const release=await api(base,'POST',{tag_name:'v'+version,target_commitish:repo.default_branch,name:'NAJD AGENT '+version+' — Development',body:record.notes+'\n\nDevelopment build. Windows trusted-publisher certificate is not yet configured. In-app updates verify the pinned NAJD channel signature. Keep your existing data; install once, then use About and updates.\n\nSource checkpoint: '+source,draft:true,prerelease:false})
  for(const name of names){
    const file=path.join(directory,name), stat=await fs.stat(file)
    const url=release.upload_url.replace('{?name,label}','')+'?name='+encodeURIComponent(name)
    const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(stat.size)},body:createReadStream(file),duplex:'half',redirect:'error',signal:AbortSignal.timeout(600000)})
    if(!response.ok)throw Error('Artifact upload rejected ('+response.status+'); draft preserved')
    console.log('Uploaded '+name)
  }
  const published=await api(base+'/'+release.id,'PATCH',{draft:false,make_latest:'true'})
  console.log('Published development release: '+published.html_url)
}
main().catch(error=>{console.error('Release publication stopped:',error.message.replace(/https?:\/\/\S+/g,'[URL]'));process.exitCode=1})
