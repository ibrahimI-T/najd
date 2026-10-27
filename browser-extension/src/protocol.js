// Shared constants for the NAJD AGENT browser extension. NAJD listens on loopback only, on one of these fixed ports
// (spread across distant ranges: Windows can reserve whole blocks), so the extension can find it again after a restart.
export const BRIDGE_PORTS = [38127, 38128, 31227, 31228, 27127, 27128, 39127, 33127]

// Manual link code from NAJD Settings: "<port>:<64 hex>" (a one-time code that pairs this browser once).
export function parsePairCode(value) {
  const match = /^([1-9]\d{0,4}):([a-f0-9]{64})$/.exec(String(value || '').trim())
  if (!match) return null
  const port = Number(match[1])
  return port <= 65535 ? { port, code: match[2] } : null
}

// Only ordinary web pages can be opened by NAJD.
export function allowedUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

export const ASK_MAX_CHARS = 4000
// Site access NAJD needs to work in its own tab (granted once by the user; optional in the store build).
export const SITE_ORIGINS = ['https://*/*', 'http://*/*']

// True for an address that is not public: this computer, a private or link-local network, carrier-grade NAT, multicast, documentation and special ranges.
// Addresses are parsed, not matched as text: IPv6 is read into its eight groups (any spelling), embedded IPv4 (mapped, NAT64, 6to4) is judged as IPv4, and only global
// unicast IPv6 (2000::/3) can be public. The same rules as electron/web-preview.cjs (a test keeps them equal); anything that cannot be read is private.
function privateIPv4(address) {
  const parts = address.split('.').map(Number)
  const [a, b, c] = parts
  return parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255) ||
    a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || (a === 192 && b === 88 && c === 99)
}
function ipv6Groups(address) {
  let value = String(address).toLowerCase().replace(/%.*$/, '')
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const octets = dotted[1].split('.').map(Number)
    if (octets.some(octet => octet > 255)) return null
    const [a, b, c, d] = octets
    value = value.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(group => /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN)
  return groups.length === 8 && groups.every(Number.isInteger) ? groups : null
}
export function privateIp(address) {
  const text = String(address || '').trim().replace(/^\[|\]$/g, '')
  if (!text) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) return privateIPv4(text)
  const groups = ipv6Groups(text)
  if (!groups) return true
  const embedded = () => [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
  const zeros = count => groups.slice(0, count).every(group => group === 0)
  if (zeros(5) && groups[5] === 0xffff) return privateIPv4(embedded()) // IPv4-mapped, whatever its spelling
  if (zeros(6)) return true // ::, ::1 and the deprecated IPv4-compatible form
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(group => group === 0)) return privateIPv4(embedded()) // NAT64
  const first = groups[0]
  if ((first & 0xe000) !== 0x2000) return true // only global unicast (2000::/3) can be public: site-local, unique-local, link-local, multicast and the rest are not
  if (first === 0x2001 && (groups[1] === 0x0db8 || groups[1] < 0x0200)) return true // documentation, Teredo, IETF special
  if (first === 0x3fff || first === 0x3ffe) return true
  if (first === 0x2002) return privateIPv4([groups[1] >> 8, groups[1] & 255, groups[2] >> 8, groups[2] & 255].join('.')) // 6to4
  return false
}
