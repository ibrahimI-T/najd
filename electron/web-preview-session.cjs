// One in-memory Electron session and hidden window per page preview (I2-007), shared by main and the smoke test.
// The session refuses permissions and downloads, checks every request with the preview's allowRequest(), and sends
// https through the preview's fetchHttps() (connections pinned to validated public addresses, I2-001). release()
// removes the handler and clears the session's storage, cache and connections.
const { randomUUID } = require('node:crypto')

function previewSessionFactory({ BrowserWindow, session, nativeImage, preview }) {
  return async ({ width, height, origin = null }) => {
    const ses = session.fromPartition('najd-preview-' + randomUUID())
    // WebRTC cannot reach anything (R11-001): no direct UDP (policy below) and, for TCP, only a proxy that does not
    // exist. Loopback still bypasses the proxy for the dev server; https never touches the network stack (fetchHttps).
    // If setting up fails part way, nothing is left behind.
    try { await ses.setProxy({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' }) }
    catch (error) { await ses.clearStorageData().catch(() => {}); throw error }
    // Every Node request this session started is stopped when the capture is released (I3-005).
    const lifetime = new AbortController()
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', event => event.preventDefault())
    ses.webRequest.onBeforeRequest((details, callback) => {
      void preview().allowRequest(details.webContentsId, details.url, details.method).then(ok => callback({ cancel: !ok }), () => callback({ cancel: true }))
    })
    ses.protocol.handle('https', request => preview().fetchHttps(request, { signal: lifetime.signal }))
    ses.protocol.handle('http', request => preview().fetchLocal(request, { signal: lifetime.signal, origin }))
    const window = new BrowserWindow({ show: false, width, height, useContentSize: true,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, session: ses, backgroundThrottling: false } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    return {
      window,
      // A picture of the whole page at the current viewport size, so the layout is not changed by the capture.
      async screenshot({ width: w, height: h }) {
        const tool = window.webContents.debugger
        tool.attach('1.3')
        try {
          const { data } = await tool.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
          return nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
        } finally { try { tool.detach() } catch {} }
      },
      async release() {
        lifetime.abort()
        try { ses.protocol.unhandle('https') } catch {}
        try { ses.protocol.unhandle('http') } catch {}
        await ses.clearStorageData().catch(() => {})
        await ses.clearCache().catch(() => {})
        await ses.closeAllConnections?.().catch?.(() => {})
      }
    }
  }
}

module.exports = { previewSessionFactory }
