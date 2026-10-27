// Renders health-results.json (from health-check.cjs) as docs/diagnostics/NAJD-HEALTH-MATRIX.md.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const dir = process.argv[2] || path.join(os.homedir(), 'Documents', 'NAJD-health-check')
const report = JSON.parse(fs.readFileSync(path.join(dir, 'health-results.json'), 'utf8'))
const cell = value => String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 260)
const count = status => report.results.filter(row => row.status === status).length
const lines = ['# NAJD health matrix', '',
  `Generated ${report.createdAt} from the **development source tree** (isolated temporary profiles, fake credentials, no owner data). It does not describe the installed build. Retries per check: ${report.retriesPerCheck}.`, '',
  `Summary: PASS ${count('PASS')}, FAIL ${count('FAIL')}, BLOCKED ${count('BLOCKED')}, NOT_TESTED ${count('NOT_TESTED')}, NOT_APPLICABLE ${count('NOT_APPLICABLE')}.`, '',
  'PASS means the listed automated checks ran and passed, not that a live service with real accounts works. BLOCKED and NOT_TESTED are not defects.', '',
  '| Capability | Requirements | Method | Expected | Actual | Status | Error code | Evidence | Fix |', '|---|---|---|---|---|---|---|---|---|']
for (const row of report.results) lines.push(`| ${cell(row.capability)} | ${cell(row.needs)} | ${cell(row.method)} | ${cell(row.expected)} | ${cell(row.actual)}${row.note ? ' ' + cell(row.note) : ''} | ${row.status} | ${cell(row.code)} | ${cell(row.id === 'signature' ? 'Authenticode status' : 'health-check.log')} | ${cell(row.fix || '')} |`)
fs.mkdirSync(path.join(__dirname, '..', 'docs', 'diagnostics'), { recursive: true })
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'diagnostics', 'NAJD-HEALTH-MATRIX.md'), lines.join('\n') + '\n')
console.log('written')
