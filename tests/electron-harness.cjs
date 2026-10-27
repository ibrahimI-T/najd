const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, dialog } = require('electron')
const { generateKeyPairSync, sign } = require('node:crypto')

const root = path.resolve(process.env.NAJD_TEST_USER_DATA || '')
const temp = path.resolve(os.tmpdir()) + path.sep
const port = Number(process.env.NAJD_TEST_DEBUG_PORT)
if (!root.startsWith(temp) || !path.basename(root).startsWith('najd-desktop-test-') ||
    !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid isolated test configuration')

fs.mkdirSync(root, { recursive: true })
app.setPath('userData', root)
fs.mkdirSync(root + '-documents', { recursive: true })
app.setPath('documents', root + '-documents')
app.setPath('sessionData', root)
app.commandLine.appendSwitch('remote-debugging-port', String(port))
// Test windows open behind the developer's foreground app; without this Chromium reports them occluded
// ("hidden") and NAJD correctly pauses background polling, which would stall UI assertions.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
// The fixture picker exists only in this harness; production uses the OS dialog.
dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options?.title === 'Add documents to NAJD'
  ? fs.existsSync(path.join(root + '-imports', 'pick.txt')) ? [path.join(root + '-imports', fs.readFileSync(path.join(root + '-imports', 'pick.txt'), 'utf8').trim())]
  : fs.existsSync(path.join(root + '-imports', 'photo.png')) ? [path.join(root + '-imports', 'photo.png')]
  : fs.existsSync(path.join(root + '-imports', 'report.md')) ? [path.join(root + '-imports', 'report.md')] : [path.join(root + '-imports', 'report.docx'), path.join(root + '-imports', 'report.pdf')]
  : [path.join(root, options?.defaultPath?.startsWith('najd-learning-') ? options.defaultPath : options?.properties?.includes('openFile') ? 'memory-backup.json' : 'read-fixtures')] })
dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: path.join(root, options?.defaultPath?.startsWith('najd-learning-') ? options.defaultPath : options?.defaultPath === 'najd-memory-backup.json' ? 'memory-backup.json' : 'export-fixture.txt') })
// MCP server confirmation: answered by the smoke (file present = add) so both outcomes are tested.
const showMessageBox = dialog.showMessageBox.bind(dialog)
dialog.showMessageBox = async (window, options) => String(options?.message || '').startsWith('Add MCP server')
  ? { response: fs.existsSync(path.join(root, 'mcp-confirm.txt')) ? 0 : 1, checkboxChecked: false } : showMessageBox(window, options)
const releaseRoot = path.resolve(__dirname, '../release')
const packageRoot = path.resolve(process.env.NAJD_TEST_PACKAGE_DIR || releaseRoot)
if (packageRoot !== releaseRoot && !packageRoot.startsWith(releaseRoot + path.sep)) throw new Error('Invalid package test directory')
const appRoot = process.env.NAJD_TEST_PACKAGED === '1'
  ? path.join(packageRoot, 'win-unpacked/resources/app.asar/electron') : path.join(__dirname, '../electron')
if (process.env.NAJD_REAL_OLLAMA_URL) {
  // Real local inference with a fixture-owned endpoint; never replace its HTTP response.
  const local = require(path.join(appRoot, 'ollama.cjs'))
  const factory = local.createOllamaClient
  local.createOllamaClient = () => factory({ baseUrl: process.env.NAJD_REAL_OLLAMA_URL })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const response = await originalFetch(url, options)
    if (String(url) === process.env.NAJD_REAL_OLLAMA_URL + '/api/chat' && JSON.parse(options.body).tools) {
      const result = await response.clone().json()
      fs.appendFileSync(path.join(root, 'local-tool-diagnostic.jsonl'), JSON.stringify({ done: result.done, reason: result.done_reason, message: result.message }).slice(0, 4096) + '\n')
    }
    return response
  }
}
// Exercise the real auth/IPC/UI with a local callback and a signed test identity.
// Only this temporary-data harness replaces upstream HTTP and the browser opener.
const authModule = require(path.join(appRoot, 'chatgpt-auth.cjs'))
const { createChatGPTInference } = require(path.join(appRoot, 'chatgpt-inference.cjs'))
const realAuth = authModule.createChatGPTAuth
function libraryFixture(body) {
  const prompt = body.input.findLast(item => item.role === 'user' && typeof item.content === 'string' && !item.content.startsWith('NAJD_ATTACHMENT_DATA\n'))?.content || ''
  // Agent platform M2 end-to-end: save data.csv, run managed Python on it, answer with the computed total.
  if (prompt.includes('python csv fixture')) {
    const last = body.input.at(-1), names = body.tools.map(tool => tool.name)
    const call = (name, args, call_id) => [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id }]
    const say = text => [{ type: 'message', content: [{ type: 'output_text', text }] }]
    let output
    if (last.type !== 'function_call_output') {
      if (!names.includes('najd_python_run') || !names.includes('najd_files_write')) throw Error('Coding profile tools missing: ' + names.join(','))
      output = call('najd_files_write', { path: 'data.csv', content: 'n\n2\n3\n5\n' }, 'csv-write')
    } else if (last.call_id === 'csv-write') {
      const written = JSON.parse(last.output)
      output = written.status === 'written' ? call('najd_python_run', { code: 'import csv\nwith open("data.csv") as f:\n    print(sum(int(row["n"]) for row in csv.DictReader(f)))', cwd: '' }, 'csv-run')
        : say('The data file was not saved: ' + written.status)
    } else {
      const ran = JSON.parse(last.output)
      output = say(ran.status === 'finished' ? 'The total is ' + String(ran.output).trim() + '.' : 'Python did not run: ' + (ran.status || ran.error))
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 900, output_tokens: 40, total_tokens: 940 } } }) + '\n\n')
  }
  if (prompt.includes('connected apps fixture')) {
    const last = body.input.at(-1)
    let output
    if (last.type !== 'function_call_output') output = [{ type: 'function_call', name: 'najd_capabilities_details', arguments: '{"id":"najd-windows-native"}', call_id: 'native-details' }]
    else if (last.call_id === 'native-details') {
      if (!JSON.parse(last.output).ready || !body.tools.some(tool => tool.name === 'najd_connections_apps')) throw Error('Actual connected read adapter missing')
      output = [{ type: 'function_call', name: 'najd_connections_apps', arguments: '{}', call_id: 'native-read' }]
    } else {
      const result = JSON.parse(last.output)
      if (result.apps?.length !== 5 || !result.apps.every(app => typeof app.found === 'boolean')) throw Error('Real native app-discovery result missing')
      output = [{ type: 'message', content: [{ type: 'output_text', text: 'Native connected read result verified.' }] }]
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n')
  }
  if (prompt.includes('upstream skill fixture')) {
    const last = body.input.at(-1)
    const skill = require(path.join(appRoot, 'upstream-skills.json')).skills.find(row => row.source === 'hermes' && row.name === 'systematic-debugging')
    let output
    const call = (name, args, call_id) => [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id }]
    if (last.type !== 'function_call_output') output = call('najd_capabilities_search', { query: 'systematic-debugging' }, 'skill-search')
    else if (last.call_id === 'skill-search') {
      if (!JSON.parse(last.output).some(row => row.id === skill.id && row.ready && row.mode === 'instructions')) throw Error('Actual enabled skill missing from catalog')
      output = call('najd_capabilities_details', { id: skill.id }, 'skill-details')
    } else if (last.call_id === 'skill-details') {
      if (!body.tools.some(tool => tool.name === 'najd_skills_read')) throw Error('Skill schema not loaded')
      output = call('najd_skills_read', { id: skill.id, offset: 0, limit: 2000 }, 'skill-read')
    } else {
      if (!last.output.includes('# Systematic Debugging') || !last.output.includes(skill.sourceRevision)) throw Error('Original pinned guidance did not reach model')
      output = [{ type: 'message', content: [{ type: 'output_text', text: 'Original Hermes debugging guidance verified.' }] }]
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n')
  }
  if (prompt.includes('grounding fixture')) {
    const excerpts = body.input.filter(item => item.role === 'user' && typeof item.content === 'string' && item.content.startsWith('NAJD_ATTACHMENT_DATA\n'))
    if (!excerpts.length || !excerpts.some(item => item.content.includes('GROUNDING-PLAN-MILESTONE: durable recovery before desktop tools'))) throw Error('Current Markdown attachment content missing')
    fs.appendFileSync(path.join(root, 'grounding-dispatch.jsonl'), JSON.stringify({ grounded: true, calls: body.input.filter(item => item.type === 'function_call_output').length }) + '\n')
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Grounded plan: durable recovery before desktop tools.' }] }] } }) + '\n\n')
  }
  if (prompt.includes('external skill fixture')) {
    const last = body.input.at(-1)
    const call = (name, args, call_id) => [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id }]
    let output
    if (last.type !== 'function_call_output') output = call('najd_capabilities_search', { query: 'fixture-deploy' }, 'ext-search')
    else if (last.call_id === 'ext-search') {
      if (!JSON.parse(last.output).some(row => row.id === 'ext-fixture-deploy' && row.ready)) throw Error('Installed external skill missing from catalog')
      output = call('najd_capabilities_details', { id: 'ext-fixture-deploy' }, 'ext-details')
    } else if (last.call_id === 'ext-details') output = call('najd_skills_read', { id: 'ext-fixture-deploy', offset: 0, limit: 2000 }, 'ext-read')
    else {
      if (!last.output.includes('EXTERNAL-SKILL-GUIDANCE')) throw Error('External guidance did not reach model')
      output = [{ type: 'message', content: [{ type: 'output_text', text: 'External skill guidance verified.' }] }]
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n')
  }
  if (prompt.includes('video fixture')) {
    const parts = body.input.filter(item => item.role === 'user' && Array.isArray(item.content)).flatMap(item => item.content)
    const frames = parts.filter(part => part.type === 'input_image' && /^data:image\/jpeg;base64,/.test(part.image_url))
    const text = parts.find(part => part.type === 'input_text')?.text || ''
    if (frames.length < 2 || !text.includes('frameTimesSeconds') || !text.includes('Audio is not included')) throw Error('Video frames did not reach the model')
    // A recording with sound must offer transcription; a silent one must not.
    const audible = /"audioSeconds":/.test(body.instructions || '')
    if (audible !== body.tools.some(tool => tool.name === 'najd_video_transcribe') || audible !== text.includes('najd_video_transcribe')) throw Error('Transcription offer does not match the sound track')
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: `Video frames received: ${frames.length}.` }] }] } }) + '\n\n')
  }
  if (prompt.includes('image fixture')) {
    const parts = body.input.filter(item => item.role === 'user' && Array.isArray(item.content)).flatMap(item => item.content)
    const image = parts.find(part => part.type === 'input_image')
    if (!image || !/^data:image\/jpeg;base64,/.test(image.image_url) || !parts.some(part => part.type === 'input_text' && part.text.includes('"kind":"image"'))) throw Error('Picture did not reach the model as vision input')
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Picture received as vision input.' }] }] } }) + '\n\n')
  }
  if (prompt.includes('web research fixture')) {
    const last = body.input.at(-1)
    let output
    if (last.type !== 'function_call_output') {
      if (!body.tools.some(tool => tool.name === 'najd_web_extract')) throw Error('Web tools missing although the core is available')
      output = [{ type: 'function_call', call_id: 'web-1', name: 'najd_web_extract', arguments: JSON.stringify({ url: 'https://example.com' }) }]
    } else {
      if (!last.output.includes('Example Domain')) throw Error('Original Hermes extraction did not reach the model')
      output = [{ type: 'message', content: [{ type: 'output_text', text: 'Web extraction verified.' }] }]
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n')
  }
  if (prompt.includes('mcp fixture')) {
    // Discover through the catalog, load details, then call the external tool through najd_mcp_call.
    const last = body.input.at(-1)
    let output
    if (last.type !== 'function_call_output') {
      if (!body.tools.some(tool => tool.name === 'najd_mcp_call') || !body.instructions.includes('External MCP tools')) throw Error('MCP tool context missing')
      output = [{ type: 'function_call', call_id: 'mcp-search', name: 'najd_capabilities_search', arguments: JSON.stringify({ query: 'mcp echo' }) }]
    } else if (last.call_id === 'mcp-search') {
      const id = JSON.parse(last.output).find(row => row.kind === 'mcp-tool' && row.tool === 'echo')?.id
      if (!id) throw Error('MCP tool not found in catalog: ' + last.output.slice(0, 300))
      output = [{ type: 'function_call', call_id: 'mcp-details', name: 'najd_capabilities_details', arguments: JSON.stringify({ id }) }]
    } else if (last.call_id === 'mcp-details') {
      const details = JSON.parse(last.output)
      if (!details.inputSchema?.required?.includes('text')) throw Error('MCP input schema missing')
      output = [{ type: 'function_call', call_id: 'mcp-call', name: 'najd_mcp_call', arguments: JSON.stringify({ server: details.server, tool: details.tool, arguments: JSON.stringify({ text: 'from model' }) }) }]
    } else {
      const result = JSON.parse(last.output)
      output = [{ type: 'message', content: [{ type: 'output_text', text: result.status === 'completed' ? 'MCP said: ' + result.text : 'MCP call ' + result.status }] }]
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n')
  }
  // Activity UI showcase (owner request 2026-10-21): several real tools in sequence, then an approval for the file write.
  if (prompt.includes('activity showcase fixture')) {
    const last = body.input.at(-1)
    const call = (id, name, args) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }]
    let output
    if (last.type !== 'function_call_output') output = call('sh-1', 'najd_capabilities_search', { query: 'files' })
    else if (last.call_id === 'sh-1') output = call('sh-2', 'najd_files_list', { path: '.' })
    else if (last.call_id === 'sh-2') output = call('sh-5', 'najd_files_read', { path: 'notes-that-do-not-exist.txt', offset: 0, limit: 200 })
    else if (last.call_id === 'sh-5') output = call('sh-3', 'najd_files_search', { path: '.', query: 'report' })
    else if (last.call_id === 'sh-3') output = call('sh-4', 'najd_files_write', { path: 'showcase/report.md', content: ['# Report', '', 'Written by the activity showcase fixture.', ''].join(String.fromCharCode(10)) })
    else output = [{ type: 'message', content: [{ type: 'output_text', text: 'Done. I searched capabilities, listed and searched the workspace, then wrote showcase/report.md.' }] }]
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + String.fromCharCode(10, 10))
  }
  if (prompt.includes('workspace write fixture')) {
    const last = body.input.at(-1)
    let output
    if (last.type !== 'function_call_output') {
      if (!body.tools.some(tool => tool.name === 'najd_files_write') || !body.tools.some(tool => tool.name === 'najd_terminal_run')) throw Error('Workspace tools missing')
      output = [{ type: 'function_call', call_id: 'ws-write', name: 'najd_files_write', arguments: JSON.stringify({ path: 'smoke/out.txt', content: 'APPROVED-CONTENT' }) }]
    } else {
      const result = JSON.parse(last.output)
      output = [{ type: 'message', content: [{ type: 'output_text', text: result.status === 'written' ? 'Workspace write verified' : 'Workspace write declined' }] }]
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n')
  }
  if (!prompt.includes('library agent fixture')) return null
  if (!body.tools || !body.instructions.includes('NAJD, a desktop assistant running')) throw Error('Agent tool context missing')
  const id = /"id":"([a-f0-9]{64})"/.exec(body.instructions)?.[1]
  if (!id) throw Error('Attachment identity missing')
  if (!JSON.stringify(body.input).includes('LIBRARY-OWNED-DOCUMENT')) throw Error('Verified attachment excerpt missing from first request')
  const last = body.input.at(-1)
  let output
  if (last.type !== 'function_call_output') output = [{ type: 'function_call', call_id: 'fixture-details', name: 'najd_capabilities_details', arguments: JSON.stringify({ id: 'najd-library-read' }) }]
  else if (last.call_id === 'fixture-details') {
    if (!body.tools.some(tool => tool.name === 'najd_library_read')) throw Error('Schema not loaded')
    output = [{ type: 'function_call', call_id: 'fixture-read', name: 'najd_library_read', arguments: JSON.stringify({ id, offset: 0, limit: 500 }) }]
  } else {
    if (!last.output.includes('LIBRARY-OWNED-DOCUMENT')) throw Error('Actual extracted document was not returned')
    output = [{ type: 'message', content: [{ type: 'output_text', text: 'NAJD library tool result verified' }] }]
  }
  return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } }) + '\n\n')
}
authModule.createChatGPTAuth = options => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let authorization
  const json = data => new Response(JSON.stringify(data))
  const fakeFetch = async (url, options) => {
    if (url.endsWith('/revoke')) return new Response(null, { status: 200 })
    if (url.endsWith('/models')) return json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'NAJD test model', visibility: 'list' }] })
    if (url.endsWith('/responses')) {
      const body = JSON.parse(options.body)
      if (process.env.NAJD_TEST_OUTPUT_CAP && body.max_output_tokens !== undefined) throw new Error('An output cap was sent although usage limits were removed')
      if (JSON.stringify(body).includes('MODEL-TOOL-LOCAL-ONLY')) throw new Error('Local preview leaked into model context')
      const libraryReply = libraryFixture(body)
      if (libraryReply) return libraryReply
      if (body.tools?.[0]?.name === 'preview_requested_file') {
        if (body.tools[0]?.name !== 'preview_requested_file' || !body.input.at(-1)?.content.endsWith(path.join(root, 'read-fixtures', 'model-tool.txt'))) throw new Error('Unexpected fixture tool scope')
        return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
          { type: 'function_call', name: 'preview_requested_file', arguments: '{}' }
        ] } }) + '\n\n')
      }
      const demanding = body.input.at(-1).content.includes('Debug')
      if (body.reasoning?.effort !== (demanding ? 'high' : 'low')) throw new Error('Fixture effort mismatch')
      return new Response('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'NAJD subscription test OK' }) + '\n\ndata: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }) + '\n\n')
    }
    if (url.endsWith('jwks.json')) return json({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256' }] })
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url')
    const claims = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', sub: 'fixture-user', aud: 'oaiapp_fixture', nonce: authorization.searchParams.get('nonce'), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), pair.privateKey).toString('base64url')
    return json({ token_type: 'Bearer', access_token: 'NAJD-TEST-ACCESS', refresh_token: 'NAJD-TEST-REFRESH', id_token: `${header}.${claims}.${signature}`, expires_in: 3600, scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' })
  }
  return realAuth({ ...options, fetchImpl: fakeFetch, inference: createChatGPTInference({ fetchImpl: fakeFetch }), openBrowser: async url => {
    authorization = new URL(url)
    const callback = new URL(authorization.searchParams.get('redirect_uri'))
    callback.searchParams.set('state', authorization.searchParams.get('state'))
    callback.searchParams.set('code', 'fixture-code')
    callback.searchParams.set('client_id', 'oaiapp_fixture')
    void fetch(callback).catch(() => {})
  } })
}
// Distinct API fixture; production adapters and encrypted stores remain real.
const providerModule = require(path.join(appRoot, 'provider-client.cjs'))
const realClient = providerModule.createProviderClient
providerModule.createProviderClient = id => realClient(id, { fetchImpl: async (url, options) => {
  if (id !== 'openai-api' || !url.startsWith('https://api.openai.com/v1/')) throw new Error('Unexpected fixture destination')
  if (options.headers.Authorization !== 'Bearer sk-najd-API-TEST-KEY') throw new Error('Credential isolation failed')
  if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-6.1-sol' }] }))
  const body = JSON.parse(options.body)
  if (process.env.NAJD_TEST_OUTPUT_CAP && body.max_output_tokens !== undefined) throw new Error('An output cap was sent although usage limits were removed')
  if (JSON.stringify(body).includes('MODEL-TOOL-LOCAL-ONLY') || JSON.stringify(body).includes('MEMORY-PRIVATE-ONLY')) throw new Error('Private local data leaked into another provider')
  const libraryReply = libraryFixture(body)
  if (libraryReply) return libraryReply
  const currentInput = body.input.at(-1).content
  if (currentInput.includes('personality proof') && !body.instructions?.includes('PERSONALITY-WARM-FIXTURE')) throw new Error('Selected personality missing from provider instructions')
  if (currentInput.includes('personality disabled proof') && body.instructions?.includes('PERSONALITY-WARM-FIXTURE')) throw new Error('Disabled personality still entered model context')
  if (currentInput.includes('learned preference proof') && !body.instructions?.includes('I prefer concise answers.')) throw new Error('Approved preference missing from selected context')
  if (currentInput.includes('corrected memory proof') && !body.instructions?.includes('I prefer balanced answers.')) throw new Error('Corrected preference missing from selected context')
  if (currentInput.includes('disabled learned proof') && /I prefer (concise|balanced) answers\.|Workflow lesson: verify results\./.test(body.instructions || '')) throw new Error('Disabled learned context was still sent')
  if (currentInput.includes('lesson shared proof') && !body.instructions?.includes('Workflow lesson: verify results.')) throw new Error('Related approved lesson missing')
  if ((currentInput.includes('lesson private proof') || currentInput.includes('unrelated lesson proof')) && body.instructions?.includes('Workflow lesson: verify results.')) throw new Error('Unconsented or unrelated lesson leaked')
  if (currentInput.includes('graph note proof') && !body.instructions?.includes('green-pipeline-rollback-rule')) throw new Error('A note the request needs did not reach the model from the memory graph')
  if (currentInput.includes('graph unrelated proof') && body.instructions?.includes('green-pipeline-rollback-rule')) throw new Error('An unrelated request received a memory note')
  const manual = body.input.at(-1).content.includes('manual effort')
  if (body.reasoning?.effort !== (manual ? 'max' : 'low')) throw new Error('API effort mismatch')
  if (body.instructions?.startsWith('NAJD_LEARNING_REVIEW.')) throw new Error('Unexpected billable learning review')
  const reply = 'NAJD API test OK'
  return new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: reply })}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n`)
} })
if (process.env.NAJD_TEST_UPDATE_FIXTURE === '1') {
  const memoryModule=require(path.join(appRoot,'memory-store.cjs')), memoryFactory=memoryModule.createMemoryStore
  memoryModule.createMemoryStore=filename=>{const store=memoryFactory(filename);return{...store,save:input=>input.text==='BLOCK-UPDATE-FIXTURE'?new Promise((_,reject)=>setTimeout(()=>reject(Error('Owned fixture write failure')),1000)):store.save(input)}}
  const { EventEmitter } = require('node:events'), { createHash } = require('node:crypto')
  const module = require(path.join(appRoot,'updates.cjs')), real = module.createUpdateService
  const keys = generateKeyPairSync('ed25519'), bytes = Buffer.from('NAJD owned update fixture'), filename = path.join(root,'update-fixture.exe')
  fs.writeFileSync(filename,bytes)
  const record = { format:'najd-update-v1',channel:require(path.join(appRoot,'update-config.json')).channel,platform:'win32-x64',version:'0.6.1',publishedAt:new Date().toISOString(),notes:'Isolated development update proof',file:{name:'NAJD-AGENT-Setup-0.6.1.exe',size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')} }
  const payload=Buffer.from(JSON.stringify(record)), envelope=JSON.stringify({payload:payload.toString('base64'),signature:sign(null,payload,keys.privateKey).toString('base64')})
  module.createUpdateService = options => real({ ...options, enabled:true,version:'0.6.0',config:{...options.config,publicKey:keys.publicKey},getManifest:async()=>envelope,createUpdater:()=>{
    const adapter=new EventEmitter();let cancelled=false
    adapter.checkForUpdates=async()=>{cancelled=false;return {updateInfo:{version:'0.6.1',files:[{url:record.file.name,...record.file}]},cancellationToken:{cancel(){cancelled=true}}}}
    adapter.downloadUpdate=async()=>{for(let tick=1;tick<=50;tick++){await new Promise(resolve=>setTimeout(resolve,100));if(cancelled)throw Error('cancelled');adapter.emit('download-progress',{percent:tick*2,transferred:Math.floor(bytes.length*tick/50)})}return[filename]}
    adapter.quitAndInstall=()=>fs.writeFileSync(path.join(root,'update-install-proof.json'),JSON.stringify({verified:true,version:'0.6.1'}))
    return adapter
  } })
}
if (process.env.NAJD_TEST_DURABLE_ACTION === '1') {
  // Owned executor fixture only: exercise real core/IPC/journal without opening an app.
  const windowsModule = require(path.join(appRoot, 'windows-node.cjs'))
  const factory = windowsModule.createWindowsNode
  windowsModule.createWindowsNode = options => ({ ...factory(options), runDemo: async (application, signal) => {
    const record = JSON.parse(fs.readFileSync(path.join(root, 'najd-data/actions.json'), 'utf8')).actions.at(-1)
    if (record.state !== 'EXECUTING') throw Error('Effect dispatched before durable claim')
    fs.appendFileSync(path.join(root, 'durable-dispatch.jsonl'), JSON.stringify({ application }) + '\n')
    if (fs.readFileSync(path.join(root, 'durable-mode'), 'utf8') === 'hang') return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(Error('CANCELLED'), { code: 'CANCELLED', effectStarted: true })), { once: true })
    })
    return { app: application, opened: true, owned: true, focused: true, inputVerified: true, closed: true, cleaned: true, verified: true }
  } })
}
require(path.join(appRoot, 'main.cjs'))
