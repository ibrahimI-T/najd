const fs = require('node:fs/promises')
const path = require('node:path')
const MAX_FILE = 1024 * 1024, MAX_TOTAL = 2 * 1024 * 1024

function createLegalNotices({ appRoot, resourcesRoot, electronRoot, packaged = false }) {
  const files = [
    ['Bundled application components', packaged ? path.join(resourcesRoot, 'THIRD-PARTY-NOTICES.txt') : path.join(appRoot, 'build/THIRD-PARTY-NOTICES.txt')],
    ['Electron', path.join(electronRoot, packaged ? 'LICENSE.electron.txt' : 'LICENSE')]
  ]
  if (!packaged) {
    for (const component of ['openclaw', 'hermes-agent', 'openclaw-windows-node'])
      files.push([`${component} (pinned source; not necessarily distributed)`, path.join(appRoot, 'third_party', component, 'LICENSE')])
    files.push(['Native UIA interop', path.join(appRoot, 'native/windows-node-host/licenses/Interop.UIAutomationClient.LICENSE.txt')])
    files.push(['Ollama 0.31.1 (installed runtime used only for development proof)', path.join(appRoot, 'docs/third-party-notices/OLLAMA-0.31.1-LICENSE.txt')])
    files.push(['Qwen2.5 1.5B (development model; not distributed)', path.join(appRoot, 'docs/third-party-notices/QWEN2.5-1.5B-LICENSE.txt')])
  }
  return async () => {
    try {
      const notices = ['NAJD AGENT — open-source acknowledgements',
        'Original components retain their original authorship and license terms.',
        'Full Chromium notices are distributed beside the application executable in LICENSES.chromium.html.']
      // Bounded reads: each file at most MAX_FILE bytes and all of them at most MAX_TOTAL (the bundled notices list grows with
      // the renderer's dependencies; Mermaid's took it past 256 KB).
      let total = 0
      for (const [title, filename] of files) {
        const handle = await fs.open(filename, 'r')
        try {
          const buffer = Buffer.alloc(MAX_FILE + 1)
          let size = 0
          while (size < buffer.length) {
            const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size)
            if (!bytesRead) break
            size += bytesRead
          }
          total += size
          if (size === 0 || size > MAX_FILE || total > MAX_TOTAL) throw new Error('Invalid notice size')
          notices.push(`${title}\n${buffer.subarray(0, size).toString('utf8')}`)
        } finally { await handle.close() }
      }
      return notices.join('\n\n')
    } catch { throw Object.assign(new Error('LEGAL_NOTICES_UNAVAILABLE'), { code: 'LEGAL_NOTICES_UNAVAILABLE' }) }
  }
}
module.exports = { createLegalNotices }
