import { describe, expect, it } from 'vitest'
import { PLUGIN_CATEGORIES, SKILL_CATEGORIES, type CatalogEntry } from './types'
import { defaults, loadPrefs, PREF_KEY } from './prefs'
import { closeTab, emptyWorkbench, openTab } from './workbenchState'
import { canInstallPackage, canManagePackage, filterEntries, nameOf, reasonText } from './catalogView'

const store = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null })
const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, version: '1.0.0', latestVersion: null, kind: 'skill', layer: 'marketplace', displayName: id, publisher: { name: 'P' }, categories: ['featured'], permissions: [], state: 'NOT_INSTALLED', reason: null, installable: false, ...extra })

describe('preferences', () => {
  it('starts with the defaults and survives corrupt or blocked storage', () => {
    expect(loadPrefs(store({}))).toEqual(defaults)
    expect(loadPrefs(store({ [PREF_KEY]: '{bad' }))).toEqual(defaults)
    expect(loadPrefs({ getItem: () => { throw new Error('blocked') } })).toEqual(defaults)
  })
  it('migrates language and theme once from the earlier key, and earlier decorative themes become dark', () => {
    expect(loadPrefs(store({ 'najd.preferences.v1': JSON.stringify({ language: 'en', theme: 'graphite' }) }))).toMatchObject({ language: 'en', theme: 'dark' })
    expect(loadPrefs(store({ 'najd.preferences.v1': JSON.stringify({ language: 'ar', theme: 'light' }) }))).toMatchObject({ theme: 'light' })
  })
  it('bounds stored sizes', () => {
    expect(loadPrefs(store({ [PREF_KEY]: JSON.stringify({ railWidth: 9000, workbenchWidth: 1, zoom: 7, fontSize: 90 }) }))).toMatchObject({ railWidth: 400, workbenchWidth: 320, zoom: 1, fontSize: 14 })
  })
})

describe('workbench tabs', () => {
  const a = { id: 'a', kind: 'apps', title: 'A' } as const, b = { id: 'b', kind: 'details', title: 'B' } as const
  it('opens, focuses without duplicates and moves focus when the active tab closes', () => {
    let state = openTab(openTab(emptyWorkbench, a), b)
    expect(state).toMatchObject({ open: true, active: 'b' })
    state = openTab(state, a)
    expect(state.tabs).toHaveLength(2); expect(state.active).toBe('a')
    state = closeTab(state, 'a')
    expect(state.active).toBe('b')
    expect(closeTab(state, 'b')).toMatchObject({ open: true, active: null, tabs: [] }) // the panel stays and shows Start here
  })
})

describe('catalog view', () => {
  const entries = [entry('alpha', { displayName: 'Alpha', i18n: { ar: { displayName: 'ألفا' } } }), entry('beta', { kind: 'plugin', categories: ['finance'] }), ...Array.from({ length: 500 }, (_, index) => entry('item-' + index))]
  it('never caps the list and separates skills from plugins', () => {
    expect(filterEntries(entries, { kind: 'skill', category: 'featured', query: '', sort: 'relevance', lang: 'en' })).toHaveLength(501)
    expect(filterEntries(entries, { kind: 'plugin', category: 'all', query: '', sort: 'name', lang: 'en' }).map(item => item.id)).toEqual(['beta'])
  })
  it('searches both languages and localizes names', () => {
    expect(filterEntries(entries, { kind: 'skill', category: 'all', query: 'ألفا', sort: 'name', lang: 'ar' })).toHaveLength(1)
    expect(nameOf(entries[0], 'ar')).toBe('ألفا')
    expect(reasonText('NEEDS:office', 'en')).toContain('document pack')
  })
  it('lists the specified hub categories', () => { expect(PLUGIN_CATEGORIES).toHaveLength(10); expect(SKILL_CATEGORIES).toHaveLength(8) })
  it('offers install for an uninstalled local package and management for every installed package layer', () => {
    expect(canInstallPackage(entry('local', { installable: true, localImportable: true, packageInstalled: false }))).toBe(true)
    expect(canManagePackage(entry('managed', { layer: 'managed', packageInstalled: true, manageable: true, state: 'AVAILABLE' }))).toBe(true)
    expect(canManagePackage(entry('description', { layer: 'managed', packageInstalled: false, manageable: false }))).toBe(false)
  })
})
