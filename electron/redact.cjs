// Removes secrets from short text that is shown in the activity timeline or saved with a reply.
// Conservative on purpose: a harmless value masked by mistake is better than a key shown.
const RULES = [
  // Private key blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted key]'],
  // Authorization headers and bearer tokens
  // CMD quoted forms: set "NAME=value with spaces" and setx "NAME" "value"
  [/(\bset(?:x)?\s+"[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Za-z0-9_]*=)[^"]*"/gi, '$1[redacted]"'],
  [/(\bsetx\s+"?[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Za-z0-9_]*"?\s+)("[^"]*"|\S+)/gi, '$1[redacted]'],
  // Authorization header with any scheme: everything after the colon up to the end of the line or the closing quote
  [/(\b(?:authorization|(?:set-)?cookie)\s*[:=]\s*)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\n"']+)/gi, '$1[redacted]'],
  // curl -u 'user:pass with spaces'
  [/(\bcurl\b[^\n]*?\s(?:-u|--user)[ =]?)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*')/gi, '$1[redacted]'],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  // Well-known token shapes
  [/\b(?:glpat|npm|pypi|shpat|dop_v1|sk_live|sk_test|rk_live)[-_][A-Za-z0-9_-]{16,}\b/g, '[redacted]'],
  [/\bghp_(?=['"]?\s*\+)/g, '[redacted]'],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[redacted]'],
  [/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g, '[redacted]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]'],
  // Quoted JSON-style keys: {"password":"x"}, {'api_key': 'x'}, escaped quotes inside values
  [/("[^"\\]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|authorization|cookie|session[_-]?id)[^"\\]*"\s*:\s*)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,}\]]+)(?:\s*\+\s*(?:"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,}\]+]+))*/gi, '$1[redacted]'],
  [/('[^'\\]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|authorization|cookie|session[_-]?id)[^'\\]*'\s*:\s*)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,}\]]+)(?:\s*\+\s*(?:"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,}\]+]+))*/gi, '$1[redacted]'],
  // key=value / key: value / --flag value for secret-looking names (quoted or bare)
  [/(\b[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|authorization|cookie|session[_-]?id)[\w.-]*\s*[=:]\s*)(\([^\n]*|"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,;&]+)(?:\s*\+\s*(?:"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,;&+]+))*/gi, '$1[redacted]'],
  [/(--?[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|authorization|cookie|session[_-]?id|auth(?![a-z]))[A-Za-z0-9_.-]*(?:=|\s+))(\([^\n]*|"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)(?:\s*\+\s*(?:"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,}\]+]+))*/gi, '$1[redacted]'],
  // PowerShell environment assignments of secret-looking names
  [/(\$env:[\w]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[\w]*\s*=\s*)(\([^\n]*|"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)(?:\s*\+\s*(?:"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+))*/gi, '$1[redacted]'],
  // setx NAME value, set NAME=value and [Environment]::SetEnvironmentVariable('NAME','value') for secret-looking names
  [/(\bsetx\s+[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Za-z0-9_]*\s+)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)/gi, '$1[redacted]'],
  [/(\bset\s+[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Za-z0-9_]*=)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)/gi, '$1[redacted]'],
  // Everything after the name to the end of the line: neither nested expressions nor quoted separators are guessed at.
  [/(SetEnvironmentVariable\(\s*['"][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Za-z0-9_]*['"]\s*,\s*)[^\n]*/gi, '$1[redacted]'],
  // Command-aware credential switches: curl -u/--user user:pass, mysql -pPASS, sshpass -p PASS, cmdkey/net use /pass: /password:
  [/(\bcurl\b[^\n]*?\s(?:-u|--user)[ =]?[^\s:]*:)(\S+)/gi, '$1[redacted]'],
  [/(\bmysql(?:dump|admin)?\b[^\n]*?\s-p)(\S+)/gi, '$1[redacted]'],
  [/(\bsshpass\s+-p\s*)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)/gi, '$1[redacted]'],
  [/(\s\/(?:pass|password|p):)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)/gi, '$1[redacted]'],
  // docker/podman login -p PASS and net use X: \\host\\share PASS (positional)
  [/(\b(?:docker|podman)\s+login\b[^\n]*?\s(?:-p|--password)[ =]?)("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)/gi, '$1[redacted]'],
  [/(\bnet\s+use\s+\S+\s+\S+\s+)(?![/*])("(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+)(?:\s*\+\s*(?:"(?:[^"\\`]|\\.|`.|"")*"|'(?:[^'\\]|\\.|'')*'|\S+))*/gi, '$1[redacted]'],
  // Credentials inside URLs
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@'],
  // Secret-looking query parameters
  [/([?&](?:access_token|token|api_key|apikey|key|secret|password|sig|signature)=)[^&\s]+/gi, '$1[redacted]']
]

// A long run that is a readable path: separators, short segments that read as words (a base64 secret does not).
function looksLikePath(run) {
  const segments = run.split(/[\\/]+/).filter(Boolean)
  if (segments.length < 2 || !segments.every(part => part.length <= 64)) return false
  const word = part => /^[A-Z]?[a-z]+([-_.][A-Za-z0-9]+)*$/.test(part) || /^[A-Z]+$/.test(part)
  return segments.filter(word).length / segments.length >= 0.6
}

function redactText(value, max = 160) {
  let text = String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ')
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement)
  // Long unbroken high-entropy runs (hex, base64) are treated as secrets.
  text = text.replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$|[^A-Za-z0-9])/g, match => looksLikePath(match) ? match : '[redacted]')
  text = text.trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// Several lines (a model's thinking): redacted as one text, so a secret whose value sits on the line after its key is still found
// (C16-02): the rules run once over the whole text with its line breaks (rules that end at a line end still do), then each
// line gets the full single-line pass (control characters, the rules again, long high-entropy runs).
function redactBlock(value, max = 6000) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]+/g, ' ')
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement)
  text = text.split('\n').map(line => redactText(line, Number.MAX_SAFE_INTEGER)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text
}

module.exports = { redactText, redactBlock }
