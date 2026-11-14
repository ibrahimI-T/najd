const {test}=require('node:test'),assert=require('node:assert/strict')
const {createAgentCatalog}=require('../electron/agent-catalog.cjs')
test('catalog reflects enabled skills but never invents a runnable agent adapter',async()=>{
  let enabled=false
  const catalog=createAgentCatalog({registry:{list:async()=>[{id:'najd-read-document',title:'Read a document',description:'Read text',installed:true,enabled,updateRequired:false,tool:'read-file',source:'NAJD built-in',version:'1.0.0'}]},connectors:{list:()=>[{id:'native',state:'disconnected',source:'OpenClaw',sourceRevision:'pin',tools:[]}]}})
  assert.equal((await catalog.details('najd-read-document')).enabled,false)
  enabled=true
  const skill=await catalog.details('najd-read-document')
  assert.equal(skill.enabled,true);assert.equal(skill.ready,false);assert.equal(skill.reason,'AGENT_ADAPTER_PENDING')
  assert.equal((await catalog.search('read')).filter(row=>row.kind!=='toolset').length,1)
  assert.ok((await catalog.search('read')).some(row=>row.kind==='toolset'&&row.toolset==='files-read'),'the toolset to load is found too')
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
  assert.equal((await catalog.search('mcp')).filter(row=>row.kind==='mcp-tool').length,2)
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
test('discovery understands Arabic and everyday words and always names the toolset to load (owner request 2026-11-09)', async () => {
  const catalog=createAgentCatalog({registry:{list:async()=>[]},connectors:{list:()=>[]}})
  const top=async query=>(await catalog.search(query)).map(row=>row.toolset)
  assert.ok((await top('اكتب لي ملف وورد')).includes('office'),'Word in Arabic')
  assert.ok((await top('جدول اكسل للمصاريف')).includes('office'),'Excel in Arabic')
  assert.ok((await top('عرض تقديمي عن الذهب')).includes('office'),'PowerPoint in Arabic')
  assert.ok((await top('ابحث في الانترنت')).includes('web'),'web search in Arabic')
  assert.ok((await top('مجسم ثلاثي الأبعاد')).includes('3d'),'3D in Arabic')
  assert.ok((await top('تطبيق أندرويد')).includes('mobile'),'Android in Arabic')
  assert.ok((await top('افتح المتصفح')).includes('browser'),'browser in Arabic')
  for (const row of await catalog.search('toolset')) assert.equal(row.status,'loadable')
})
