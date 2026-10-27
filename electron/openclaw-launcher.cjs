// Private IPC supplies graceful signals on Windows and closes the Gateway if its owner dies.
const { pathToFileURL } = require('node:url')
const entry = process.argv[2]
if (!entry || !process.connected) throw new Error('INVALID_RUNTIME_LAUNCH')
let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  if (process.listenerCount('SIGTERM')) {
    process.emit('SIGTERM')
    if (process.connected) process.disconnect()
  } else process.exit(process.exitCode || 0)
}
process.on('message', message => { if (message?.type === 'shutdown') shutdown() })
process.once('disconnect', shutdown)
process.argv = [process.execPath, entry, 'gateway', 'run']
import(pathToFileURL(entry).href).catch(() => { process.stderr.write('GATEWAY_BOOT_FAILED\n'); process.exitCode = 1; shutdown() })
