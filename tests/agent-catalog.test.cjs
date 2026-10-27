const {test}=require('node:test'),assert=require('node:assert/strict')
const {createAgentCatalog}=require('../electron/agent-catalog.cjs')
test('catalog reflects enabled skills but never invents a runnable agent adapter',async()=>{
  let enabled=false
  const catalog=createAgentCatalog({registry:{list:async()=>[{id:'najd-read-document',title:'Read a document',description:'Read text',installed:true,enabled,updateRequired:false,tool:'read-file',source:'NAJD built-in',version:'1.0.0'}]},connectors:{list:()=>[{id:'native',state:'disconnected',source:'OpenClaw',sourceRevision:'pin',tools:[]}]}})
  assert.equal((await catalog.details('najd-read-document')).enabled,false)
  enabled=true
  const skill=await catalog.details('najd-read-document')
  assert.equal(skill.enabled,true);assert.equal(skill.ready,false);assert.equal(skill.reason,'AGENT_ADAPTER_PENDING')
  assert.equal((await catalog.search('read')).length,1)
  assert.equal((await catalog.details('native')).ready,false)
  await assert.rejects(catalog.details('../../secret'),{code:'INVALID_INPUT'})
})
test('catalog search is bounded and does not expose arbitrary executable config',async()=>{
  const catalog=createAgentCatalog({registry:{list:async()=>Array.from({length:30},(_,i)=>({id:'item-'+i,title:'File reader',description:'read',installed:true,enabled:true,tool:'read-file',source:'NAJD',version:'1.0.0',command:'SECRET-COMMAND'}))},connectors:{list:()=>[]}})
  const result=await catalog.search('file')
  assert.equal(result.length,12);assert.equal(JSON.stringify(result).includes('SECRET-COMMAND'),false)
  await assert.rejects(catalog.search('x'.repeat(201)),{code:'INVALID_INPUT'})
})

test('catalog distinguishes enabled instruction guidance from executable dependencies',async()=>{
  const catalog=createAgentCatalog({registry:{list:async()=>[]},connectors:{list:()=>[]},getSkills:async()=>[
    {id:'hermes-example',name:'example',description:'Original guidance',source:'hermes',enabled:true,body:'PRIVATE GUIDANCE BODY'}]})
  const row=await catalog.details('hermes-example')
  assert.equal(row.ready,true);assert.equal(row.mode,'instructions');assert.equal(row.dependenciesReady,false)
  assert.equal(JSON.stringify(row).includes('PRIVATE GUIDANCE BODY'),false)
})
test('connected MCP tools are searchable by topic, and details carry the exact server, tool and input schema',async()=>{
  const schema={type:'object',properties:{repo:{type:'string'}},required:['repo']}
  const catalog=createAgentCatalog({registry:{list:async()=>[]},connectors:{list:()=>[]},getMcpTools:async()=>[
    {server:'github',serverName:'GitHub',name:'list_issues',title:'',description:'List issues of a repository',inputSchema:schema,hints:{readOnly:true}},
    {server:'github',serverName:'GitHub',name:'List.Issues',description:'Same name after cleanup',inputSchema:{type:'object'},hints:{}}]})
  const found=await catalog.search('issues')
  assert.deepEqual(found.map(row=>row.id),['mcp-github-list_issues','mcp-github-list-issues'])
  assert.equal(found[0].inputSchema,undefined,'search results stay small');assert.equal(found[0].status,'executable')
  const details=await catalog.details('mcp-github-list_issues')
  assert.equal(details.server,'github');assert.equal(details.tool,'list_issues');assert.deepEqual(details.inputSchema,schema);assert.equal(details.effect,'external-with-approval')
  assert.match(await catalog.summary(),/2 external MCP tools \(mcp-github-list_issues, mcp-github-list-issues\)/)
  assert.equal((await catalog.search('mcp')).length,2)
})

test('search ranks by matching words, so a long query still finds a saved skill, which comes first', async () => {
  const skills=[{id:'docx',name:'docx',description:'Word documents',enabled:true,source:'bundled'},
    {id:'my-weekly-document-conversions',name:'weekly document conversions',description:'Convert the weekly Excel and Word files to CSV and Markdown',enabled:true,source:'NAJD (learned)',learned:true}]
  const catalog=createAgentCatalog({registry:{list:async()=>[]},connectors:{list:async()=>[]},getSkills:async()=>skills})
  const found=await catalog.search('file conversion office documents spreadsheets weekly conversions')
  assert.equal(found[0].id,'my-weekly-document-conversions')
  assert.deepEqual(await catalog.search('zzz qqq'),[])
  assert.match(await catalog.summary(),/2 enabled skill guides \(weekly document conversions, docx\)/)
})