const {test}=require('node:test'),assert=require('node:assert/strict')
const {decideAction}=require('../electron/action-policy.cjs')
test('ordinary validated library/project reads are automatic; missing or protected scope is denied',()=>{
  assert.equal(decideAction('capabilities.search').decision,'allow')
  for(const kind of ['library','project'])for(const action of ['read','search']){
    assert.equal(decideAction(kind+'.'+action,{kind,validated:true}).decision,'allow')
    assert.equal(decideAction(kind+'.'+action).decision,'deny')
    assert.equal(decideAction(kind+'.'+action,{kind,validated:true,protected:true}).decision,'deny')
  }
})
test('mutations, installations and general execution require approval; unknown tools cannot authorize themselves',()=>{
  for(const id of ['files.write','files.patch','files.delete','terminal.run','python.run','desktop.act','extensions.install','extensions.update','extensions.remove','connections.connect'])assert.equal(decideAction(id,{kind:'project',validated:true}).decision,'approval')
  assert.equal(decideAction('terminal.run',{kind:'project',validated:true,readOnly:true}).decision,'approval')
  assert.equal(decideAction('plugin.claimed-safe',{kind:'library',validated:true}).decision,'deny')
  assert.equal(decideAction('project.read',{kind:'library',validated:true}).decision,'deny')
})
