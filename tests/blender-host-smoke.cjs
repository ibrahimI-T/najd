// Real Blender through the real NAJD desktop host (R-080): the 3D tool finds the installed Blender, runs a script in background mode
// inside the host's job object, builds a scene, exports a GLB and renders a PNG into the working folder; the result lists both new
// files and the script's exit code; a failing script reports its error and exit code. Temporary folders only.
// Usage: node tests/blender-host-smoke.cjs (needs Blender and the built host; without Blender it says so and verifies nothing).
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { createPythonTools } = require('../electron/python-tools.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')
const { findBlender } = require('../electron/blender.cjs')

async function main() {
  const blender = findBlender()
  if (!blender) { console.log('SKIPPED: Blender is not installed on this machine; nothing was verified.'); return }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-blender-host-'))
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state') })
  const logs = createExecLogs({ directory: path.join(root, 'logs') })
  const work = path.join(root, 'work'); fs.mkdirSync(work)
  let approval = null
  const tools = createPythonTools({ kind: 'blender', getPython: async () => blender, host: node, logs, stateRoot: path.join(root, 'engine-state'), timeoutMs: 240000,
    checkFolder: async () => ({ absolute: work, exists: true }), createFolder: async () => work })
  const allow = { requestApproval: async (tool, card) => { approval = { tool, card }; return 'ALLOW_ONCE' }, conversationId: 'smoke' }
  try {
    const code = [
      'import bpy, os',
      'bpy.ops.wm.read_factory_settings(use_empty=True)',
      'bpy.ops.mesh.primitive_monkey_add(location=(0, 0, 0))',
      'bpy.ops.object.light_add(type="SUN", location=(4, -4, 6))',
      'bpy.ops.object.camera_add(location=(0, -6, 2), rotation=(1.35, 0, 0))',
      'scene = bpy.context.scene; scene.camera = bpy.context.object',
      'scene.render.engine = "BLENDER_WORKBENCH"; scene.render.resolution_x = 320; scene.render.resolution_y = 240',
      'scene.render.filepath = os.path.join(os.getcwd(), "najd-render.png"); bpy.ops.render.render(write_still=True)',
      'bpy.ops.export_scene.gltf(filepath=os.path.join(os.getcwd(), "najd-model.glb"))',
      'print("NAJD 3D OK", len(bpy.data.objects))'
    ].join('\n')
    const done = await tools.run({ code, cwd: '' }, allow)
    assert.equal(approval.tool, 'najd-blender-run'); assert.match(approval.card.summary, /Blender script/)
    assert.equal(done.exitCode, 0, JSON.stringify(done).slice(0, 2000))
    assert.match(done.output, /NAJD 3D OK 3/)
    assert.ok(fs.statSync(path.join(work, 'najd-model.glb')).size > 1000, 'GLB written')
    assert.ok(fs.statSync(path.join(work, 'najd-render.png')).size > 1000, 'PNG rendered')
    const listed = JSON.stringify(done.files || done)
    assert.match(listed, /najd-model\.glb/); assert.match(listed, /najd-render\.png/)
    const failed = await tools.run({ code: 'raise RuntimeError("NAJD expected failure")', cwd: '' }, allow)
    assert.notEqual(failed.exitCode, 0)
    let all = '', offset = 0
    while (offset !== null) { const page = await logs.read({ logId: failed.logId, offset, conversationId: 'smoke' }); all += page.text; offset = page.nextOffset }
    assert.match(all, /NAJD expected failure/)
    console.log(`Blender host smoke passed: ${path.basename(path.dirname(blender))} in background mode through the host; approval card named Blender; monkey scene exported to GLB (${fs.statSync(path.join(work, 'najd-model.glb')).size} bytes) and rendered to PNG, both listed as outputs; a failing script reported its error and a non-zero exit code.`)
  } finally {
    await node.stop()
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch (error) { console.warn('cleanup left', root, error.code) }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
