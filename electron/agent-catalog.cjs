const fail=code=>Object.assign(new Error(code),{code})
const {TOOLSETS}=require('./agent-toolsets.cjs')
// The toolset to load (najd_tools_load) for a capability row, so the model knows how to reach it.
const toolsetOf=row=>row.kind==='pack'?'python':row.kind==='mcp-tool'?'mcp':row.kind==='connector'?'connections':row.mode==='instructions'?'skills':row.kind==='tool'?Object.keys(TOOLSETS).find(name=>name!=='files-read'&&TOOLSETS[name].includes(row.id.replaceAll('-','_')))||null:null
const text=(value,size)=>typeof value==='string'?value.slice(0,size):''
// MCP tool ids are stable, lowercase and unique per server; the exact server/tool names travel in the row.
const mcpId=(server,tool,taken)=>{let id=('mcp-'+server+'-'+tool.toLowerCase().replace(/[^a-z0-9_]+/g,'-').replace(/^-+|-+$/g,'')).slice(0,72),n=2;while(taken.has(id))id=id.slice(0,70)+'-'+n++;taken.add(id);return id}
// getPacks: the Office and design pack's state ([{id, state, packages}]), reported truthfully (M3-3).
function createAgentCatalog({registry,connectors,getTools=()=>[],getSkills=()=>[],getMcpTools=()=>[],getPacks=()=>[]}={}){
  if(!registry?.list||!connectors?.list||typeof getTools!=='function')throw fail('INVALID_INPUT')
  async function list(){
    const skills=await registry.list(),connections=await connectors.list(),tools=await getTools(),instructions=await getSkills(),mcp=await getMcpTools(),packs=await getPacks(),taken=new Set()
    if(!Array.isArray(skills)||!Array.isArray(connections)||!Array.isArray(tools)||!Array.isArray(instructions)||!Array.isArray(mcp)||skills.length+connections.length+tools.length+instructions.length+mcp.length>768)throw fail('CAPABILITY_STORE_UNAVAILABLE')
    return [
      ...skills.map(row=>({id:row.id,kind:'skill',title:text(row.title,120),description:text(row.description,240),
        installed:row.installed===true,enabled:row.enabled===true,ready:false,
        reason:!row.installed?'NOT_INSTALLED':row.updateRequired?'UPDATE_REQUIRED':!row.enabled?'DISABLED':'AGENT_ADAPTER_PENDING',
        effect:'read',source:text(row.source,120),version:text(row.version,40)})),
      ...instructions.map(row=>({id:row.id,kind:'skill',mode:'instructions',title:text(row.name,120),description:text(row.description,240),
        installed:true,enabled:row.enabled===true,ready:row.enabled===true,reason:row.enabled?null:'DISABLED',
        effect:'read',source:row.source,sourceRevision:row.sourceRevision,digest:row.digest,platforms:row.platforms,
        dependenciesReady:false,compatibility:row.compatibility||'instructions-only',providers:['chatgpt','openai-api','kimi-code','ollama'],...(row.learned===true?{learned:true}:{})})),
      ...connections.map(row=>({id:row.id,kind:'connector',title:text(row.id,120),description:'Fixed Windows app discovery through connected native MCP; device changes require a separate approved action.',
        installed:true,enabled:row.state==='connected',ready:row.id==='najd-windows-native'&&row.state==='connected'&&row.tools?.includes('system.which')&&typeof connectors.readApps==='function',
        mode:'app-discovery',reason:row.state==='connected'?'READ_ADAPTER_ONLY':'NOT_CONNECTED',
        source:text(row.source,120),sourceRevision:text(row.sourceRevision,128)})),
      ...tools.map(row=>({id:row.id,kind:'tool',title:text(row.title,120),description:text(row.description,240),
        installed:true,enabled:row.enabled===true,ready:row.ready===true&&row.enabled===true,
        reason:row.ready&&row.enabled?null:'UNAVAILABLE',effect:text(row.effect,30),source:'NAJD',
        providers:Array.isArray(row.providers)?row.providers.filter(value=>typeof value==='string').slice(0,20):[]})),
      ...mcp.map(row=>({id:mcpId(row.server,row.name,taken),kind:'mcp-tool',mode:'mcp',title:text(row.serverName+' · '+(row.title||row.name),120),description:text(row.description,240),
        installed:true,enabled:true,ready:true,reason:null,effect:'external-with-approval',source:'MCP server added by the user: '+text(row.serverName,60),
        server:row.server,tool:row.name,inputSchema:row.inputSchema,serverHints:row.hints,providers:['chatgpt','openai-api','kimi-code','ollama']})),
      ...(Array.isArray(packs)?packs:[]).slice(0,4).map(row=>({id:row.id,kind:'pack',title:'Office and design pack',
        description:'Python packages for najd_python_run: python-docx (Word docx), openpyxl and XlsxWriter (Excel xlsx), python-pptx (PowerPoint pptx), matplotlib and numpy (charts), Pillow (images), lxml. NAJD installs it automatically (Settings > Plugins shows its state).',
        installed:row.state!=='not-installed',enabled:row.state==='ready',ready:row.state==='ready',reason:row.state==='ready'?null:String(row.state||'').toUpperCase().replace(/-/g,'_'),
        effect:'read',source:'NAJD pinned pack',packages:Array.isArray(row.packages)?row.packages.slice(0,30):[]}))
    ]
  }
  // Distinct, truthful states: a row is model-executable only when NAJD can run it now.
  function status(row){
    if(row.kind==='tool')return row.ready?'executable':'dependency-missing'
    if(row.kind==='pack')return row.ready?'ready':row.reason==='NOT_INSTALLED'?'not-installed':row.reason==='INCOMPATIBLE'?'needs-reinstall':row.reason==='DAMAGED'?'damaged':'unavailable'
    if(row.kind==='mcp-tool')return 'executable'
    if(row.kind==='connector')return row.ready?'executable':row.enabled?'connected-no-adapter':'not-connected'
    if(row.mode==='instructions')return !row.enabled?'disabled':row.compatibility==='platform-mismatch'?'guidance-other-platform':row.compatibility==='needs-runtime'?'guidance-only-dependencies-missing':'guidance-ready'
    return row.installed?(row.enabled?'settings-only':'disabled'):'not-installed'
  }
  async function summary(){
    const rows=(await list()).map(row=>({...row,status:status(row)}))
    // The owner's own saved skills come first, so they are always among the names the model sees.
    const skills=rows.filter(row=>row.mode==='instructions'&&row.enabled).sort((a,b)=>(b.learned===true)-(a.learned===true))
    const tools=rows.filter(row=>row.kind==='tool')
    const blocked=tools.filter(row=>!row.ready).map(row=>row.id)
    const mcp=rows.filter(row=>row.kind==='mcp-tool')
    return `${skills.length} enabled skill guides${skills.length?' ('+skills.slice(0,15).map(row=>row.title).join(', ')+(skills.length>15?', …':'')+')':''}; `+
      `${rows.filter(row=>row.kind==='connector'&&row.ready).length} connected connectors; ${tools.length-blocked.length} executable tools`+(blocked.length?`; not ready now: ${blocked.join(', ')}`:'')+
      (mcp.length?`; ${mcp.length} external MCP tools (${mcp.slice(0,20).map(row=>row.id).join(', ')}${mcp.length>20?', …':''})`:'')+'.'
  }
  return {
    summary,
    list,
    search:async query=>{
      if(typeof query!=='string'||query.length>200)throw fail('INVALID_INPUT')
      const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean)
      // Ranked by how many of the words a row matches (a row with every word first); a long query no longer finds nothing because one word is missing.
      // Very short words are ignored unless the query has nothing else.
      const useful=words.filter(word=>word.length>2),terms=useful.length?useful:words
      const scored=(await list()).map(row=>{const hay=[row.id,row.title,row.description,row.kind,row.mode||''].join(' ').toLowerCase();return {row,score:terms.filter(word=>hay.includes(word)).length}})
      const best=Math.max(0,...scored.map(item=>item.score)),floor=Math.max(1,Math.ceil(terms.length/3))
      return scored.filter(item=>item.score>=Math.min(floor,best)&&item.score>0).sort((a,b)=>b.score-a.score||(b.row.learned===true)-(a.row.learned===true)).slice(0,12).map(({row:{inputSchema,...row}})=>({...row,status:status(row),toolset:toolsetOf(row)}))
    },
    details:async id=>{
      if(typeof id!=='string'||!/^[a-z][a-z0-9_-]{1,79}$/.test(id))throw fail('INVALID_INPUT')
      const row=(await list()).find(row=>row.id===id)
      if(!row)throw fail('INVALID_INPUT')
      return {...row,status:status(row),toolset:toolsetOf(row)}
    }
  }
}
module.exports={createAgentCatalog}
