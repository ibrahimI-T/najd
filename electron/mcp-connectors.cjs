const fail = code => Object.assign(new Error(code), { code })
const ID = 'najd-windows-native'

// Reuse NAJD's sole native-host owner. No renderer command, environment or URL is executable.
// preference: { get(): Promise<boolean|null>, set(value) } remembers whether the user turned the companion off.
function createMcpConnectors({ node, preference = null }) {
  let state = 'disconnected', epoch = 0, starting = null, stopping = null
  // Whether the user allows NAJD's desktop work through the companion. Off until the saved choice is known, off after
  // the user disconnects (also across restarts), on again only when the user connects it (M2-R7-001).
  let userAllowed = false
  const validate = id => { if (id !== ID) throw fail('INVALID_INPUT') }
  // Preference writes run one at a time in call order, so an earlier connect never overwrites a later disconnect
  // (M2-R30-001).
  let writes = Promise.resolve()
  const save = value => { const next = writes.catch(() => {}).then(() => preference?.set(value)); writes = next; return next }
  const status = () => {
    const receipt = node.mcpReceipt()
    if (state === 'connected' && !receipt) state = 'disconnected'
    return { id: ID, state, transport: 'stdio', source: 'OpenClaw Windows native companion',
      sourceRevision: 'd096d5381c9f6aefdcc5f49ca93bc618eaed9c8b',
      protocolVersion: state === 'connected' ? receipt.protocolVersion : null,
      tools: state === 'connected' ? [...receipt.tools] : [], executableConfigurable: false }
  }
  function connect(id) {
    validate(id)
    if (stopping) return stopping.then(() => connect(id))
    if (starting) return starting
    const generation = epoch
    state = 'connecting'
    starting = (async () => {
      try {
        userAllowed = true
        await node.connect()
        if (generation !== epoch) throw fail('CANCELLED')
        state = 'connected'
        // A failed "on" write only means startup will not reconnect by itself, which is the safe side.
        await save(true).catch(() => {})
        return status()
      } catch (error) {
        if (generation === epoch) state = 'failed'
        throw fail(['CANCELLED', 'WINDOWS_NODE_NOT_INSTALLED'].includes(error?.code) ? error.code : 'WINDOWS_NODE_FAILED')
      } finally { starting = null }
    })()
    return starting
  }
  function disconnect(id) {
    validate(id)
    if (stopping) return stopping
    epoch++
    userAllowed = false
    state = 'disconnecting'
    // The user's "off" is saved whether or not the host stops cleanly, and a failed save is reported: a disconnect is
    // never shown as lasting when the next start would reconnect (M2-R30-001).
    const saved = save(false).then(() => true, () => false)
    stopping = (async () => {
      try {
        let stopped = true
        try { await node.stop() } catch { stopped = false }
        const durable = await saved
        state = stopped ? 'disconnected' : 'failed'
        if (!stopped) throw fail('WINDOWS_NODE_FAILED')
        if (!durable) throw fail('PREFERENCE_SAVE_FAILED')
        return status()
      } finally { stopping = null }
    })()
    return stopping
  }
  async function readApps(signal) {
    if (signal?.aborted) throw fail('CANCELLED')
    const generation = epoch
    if (status().state !== 'connected' || !status().tools.includes('system.which')) throw fail('NOT_CONNECTED')
    const apps = await node.discoverApps()
    if (signal?.aborted) throw fail('CANCELLED')
    if (generation !== epoch || status().state !== 'connected') throw fail('NOT_CONNECTED')
    return { apps }
  }
  // Connect at startup unless the user disconnected it before; connecting only prepares the companion.
  async function resume() {
    // A disconnect while the saved choice is being read wins: startup does not re-enable it (M2-R8-004).
    const generation = epoch
    // A saved choice that cannot be read counts as off; only "no choice yet" (null) connects (M2-R31-003).
    const saved = preference ? await preference.get().catch(() => false) : null
    if ((saved !== true && saved !== null) || generation !== epoch) return status()
    userAllowed = true
    // Where the companion is not installed (development checkouts), stay "disconnected" instead of "failed".
    return connect(ID).catch(error => { if (error.code === 'WINDOWS_NODE_NOT_INSTALLED' && state === 'failed') state = 'disconnected'; return status() })
  }
  return { list: () => [status()], connect, disconnect, readApps, resume, allowed: () => userAllowed }
}
module.exports = { createMcpConnectors }
