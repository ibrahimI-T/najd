// Independent checks: a failing optional service must not erase healthy services.
async function collectHealth(checks) {
  return Object.fromEntries(await Promise.all(Object.entries(checks).map(async ([key, check]) => {
    try { return [key, await check()] }
    catch { return [key, { installed: false, ready: false, reason: 'HEALTH_CHECK_FAILED:' + key }] }
  })))
}
// Readiness of every capability key the catalog's `needs` and `probe` name. Each source is read on its own and may be synchronous or
// asynchronous; one that throws is "not ready" for its keys only. Before 0.10.33 a synchronous gateway.status() was treated as a promise
// here, the whole check threw and every built-in skill showed "not ready".
const safely = (read, fallback) => Promise.resolve().then(read).then(value => value ?? fallback, () => fallback)
async function workstationHealth({ procedures = [], officePack, browserBridge, gateway, blender = () => false, android = () => false, windowsInstalled, webAvailable, mediaServices, mcpTools }) {
  const [pack, bridge, gatewayState, windowsReady, tools, blenderFound, androidFound] = await Promise.all([safely(officePack, null), safely(browserBridge, null), safely(gateway, null), safely(windowsInstalled, false), safely(mcpTools, []), safely(blender, false), safely(android, false)])
  const list = Array.isArray(tools) ? tools : []
  return { office: { installed: pack?.state === 'ready', ready: pack?.state === 'ready', reason: pack?.state === 'ready' ? null : 'OFFICE_PACK_' + String(pack?.state || 'unknown').toUpperCase() },
    browser: { installed: !!bridge?.paired, ready: !!bridge?.connected, reason: bridge?.connected ? null : 'BROWSER_NOT_CONNECTED' },
    windows: { installed: !!windowsReady, ready: !!windowsReady, reason: windowsReady ? null : 'WINDOWS_NODE_NOT_INSTALLED' },
    ...await collectHealth({
      web: async () => { const ready = (await webAvailable()) === true; return { ready, reason: ready ? null : 'WEB_TOOLS_NOT_READY' } },
      media: async () => { const ready = (await mediaServices()).includes('openai-images'); return { ready, reason: ready ? null : 'MEDIA_NOT_CONFIGURED' } },
      'github-account': async () => ({ ready: list.some(tool => /github/i.test(tool.serverName || tool.server || '')) })
    }),
    scheduler: { ready: true }, packages: { ready: true }, remote: { ready: true }, channels: { ready: true }, memory: { ready: true }, mcp: { ready: list.length > 0 },
    // The owner's Blender (R-080): the 3D skill and plugins are ready when it is installed.
    // The owner's Android SDK and JDK (R-080): Android app building is ready when both are installed.
    'mobile-toolchain': { installed: !!androidFound, ready: !!androidFound, reason: androidFound ? null : 'ANDROID_SDK_NOT_FOUND' },
    '3d-runtime': { installed: !!blenderFound, ready: !!blenderFound, reason: blenderFound ? null : 'BLENDER_NOT_INSTALLED' },
    'web-preview': { ready: true }, 'builtin-browser': { ready: true }, canvas: { ready: true }, 'desktop-pet': { ready: true }, procedures, gateway: { ready: gatewayState?.state === 'healthy' } }
}
module.exports = { collectHealth, workstationHealth }
