// Store-readiness checks for the browser extension (Chrome Web Store and Microsoft Edge Add-ons). Used by the unit tests and by the packer,
// so what is tested is exactly what is shipped. Returns { errors, warnings, manifest }.
const fs = require('node:fs'), path = require('node:path')

const ALLOWED_PERMISSIONS = ['storage', 'scripting', 'tabGroups', 'alarms', 'sidePanel', 'contextMenus', 'webRequest']
const walk = (directory, base = directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')]
})
const pngSize = file => { const bytes = fs.readFileSync(file); return bytes.subarray(1, 4).toString() === 'PNG' ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null }

function validateExtension(directory, { store = false } = {}) {
  const errors = [], warnings = []
  const fail = message => errors.push(message)
  const read = file => fs.readFileSync(path.join(directory, file), 'utf8')
  let manifest
  try { manifest = JSON.parse(read('manifest.json')) } catch { fail('manifest.json is missing or not valid JSON'); return { errors, warnings, manifest: null } }
  const files = walk(directory)

  if (manifest.manifest_version !== 3) fail('manifest_version must be 3')
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) fail('version must be 1 to 4 dot-separated integers')
  for (const forbidden of ['key', 'update_url', 'externally_connectable', 'content_scripts', 'web_accessible_resources', 'devtools_page', 'chrome_url_overrides', 'oauth2']) if (manifest[forbidden] !== undefined) fail(`manifest must not declare ${forbidden}`)
  if (manifest.default_locale !== 'en') fail('default_locale must be en')
  if (manifest.name !== '__MSG_extName__' || manifest.description !== '__MSG_extDescription__') fail('name and description must come from the locale files')
  if (Number((manifest.minimum_chrome_version || '0').split('.')[0]) < 116) fail('minimum_chrome_version must be at least 116 (sidePanel.open)')
  if (JSON.stringify([...(manifest.permissions || [])].sort()) !== JSON.stringify([...ALLOWED_PERMISSIONS].sort())) fail('permissions differ from the reviewed list: ' + JSON.stringify(manifest.permissions))
  if (store) {
    if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['http://127.0.0.1/*'])) fail('the store build may require host access to http://127.0.0.1/* only')
    if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(['https://*/*', 'http://*/*'])) fail('the store build must request website access as an optional permission')
  } else if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['<all_urls>'])) fail('the development manifest declares <all_urls>')
  if (manifest.background?.service_worker !== 'service-worker.js' || manifest.background?.type !== 'module') fail('background must be the module service-worker.js')
  if (manifest.side_panel?.default_path !== 'sidepanel.html') fail('side_panel.default_path must be sidepanel.html')
  if (manifest.action?.default_popup) fail('the toolbar button opens the side panel; there is no popup')

  // Icons
  for (const size of [16, 32, 48, 128]) {
    const file = `icons/icon-${size}.png`
    if (manifest.icons?.[String(size)] !== file || manifest.action?.default_icon?.[String(size)] !== file) fail(`icon ${size} is not declared for the extension and the action`)
    if (!files.includes(file)) { fail(`${file} is missing`); continue }
    const found = pngSize(path.join(directory, file))
    if (!found || found.width !== size || found.height !== size) fail(`${file} is not a ${size}x${size} PNG`)
  }

  // Locales: the same keys in Arabic and English, limits the stores enforce, and every key the code uses exists.
  const locales = {}
  for (const lang of ['en', 'ar']) {
    try { locales[lang] = JSON.parse(read(`_locales/${lang}/messages.json`)) } catch { fail(`_locales/${lang}/messages.json is missing or invalid`); locales[lang] = {} }
  }
  const enKeys = Object.keys(locales.en).sort(), arKeys = Object.keys(locales.ar).sort()
  if (JSON.stringify(enKeys) !== JSON.stringify(arKeys)) fail('English and Arabic locale files have different keys')
  for (const lang of ['en', 'ar']) {
    if ((locales[lang].extName?.message || '').length > 75) fail(`${lang}: extName is longer than 75 characters`)
    if ((locales[lang].extDescription?.message || '').length > 132) fail(`${lang}: extDescription is longer than 132 characters`)
    for (const [key, value] of Object.entries(locales[lang])) if (typeof value?.message !== 'string' || !value.message.trim()) fail(`${lang}: ${key} has no message`)
  }
  const used = new Set()
  for (const file of files.filter(name => /\.(js|html|json)$/.test(name) && !name.startsWith('_locales/'))) {
    const source = read(file)
    for (const match of source.matchAll(/__MSG_(\w+)__/g)) used.add(match[1])
    for (const match of source.matchAll(/getMessage\(\s*['"](\w+)['"]/g)) used.add(match[1])
    for (const match of source.matchAll(/data-i18n(?:-placeholder)?="(\w+)"/g)) used.add(match[1])
    for (const match of source.matchAll(/\bt\(\s*['"](\w+)['"]\s*\)/g)) used.add(match[1])
    for (const match of source.matchAll(/'(tool[A-Z]\w+|status[A-Z]\w+|statusText)'/g)) used.add(match[1])
  }
  used.delete('statusText')
  for (const key of used) if (!locales.en[key]) fail(`the code uses the message "${key}" but the locale files do not define it`)

  // No remote code, no dynamic code, only loopback network targets.
  for (const file of files.filter(name => /\.(js|html)$/.test(name))) {
    const source = read(file)
    if (/\beval\s*\(|new\s+Function\s*\(|importScripts\s*\(|setTimeout\s*\(\s*['"]/.test(source)) fail(`${file} uses dynamic code`)
    if (/<script[^>]+src=["']https?:/i.test(source) || /<link[^>]+href=["']https?:/i.test(source)) fail(`${file} loads a remote resource`)
    for (const match of source.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      const target = match[0]
      if (!/^https?:\/\/(127\.0\.0\.1|\$\{|localhost|example\.|\*)/.test(target) && !/^https?:\/\/\*/.test(target)) warnings.push(`${file}: external address ${target}`)
    }
  }
  if (warnings.length) for (const warning of warnings) if (/chrome\.google\.com|microsoftedge|schemas|w3\.org/.test(warning)) warnings.splice(warnings.indexOf(warning), 1)

  // Everything the pages reference exists.
  for (const html of files.filter(name => name.endsWith('.html'))) {
    for (const match of read(html).matchAll(/(?:src|href)="([^"#]+)"/g)) if (!/^https?:/.test(match[1]) && !files.includes(match[1])) fail(`${html} references a missing file: ${match[1]}`)
  }
  for (const file of files.filter(name => name.endsWith('.js'))) {
    for (const match of read(file).matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))
      if (!files.includes(target)) fail(`${file} imports a missing module: ${match[1]}`)
    }
  }
  if (files.some(name => /\.(pem|crx|zip|map|log)$/i.test(name) || name.startsWith('store/') || name.startsWith('node_modules/'))) fail('the extension folder holds files that must not ship (key, package, map, store notes)')
  const total = files.reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0)
  if (total > 2 * 1024 * 1024) warnings.push('the extension is larger than 2 MB')
  return { errors, warnings, manifest, files }
}

// The manifest that goes to the stores: site access is requested by the user at runtime instead of being declared up front.
function storeManifest(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest))
  copy.host_permissions = ['http://127.0.0.1/*']
  copy.optional_host_permissions = ['https://*/*', 'http://*/*']
  return copy
}

module.exports = { validateExtension, storeManifest, ALLOWED_PERMISSIONS, walk }
