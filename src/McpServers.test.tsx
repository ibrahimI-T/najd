import { describe, expect, it } from 'vitest'
import { PRESETS, hasPlaceholder } from './McpServers'
import { getCopy } from './copy'

it('MCP templates use common launchers and mark values the user must fill in', () => {
  expect(PRESETS.length).toBeGreaterThanOrEqual(5)
  for (const preset of PRESETS) {
    expect(['npx', 'uvx']).toContain(preset.program)
    expect(preset.args.join(' ')).not.toMatch(/[&|^%!"]/)
  }
  expect(hasPlaceholder(PRESETS.find(p => p.id === 'filesystem')!.args.join('\n'))).toBe(true)
  expect(hasPlaceholder(PRESETS.find(p => p.id === 'fetch')!.args.join('\n'))).toBe(false)
  for (const language of ['ar', 'en'] as const) {
    const s = getCopy(language).capabilities.servers
    expect(s.needsNode).toContain('npx'); expect(s.needsUv).toContain('uvx'); expect(s.errors.PLACEHOLDER).toBeTruthy()
  }
})

describe('service presets', () => {
  it('keep keys in the encrypted environment, pin versions, and ask for the key before adding', () => {
    for (const id of ['fal', 'elevenlabs', 'replicate', 'remote-key']) {
      const preset = PRESETS.find(p => p.id === id)! as { args: string[]; env?: string }
      expect(preset.env, id).toMatch(/^[A-Z_]+=.*<.+>/)
      expect(hasPlaceholder(preset.env!), id).toBe(true)
      expect(preset.args.join(' '), id).not.toMatch(/Bearer|sk-|key=/i)
      expect(preset.args.some(arg => /@\d+\.\d+\.\d+|==\d/.test(arg)), id + ' is pinned').toBe(true)
    }
    expect(PRESETS.find(p => p.id === 'canva')!.args).toContain('https://mcp.canva.com/mcp')
  })
})
