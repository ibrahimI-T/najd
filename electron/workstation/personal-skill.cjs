// A personal skill the owner asked NAJD to save (owner request 2026-11-08): written as an ordinary NAJD package (manifest, digest,
// SKILL.md) so it goes through the same verified install, appears under Skills > Added and can be disabled, rolled back or removed like
// any package. It is guidance only: no scripts, no permissions.
const { createHash } = require('node:crypto')
const { zipSync, strToU8 } = require('fflate')

const error = code => Object.assign(new Error(code), { code })
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
// Control characters, and invisible or direction-changing ones that could make the approval show a different name (review 2026-11-08).
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁠-⁩﻿]/

// Normalized as shown in the approval: spaces in the name and purpose collapse; the steps are kept exactly.
function normalizeSkill(input) {
  const name = typeof input?.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
  const description = typeof input?.description === 'string' ? input.description.trim().replace(/\s+/g, ' ') : ''
  const steps = typeof input?.steps === 'string' ? input.steps.trim() : ''
  if (!name || name.length > 80 || description.length < 10 || description.length > 300 || steps.length < 20 || steps.length > 6000 || CONTROL.test(name + description + steps)) throw error('INVALID_INPUT')
  return { name, description, steps }
}

// A stable id from the name. A plain Latin name becomes its slug; a name with any other script, or one cut to fit, also carries a short
// digest of the whole name, so "تقرير PDF" and "ملخص PDF" stay two skills (review 2026-11-08).
function skillId(name) {
  const full = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), slug = full.slice(0, 40).replace(/-+$/, '')
  if (slug.length >= 3 && /^[\x20-\x7e]+$/.test(name) && full.length <= 40) return 'my-' + slug
  return 'my-' + (slug.length >= 3 ? slug + '-' : 'skill-') + sha256(name).slice(0, 8)
}

function nextVersion(current) {
  if (!current) return '1.0.0'
  const [major, minor, patch] = String(current).split(/[-+]/)[0].split('.').map(Number)
  return `${major || 1}.${minor || 0}.${(patch || 0) + 1}`
}

function personalSkillArchive(input, { currentVersion = null } = {}) {
  const { name, description, steps } = normalizeSkill(input)
  const id = skillId(name), version = nextVersion(currentVersion)
  const body = `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${name}\n\n${steps}\n`
  const files = { [id + '/SKILL.md']: strToU8(body) }
  const digest = sha256(Object.keys(files).sort().map(file => file + '\0' + sha256(files[file]) + '\n').join(''))
  const manifest = { schemaVersion: 1, id, version, displayName: name, description, publisher: { name: 'You' }, categories: ['personal'], permissions: [], dependencies: [],
    skills: [id], compatibility: { os: ['win32', 'darwin', 'linux'], arch: ['x64', 'arm64', 'ia32'], minNajd: '0.0.0' }, integrity: { sha256: digest }, license: { spdx: 'LicenseRef-Personal' } }
  return { id, version, name, description, steps, bytes: zipSync({ ...files, 'najd-package.json': strToU8(JSON.stringify(manifest, null, 1)) }) }
}

// The purpose and steps of a saved personal skill, read back from its SKILL.md (as personalSkillArchive writes it), for editing.
function readPersonalSkill(text, name) {
  const value = String(text || '').replace(/\r\n/g, '\n')
  const front = /^---\n([\s\S]*?)\n---\n+/.exec(value)
  const description = front ? ((/^description: (.*)$/m.exec(front[1]) || [])[1] || '').trim() : ''
  let body = front ? value.slice(front[0].length) : value
  const heading = '# ' + name + '\n'
  if (body.startsWith(heading)) body = body.slice(heading.length)
  return { description, steps: body.trim() }
}

module.exports = { personalSkillArchive, normalizeSkill, skillId, nextVersion, readPersonalSkill }
