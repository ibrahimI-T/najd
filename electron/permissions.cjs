// Phase 14: page permission requests. Electron grants them unless told otherwise. NAJD's own page needs only to copy to the
// clipboard and go full screen; everything else (camera, microphone, location, notifications...) and any request from a frame
// inside it (a page the model wrote and the owner runs in a code block) is refused.
const ALLOWED = new Set(['clipboard-sanitized-write', 'fullscreen'])

function createPermissionPolicy({ isAppWindow }) {
  const own = (contents, url) => !!contents && isAppWindow(contents) === true && typeof url === 'string' && url.startsWith('file:')
  const decide = (contents, permission, url, isMainFrame) => ALLOWED.has(permission) && isMainFrame !== false && own(contents, url)
  return {
    request: (contents, permission, callback, details) => callback(decide(contents, permission, details?.requestingUrl, details?.isMainFrame)),
    check: (contents, permission, origin, details) => decide(contents, permission, details?.requestingUrl || origin, details?.isMainFrame)
  }
}

module.exports = { createPermissionPolicy, ALLOWED }
