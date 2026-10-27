// Operation identities and validated scopes come from main adapters, not model
// text, plugin annotations or a renderer-selected "safe" flag.
const reads=new Map([['library.read','library'],['library.search','library'],['project.read','project'],['project.search','project'],['skills.read','skill'],['connections.apps','connection'],['web.search','web'],['web.extract','web'],['agent.delegate','agent'],['agent.status','agent'],['agent.cancel','agent'],['memory.update','memory'],['media.status','media'],['media.cancel','media'],['browser.read','browser'],['logs.read','logs'],['logs.list','logs'],['process.list','process'],['process.output','process'],['process.stop','process'],['desktop.windows','desktop'],['office.review','office'],['chats.search','chats'],['chats.read','chats'],['extensions.search','extensions'],['knowledge.search','knowledge'],['web.preview','web']])
const approvals=new Set(['files.write','files.patch','files.move','files.delete','terminal.run','python.run','desktop.act','extensions.install','skills.save','library.export','extensions.update','extensions.remove','connections.connect','media.generate','mcp.call','media.transcribe','browser.act','process.start','desktop.open','desktop.read','screen.capture'])
function decideAction(operation,scope){
  if(scope?.protected===true)return {decision:'deny',reason:'PROTECTED_RESOURCE'}
  if(['capabilities.search','capabilities.details'].includes(operation))return {decision:'allow',reason:'DISCOVERY'}
  if(reads.has(operation))return scope?.validated===true&&scope.kind===reads.get(operation)
    ?{decision:'allow',reason:'SCOPED_READ'}:{decision:'deny',reason:'SCOPE_REQUIRED'}
  if(approvals.has(operation))return {decision:'approval',reason:'EXPLICIT_CHANGE'}
  return {decision:'deny',reason:'UNSUPPORTED_OPERATION'}
}
module.exports={decideAction}
