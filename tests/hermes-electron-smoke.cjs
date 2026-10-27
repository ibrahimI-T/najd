const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')

async function childProof() {
  const { app, dialog } = require('electron')
  const directory = process.env.NAJD_HERMES_IPC_PROFILE
  assert.ok(directory && path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
  assert.match(path.basename(directory), /^najd-hermes-electron-/)
  app.setPath('userData', directory)
  app.setPath('sessionData', directory)
  const capabilityProof = process.argv.includes('--capabilities')
  const fixtureRoot = path.join(directory, 'read-fixtures'), fixtureFile = path.join(fixtureRoot, 'document.txt')
  if (capabilityProof) {
    await fs.mkdir(fixtureRoot)
    await fs.writeFile(fixtureFile, 'CAPABILITY IPC PROOF')
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtureRoot] })
  }
  const local = require('../electron/ollama.cjs')
  let calls = 0
  local.createOllamaClient = () => ({ listModels: async () => ['fixture'], chat: async () => {
    calls++; return { kind: 'message', text: '42' }
  } })
  app.once('browser-window-created', (event, window) => {
    window.webContents.once('did-finish-load', async () => {
      try {
        const proof = await window.webContents.executeJavaScript(`(async () => {
          const id = crypto.randomUUID();
          const task = await window.najdCore.startTask('/hermes Reply only with 42.', id, 'ollama', 'fixture');
          const repeated = await window.najdCore.startTask('/hermes Reply only with 42.', id, 'ollama', 'fixture');
          let result;
          for (let i=0;i<1200;i++) {
            result = await window.najdCore.getTask(task.id);
            if (!['QUEUED','RUNNING'].includes(result.state)) break;
            await new Promise(resolve => setTimeout(resolve,100));
          }
          const unsupported = await window.najdCore.startTask('/hermes Plan only.', crypto.randomUUID(), 'chatgpt', 'fixture');
          let denied;
          for (let i=0;i<100;i++) {
            denied = await window.najdCore.getTask(unsupported.id);
            if (!['QUEUED','RUNNING'].includes(denied.state)) break;
            await new Promise(resolve => setTimeout(resolve,20));
          }
          return { sameIntent:task.id===repeated.id, result, denied, limits:await window.najdProviders.limits() };
        })()`)
        assert.equal(proof.sameIntent, true)
        assert.equal(proof.result.state, 'COMPLETED', proof.result.errorCode)
        assert.equal(proof.result.output, '42')
        assert.equal(proof.denied.errorCode, 'TOOLS_NOT_SUPPORTED')
        assert.equal(proof.limits.cloudAttempts, 0)
        assert.equal(calls, 1)
        if (capabilityProof) {
          const result = await window.webContents.executeJavaScript(`(async () => {
            async function settled(task) {
              for(let i=0;i<1200;i++) {
                task=await window.najdCore.getTask(task.id);
                if(!['QUEUED','RUNNING'].includes(task.state)) return task;
                await new Promise(resolve=>setTimeout(resolve,50));
              }
              throw new Error('Task timeout');
            }
            const id='najd-read-document', input={path:${JSON.stringify(fixtureFile)}};
            await window.najdCapabilities.install(id);
            const installed=(await window.najdCapabilities.list()).find(item=>item.id===id);
            await window.najdCapabilities.setEnabled(id,true);
            let task=await settled(await window.najdCapabilities.run(id,input,crypto.randomUUID()));
            await window.najdCore.respondApproval(task.approvalId,'ALLOW_ONCE');
            const noRoots=await settled(task);
            await window.najdFiles.grantRoot();
            task=await settled(await window.najdCapabilities.run(id,input,crypto.randomUUID()));
            await window.najdCore.respondApproval(task.approvalId,'DENY');
            const denied=await settled(task);
            task=await settled(await window.najdCapabilities.run(id,input,crypto.randomUUID()));
            await window.najdCore.respondApproval(task.approvalId,'ALLOW_ONCE');
            const allowed=await settled(task);
            await window.najdCapabilities.setEnabled(id,false);
            let disabled=false;
            try{await window.najdCapabilities.run(id,input,crypto.randomUUID())}catch{disabled=true}
            await window.najdCapabilities.remove(id);
            const removed=(await window.najdCapabilities.list()).find(item=>item.id===id);
            const connected=await window.najdMcp.connect('najd-windows-native');
            const disconnected=await window.najdMcp.disconnect('najd-windows-native');
            const sources=(await window.najdCapabilities.discoverSources()).map(source=>({
              id:source.source,count:source.skills.length,readOnly:source.skills.every(skill=>!skill.installable&&!skill.executable)
            }));
            return {installed,noRoots,denied,allowed,disabled,removed,connected,disconnected,sources};
          })()`)
          assert.equal(result.installed.enabled, false)
          assert.equal(result.noRoots.errorCode, 'NO_ROOTS')
          assert.equal(result.denied.errorCode, 'PERMISSION_DENIED')
          assert.equal(result.allowed.output, 'CAPABILITY IPC PROOF')
          assert.equal(result.disabled, true)
          assert.equal(result.removed.installed, false)
          assert.equal(result.connected.protocolVersion, '2024-11-05')
          assert.equal(result.disconnected.state, 'disconnected')
          assert.deepEqual(result.sources.map(source => source.id), ['openclaw', 'hermes'])
          assert.ok(result.sources.every(source => source.count > 0 && source.readOnly))
          assert.equal(calls, 1)
        }
        process.send({ passed: true })
      } catch { process.send({ passed: false }); process.exitCode = 1 }
      app.quit()
    })
  })
  require('../electron/main.cjs')
}

async function parentProof() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-hermes-electron-'))
  let child, timer, exited = false, passed = false
  try {
    child = spawn(require('electron'), [__filename, ...(process.argv.includes('--capabilities') ? ['--capabilities'] : [])], { cwd: path.resolve(__dirname, '..'), windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NAJD_HERMES_IPC_PROFILE: directory } })
    child.on('message', message => { if (message.passed === true) passed = true })
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { exited = true; resolve(code) }) })
    const deadline = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Electron Hermes proof timed out')), 150000) })
    assert.equal(await Promise.race([closed, deadline]), 0)
    assert.equal(passed, true, 'Source Electron IPC proof did not complete')
    assert.deepEqual(await fs.readdir(path.join(directory, 'najd-data/engines/hermes')), [])
    console.log('PASS: actual Electron preload/sender-checked IPC/core/Hermes/provider route, intent deduplication, unsupported ChatGPT refusal, zero cloud attempts, graceful app/worker cleanup. Model response is a fixture; UI files unchanged.')
    if (process.argv.includes('--capabilities')) console.log('PASS: registry install/enable/NO_ROOTS/deny/real approved file read/disable/remove and real native MCP initialize/connect/disconnect through source Electron IPC.')
  } finally {
    clearTimeout(timer)
    if (child && !exited) await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }).catch(() => {})
    if (exited) await fs.rm(directory, { recursive: true, force: true })
  }
}
if (process.versions.electron) childProof().catch(() => { process.exitCode = 1; require('electron').app.quit() })
else parentProof().catch(error => { console.error(error); process.exitCode = 1 })
