import { describe, expect, it } from 'vitest'
import { MCP_PRESETS, presetForm } from './mcpPresets'

describe('popular MCP presets', () => {
  it('each one passes the add form rules: short name, npx/uvx or an HTTPS endpoint, simple arguments, unique id', () => {
    expect(new Set(MCP_PRESETS.map(preset => preset.id)).size).toBe(MCP_PRESETS.length)
    for (const preset of MCP_PRESETS) {
      expect(preset.name.length).toBeLessThanOrEqual(40)
      if (preset.needs === 'https') { expect(preset.command).toMatch(/^https:\/\//); expect(preset.args).toEqual([]) }
      else { expect(preset.command).toBe(preset.needs); expect(preset.args.every(arg => /^[\w@./-]+$/.test(arg))).toBe(true) }
      expect(preset.home).toMatch(/^https:\/\//)
      expect(preset.about[0]).toMatch(/[؀-ۿ]/)
    }
  })
  it('fills the form the way the form reads it back', () => {
    const form = presetForm(MCP_PRESETS.find(preset => preset.id === 'playwright')!)
    expect(form).toEqual({ name: 'Playwright', command: 'npx', args: '-y @playwright/mcp@latest' })
  })
})
