// Skill archive extraction off the main process (R9-001). Streams the ZIP with fflate and inflates only SKILL.md
// entries, counting the bytes actually produced: an entry whose real output passes MAX_BODY, whatever size the archive
// declares, is refused while it inflates. Other entries are known by name only. The main process runs this in a
// worker with a memory cap and a deadline and terminates it on cancel.
const { parentPort, workerData } = require('node:worker_threads')
const { Unzip, UnzipInflate, UnzipPassThrough } = require('fflate')

const { bytes, maxEntries, maxBody, maxSkills, subdirectory = '' } = workerData
// A folder link installs only that folder: its skills are the only ones counted and inflated (R14-001). GitHub
// archives hold everything under one top-level folder, which is not part of the requested path.
const wanted = subdirectory ? subdirectory.replace(/^\/+|\/+$/g, '') + '/' : ''
const inFolder = name => !wanted || name.split('/').slice(1).join('/').startsWith(wanted)
const fail = code => { throw Object.assign(new Error(code), { code }) }
// The same rule as external-skills.cjs safeEntry().
const safeEntry = name => typeof name === 'string' && !name.includes('\0') && !name.startsWith('/') && !/^[a-zA-Z]:/.test(name) && !name.split(/[\\/]/).includes('..')

try {
  const names = [], bodies = {}
  let count = 0, wanted = 0, failure = null
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  unzip.onfile = file => {
    if (failure) return
    if (++count > maxEntries || !safeEntry(file.name)) { failure = 'ARCHIVE_INVALID'; return }
    if (file.name.endsWith('/')) return
    names.push(file.name)
    if (file.name.split('/').pop() !== 'SKILL.md' || !inFolder(file.name)) return
    if (++wanted > maxSkills) { failure = 'ARCHIVE_INVALID'; return }
    const chunks = []
    let size = 0, skipped = false
    file.ondata = (error, chunk, final) => {
      if (failure || skipped) return
      if (error) { failure = 'ARCHIVE_INVALID'; return }
      size += chunk.length
      // Past the limit the entry stops inflating and is left out, as an oversized body always was.
      if (size > maxBody) { skipped = true; chunks.length = 0; try { file.terminate() } catch {} return }
      chunks.push(chunk)
      if (final) bodies[file.name] = Buffer.concat(chunks.map(part => Buffer.from(part))).toString('utf8')
    }
    file.start()
  }
  const data = new Uint8Array(bytes)
  // Pushed in slices so a refusal stops the work early.
  for (let offset = 0; offset < data.length && !failure; offset += 1 << 16) unzip.push(data.subarray(offset, Math.min(data.length, offset + (1 << 16))), offset + (1 << 16) >= data.length)
  if (failure) fail(failure)
  parentPort.postMessage({ names, bodies })
} catch (error) { parentPort.postMessage({ error: error?.code === 'ARCHIVE_INVALID' ? 'ARCHIVE_INVALID' : 'ARCHIVE_INVALID' }) }
