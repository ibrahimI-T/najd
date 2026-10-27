const { verify } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })
function readSignedJson(raw, publicKey, maxBytes = 32768) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > maxBytes) throw fail('ENVELOPE_INVALID')
  let envelope
  try { envelope = JSON.parse(raw) } catch { throw fail('ENVELOPE_INVALID') }
  if (!envelope || Array.isArray(envelope) || Object.keys(envelope).sort().join(',') !== 'payload,signature' ||
      typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw fail('ENVELOPE_INVALID')
  try {
    const bytes = Buffer.from(envelope.payload, 'base64'), signature = Buffer.from(envelope.signature, 'base64')
    if (bytes.toString('base64') !== envelope.payload || signature.length !== 64 || signature.toString('base64') !== envelope.signature ||
        !verify(null, bytes, publicKey, signature)) throw fail('SIGNATURE_INVALID')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) { throw fail(error.code === 'SIGNATURE_INVALID' ? error.code : 'ENVELOPE_INVALID') }
}
module.exports = { readSignedJson }
