import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { getCopy } from './copy'
import { CapabilityCard, capabilityInput, capabilityError } from './CapabilitySettings'

const skill: NajdCapability = { id: 'najd-read-document', title: 'Read a document', description: 'Read',
  version: '1.0.0', digest: 'a'.repeat(64), source: 'NAJD built-in', tool: 'read-file',
  permission: 'files:read', installed: true, enabled: false, updateRequired: false }

it('keeps capability input fixed to the selected tool', () => {
  expect(capabilityInput('najd-read-document', ' C:\\demo.txt ', 'ignored')).toEqual({ path: 'C:\\demo.txt' })
  expect(capabilityInput('najd-find-documents', ' C:\\docs ', ' report ')).toEqual({ path: 'C:\\docs', query: 'report' })
  expect(capabilityInput('najd-list-apps', 'ignored', 'ignored')).toEqual({})
})

it('renders bilingual locked controls and provenance using the existing design system', () => {
  for (const language of ['ar', 'en'] as const) {
    const t = getCopy(language)
    const html = renderToStaticMarkup(<CapabilityCard skill={skill} t={t} locked={false} onAction={async () => {}} onRun={async () => {}} />)
    expect(html).toContain('browser-card capability-card')
    expect(html).toContain(t.capabilities.names['najd-read-document'])
    expect(html).toContain('files:read')
    expect(html).toContain('a'.repeat(64))
    expect(html).toMatch(/data-cap-action="run"[^>]*disabled/)
    expect(html).toContain('data-cap-action="enable"')
    expect(html).not.toContain('data-cap-action="install"')
  }
})

it('disallows running outdated or busy capabilities and distinguishes preserved-store errors', () => {
  const t = getCopy('en')
  const html = renderToStaticMarkup(<CapabilityCard skill={{ ...skill, enabled: true, updateRequired: true }} t={t} locked onAction={async () => {}} onRun={async () => {}} />)
  expect(html).toMatch(/data-cap-action="run"[^>]*disabled/)
  expect(html).toContain(t.capabilities.updateRequired)
  expect(capabilityError(new Error('IPC: CAPABILITY_STORE_UNAVAILABLE'), t)).toBe(t.capabilities.storeError)
  expect(capabilityError(new Error('unknown'), t)).toBe(t.capabilities.error)
})
