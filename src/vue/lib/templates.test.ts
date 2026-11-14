import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileScript, parse } from 'vue/compiler-sfc'

// Vue templates see only a short list of globals; anything else (window, URL, confirm…) silently becomes undefined and the component fails
// to render. .vue files are not type-checked yet (vue-tsc cannot load TypeScript 7), so every component is compiled here and its render
// code is searched for browser globals read through the component context.
const BROWSER = ['window', 'document', 'URL', 'crypto', 'localStorage', 'sessionStorage', 'navigator', 'location', 'setTimeout', 'setInterval', 'alert', 'confirm', 'structuredClone', 'fetch', 'matchMedia', 'requestAnimationFrame', 'performance', 'Blob', 'FileReader', 'atob', 'btoa']
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.vue') ? [join(dir, entry.name)] : [])

describe('Vue templates', () => {
  const all = files(join(__dirname, '..'))
  it('finds the components', () => { expect(all.length).toBeGreaterThan(20) })
  for (const file of all) {
    it(`${file.split(/[\\/]src[\\/]vue[\\/]/)[1]} compiles and uses no browser global in its template`, () => {
      const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file })
      expect(errors).toEqual([])
      const code = compileScript(descriptor, { id: 'test', inlineTemplate: true }).content
      const used = BROWSER.filter(name => new RegExp(`_ctx\\.${name}\\b`).test(code))
      expect(used).toEqual([])
      // Every switch has an accessible name (UI flows 2026-11-09 found eleven without one).
      const unnamed = (descriptor.template?.content.match(/<[a-z]+[^>]*role="switch"[^>]*>/g) || []).filter(tag => !/aria-label/.test(tag))
      expect(unnamed).toEqual([])
    })
  }
})
