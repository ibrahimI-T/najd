const { redactText, redactBlock } = require('./redact.cjs')
const MAX_EVENTS = 160
// A model's thinking or an advisor's note: several lines, longer than a detail line.
const THINKING_CHARS = 6000
const limitOf = type => type === 'reasoning.text' ? THINKING_CHARS : type === 'reasoning.summary' ? 240 : 160
const types = new Set(['task.started','task.completed','task.failed','task.cancelled','task.unknown_effect','approval.requested','approval.resolved','tool.started','tool.completed','tool.failed','reasoning.summary','reasoning.text'])
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const date = value => typeof value === 'string' && value.length <= 30 && Number.isFinite(Date.parse(value))
const name = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)
// Either no event carries a seq (older records) or all do, positive and strictly increasing.
function validSeq(events) {
  if (!Array.isArray(events)) return false
  const withSeq = events.filter(event => object(event) && event.seq !== undefined)
  if (!withSeq.length) return true
  return withSeq.length === events.length && events.every((event, index) => Number.isSafeInteger(event.seq) && event.seq > 0 && (index === 0 || event.seq > events[index - 1].seq))
}
function validActivity(value) {
  return object(value) && Object.keys(value).every(key=>['version','startedAt','finishedAt','events'].includes(key)) &&
    value.version===1 && date(value.startedAt) && (value.finishedAt===null || date(value.finishedAt) && Date.parse(value.finishedAt)>=Date.parse(value.startedAt)) &&
    validSeq(value.events) && Array.isArray(value.events) && value.events.length>0 && value.events.length<=MAX_EVENTS && value.events.every(event=>
      object(event) && Object.keys(event).every(key=>['seq','type','time','tool','skill','target','decision','detail'].includes(key)) &&
      (event.seq===undefined || Number.isSafeInteger(event.seq) && event.seq>0) && types.has(event.type) && date(event.time) && (event.tool===undefined || name(event.tool)) &&
      (event.skill===undefined || name(event.skill)) &&
      (event.detail===undefined || typeof event.detail==='string' && event.detail.length>0 && event.detail.length<=limitOf(event.type) && !(event.type==='reasoning.text' ? /[\x00-\x09\x0b-\x1f]/ : /[\x00-\x1f]/).test(event.detail)) &&
      (event.target===undefined || ['chrome','edge','notepad','calc','mspaint'].includes(event.target)) &&
      (event.decision===undefined || ['ALLOW_ONCE','DENY'].includes(event.decision)))
}
// Records saved before redaction existed are cleaned when they are loaded; the next save persists the cleaned text.
function sanitizeActivity(activity) {
  if (!object(activity) || !Array.isArray(activity.events)) return activity
  for (const event of activity.events) if (object(event) && typeof event.detail === 'string') {
    const clean = event.type === 'reasoning.text' ? redactBlock(event.detail, THINKING_CHARS) : redactText(event.detail, limitOf(event.type))
    if (clean) event.detail = clean; else delete event.detail
  }
  return activity
}
module.exports = {validActivity, sanitizeActivity, MAX_EVENTS, THINKING_CHARS}
