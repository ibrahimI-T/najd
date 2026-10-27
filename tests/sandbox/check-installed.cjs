// Runs INSIDE Windows Sandbox with the installed bundled Node (najd-gateway.exe). No project dependencies.
// Usage: najd-gateway.exe check-installed.cjs <out-dir> <phase> [marker]
//   phase "baseline": prepare (if the old version needs it), wait for the gateway, save a chat marker.
//   phase "final":    verify components, gateway, a safe /apps task with approval, and the marker if given.
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
const [out, phase, marker] = process.argv.slice(2)
const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'NAJD AGENT', 'NAJD AGENT.exe')
const port = 9333, result = { phase, exe, checks: {} }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const save = () => fs.writeFileSync(path.join(out, `check-${phase}.json`), JSON.stringify(result, null, 2))

async function page() {
  for (let i = 0; i < 120; i++) {
    try { const rows = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const row = rows.find(r => r.type === 'page'); if (row) return row } catch {}
    await sleep(1000)
  }
  throw new Error('app window did not open')
}
function cdp(url) {
  const ws = new WebSocket(url); let id = 0; const waits = new Map()
  ws.onmessage = e => { const m = JSON.parse(e.data); if (waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id) } }
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  return { ready, close: () => ws.close(), async ev(expression) {
    const n = ++id; ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    const m = await new Promise(r => waits.set(n, r))
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'evaluate failed')
    return m.result?.result?.value
  } }
}

;(async () => {
  const started = Date.now()
  const child = spawn(exe, ['--remote-debugging-port=' + port], { detached: true, stdio: 'ignore' })
  try {
    const client = cdp((await page()).webSocketDebuggerUrl); await client.ready
    result.checks.windowSeconds = (Date.now() - started) / 1000
    let runtime = await client.ev('window.najdRuntime.status()')
    result.checks.runtimeAtStart = runtime
    if (runtime.state !== 'ready' && phase === 'baseline') {
      await client.ev('window.najdRuntime.prepare()')
      for (let i = 0; i < 900 && !['ready', 'failed'].includes(runtime.state); i++) { await sleep(1000); runtime = await client.ev('window.najdRuntime.status()') }
      result.checks.runtimeAfterPrepare = runtime
    }
    let gateway
    for (let i = 0; i < 240; i++) { gateway = await client.ev('window.najdGateway.status()'); if (['healthy', 'failed', 'not_installed'].includes(gateway.state)) break; await sleep(1000) }
    result.checks.gateway = gateway; result.checks.gatewaySeconds = (Date.now() - started) / 1000
    if (gateway.state === 'failed') {
      // Diagnostic: is the failure persistent or a slow first start?
      const retry = Date.now()
      gateway = await client.ev('window.najdGateway.start().catch(e=>({state:"failed",errorCode:String(e.message)}))')
      for (let i = 0; i < 240 && !['healthy', 'failed', 'not_installed'].includes(gateway.state); i++) { await sleep(1000); gateway = await client.ev('window.najdGateway.status()') }
      result.checks.gatewayRetry = gateway; result.checks.gatewayRetrySeconds = (Date.now() - retry) / 1000
    }
    if (phase === 'baseline') {
      result.checks.marker = await client.ev(`(async()=>{const s=await window.najdSessions.create();await window.najdSessions.append(s.id,'user',${JSON.stringify(marker)});return s.id})()`)
    } else {
      result.checks.task = await client.ev(`(async()=>{let t=await window.najdCore.startTask('/apps',crypto.randomUUID(),'ollama');for(let i=0;i<100&&['QUEUED','RUNNING'].includes(t.state);i++){await new Promise(r=>setTimeout(r,100));t=await window.najdCore.getTask(t.id)}
        if(t.state!=='WAITING_APPROVAL')return {state:t.state,error:t.errorCode};t=await window.najdCore.respondApproval(t.approvalId,'ALLOW_ONCE');for(let i=0;i<600&&['QUEUED','RUNNING'].includes(t.state);i++){await new Promise(r=>setTimeout(r,100));t=await window.najdCore.getTask(t.id)}return {state:t.state,output:String(t.output||'').slice(0,600)}})()`)
      result.checks.welcome = await client.ev('document.querySelector(".welcome")?.innerText.replace(/\\s+/g," ")')
      if (marker) result.checks.markerFound = await client.ev(`(async()=>JSON.stringify(await window.najdSessions.search(${JSON.stringify(marker)})).includes(${JSON.stringify(marker)}))()`)
    }
    client.close()
  } catch (error) { result.error = String(error.message || error) }
  finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    await sleep(3000); save()
  }
})()
