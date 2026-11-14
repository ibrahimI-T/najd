// Phase 14: page permission requests. Electron grants them unless told otherwise. NAJD's own page needs only to copy to the
// clipboard, go full screen and, for voice input, use the microphone (audio only); everything else (camera, location, notifications...) and any request from a frame
// inside it (a page the model wrote and the owner runs in a code block) is refused.
const ALLOWED = new Set(['clipboard-sanitized-write', 'fullscreen'])

function createPermissionPolicy({ isAppWindow }) {
  const own = (contents, url) => !!contents && isAppWindow(contents) === true && typeof url === 'string' && url.startsWith('file:')
  // The microphone for voice input (R-080): audio only, NAJD's own page, main frame. A request that includes video is refused.
  const audioOnly = (permission, details) => permission === 'media' && (Array.isArray(details?.mediaTypes) ? details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'audio') : details?.mediaType === 'audio')
  const decide = (contents, permission, url, isMainFrame, details) => (ALLOWED.has(permission) || audioOnly(permission, details)) && isMainFrame !== false && own(contents, url)
  return {
    request: (contents, permission, callback, details) => callback(decide(contents, permission, details?.requestingUrl, details?.isMainFrame, details)),
    check: (contents, permission, origin, details) => decide(contents, permission, details?.requestingUrl || origin, details?.isMainFrame, details)
  }
}

module.exports = { createPermissionPolicy, ALLOWED }
