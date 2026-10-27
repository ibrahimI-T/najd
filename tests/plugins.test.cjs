const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')
const { createPlugins, githubTree, readPlugin } = require('../electron/plugins.cjs')
const { parseSource } = require('../electron/external-skills.cjs')

const archive = (root, extra = {}) => Buffer.from(zipSync({
  [root + '/README.md']: strToU8('repo'),
  [root + '/plugins/setup/.claude-plugin/plugin.json']: strToU8(JSON.stringify({ name: 'setup-helper', description: 'Recommends automations', version: '1.2.0', author: { name: 'Acme' } })),
  [root + '/plugins/setup/skills/recommender/SKILL.md']: strToU8('---\nname: recommender\ndescription: Recommend things\n---\nBody'),
  [root + '/plugins/setup/commands/review-all.md']: strToU8('---\ndescription: Review everything\nargument-hint: [path]\n---\nReview $ARGUMENTS carefully.'),
  [root + '/plugins/setup/.mcp.json']: strToU8(JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', 'docs-mcp'], env: { API_KEY: '' } }, web: { url: 'https://mcp.example.com/mcp' }, bad: { command: 7 } } })),
  [root + '/plugins/setup/hooks/hooks.json']: strToU8('{}'),
  [root + '/plugins/other/.claude-plugin/plugin.json']: strToU8(JSON.stringify({ name: 'other' })),
  [root + '/plugins/other/commands/x.md']: strToU8('Other command'),
  ...extra
}))

function fixture(t, bytes = archive('repo-main')) {
  const calls = { installed: [], removed: [], enabled: [] }
  const skills = {
    fetchArchive: async url => ({ bytes, source: parseSource(url) }),
    install: async url => { calls.installed.push(url); return [{ id: 'ext-recommender', name: 'recommender' }] },
    setEnabled: async id => { calls.enabled.push(id) }, remove: async id => { calls.removed.push(id) }
  }
  return fs.mkdtemp(path.join(os.tmpdir(), 'najd-plugins-')).then(directory => { t.after(() => fs.rm(directory, { recursive: true, force: true })); return { calls, directory, plugins: createPlugins({ directory, skills }) } })
}

test('a GitHub plugin folder is read: manifest, skills, commands, servers, unsupported parts', async t => {
  const { plugins } = await fixture(t)
  const plan = await plugins.preview('https://github.com/acme/market/tree/main/plugins/setup')
  assert.equal(plan.id, 'setup-helper'); assert.equal(plan.version, '1.2.0'); assert.equal(plan.author, 'Acme'); assert.equal(plan.skillCount, 1)
  assert.deepEqual(plan.commands.map(c => [c.command, c.description, c.hint]), [['review-all', 'Review everything', '[path]']])
  assert.deepEqual(plan.servers.map(s => [s.name, s.kind]), [['docs', 'stdio'], ['web', 'remote']]); assert.deepEqual(plan.servers[0].envNames, ['API_KEY'])
  assert.deepEqual(plan.unsupported, ['hooks'])
  const other = await plugins.preview('https://github.com/acme/market/tree/main/plugins/other')
  assert.equal(other.id, 'other'); assert.equal(other.skillCount, 0)
})

test('installing registers skills, commands and proposals; nothing starts; removal undoes the skills', async t => {
  const { plugins, calls } = await fixture(t)
  const result = await plugins.install('https://github.com/acme/market/tree/main/plugins/setup')
  assert.equal(result.installed, true); assert.deepEqual(calls.installed, ['https://github.com/acme/market/tree/main/plugins/setup']); assert.deepEqual(calls.enabled, ['ext-recommender'])
  const listed = await plugins.list()
  assert.equal(listed[0].skills, 1); assert.equal(listed[0].commands, 1); assert.equal(listed[0].servers.length, 2)
  const commands = await plugins.commands()
  assert.deepEqual(commands.map(c => c.command), ['setup-helper-review-all']); assert.match(commands[0].body, /Review \$ARGUMENTS/)
  await plugins.remove('setup-helper')
  assert.deepEqual(calls.removed, ['ext-recommender']); assert.deepEqual(await plugins.list(), []); assert.deepEqual(await plugins.commands(), [])
  await assert.rejects(plugins.remove('setup-helper'), { code: 'NOT_FOUND' }); await assert.rejects(plugins.remove('../x'), { code: 'INVALID_INPUT' })
})

test('an empty or malformed folder is refused with a stable code', async t => {
  const { plugins } = await fixture(t, Buffer.from(zipSync({ 'repo-main/readme.md': strToU8('nothing') })))
  await assert.rejects(plugins.preview('https://github.com/acme/market'), { code: 'PLUGIN_EMPTY' })
  const bad = await fixture(t, Buffer.from(zipSync({ 'repo-main/.claude-plugin/plugin.json': strToU8('{broken') })))
  await assert.rejects(bad.plugins.preview('https://github.com/acme/market'), { code: 'PLUGIN_INVALID' })
  assert.throws(() => readPlugin(new Map(), ''), { code: 'PLUGIN_INVALID' })
})

test('marketplace sources become pinned GitHub addresses; other sources are not installable', () => {
  const market = { repo: 'anthropics/claude-plugins-official', ref: 'main' }
  assert.equal(githubTree('./plugins/claude-code-setup', market), 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup')
  const sha = 'faf5305385de8afed9468904e8639be737aff39e'
  assert.equal(githubTree({ source: 'git-subdir', url: 'https://github.com/42Crunch-AI/claude-plugins.git', path: 'plugins/api-security-testing', ref: 'v1.5.5', sha }, market), `https://github.com/42Crunch-AI/claude-plugins/tree/${sha}/plugins/api-security-testing`)
  assert.equal(githubTree({ source: 'url', url: 'https://github.com/o/r.git', sha }, market), `https://github.com/o/r/tree/${sha}`)
  assert.equal(githubTree({ source: 'github', repo: 'o/r', ref: 'dev' }, market), 'https://github.com/o/r/tree/dev')
  assert.throws(() => githubTree({ source: 'github', repo: 'o/r', ref: 'release/stable', path: 'plugins/x' }, market), { code: 'UNSUPPORTED_SOURCE' }, 'a ref with a slash is ambiguous in a tree address')
  for (const bad of ['../x', 'plugins/x', { source: 'url', url: 'https://gitlab.com/o/r.git' }, { source: 'git-subdir', url: 'https://github.com/o/r.git', path: '../etc' }, { source: 'npm', package: 'x' }, null, 5])
    assert.throws(() => githubTree(bad, market), { code: 'UNSUPPORTED_SOURCE' }, JSON.stringify(bad))
  assert.equal(parseSource(`https://github.com/o/r/tree/${sha}/plugins/x`).download, `https://codeload.github.com/o/r/zip/${sha}`, 'a commit id downloads that exact revision')
})

test('marketplace search lists entries with their sources and caches the catalog', async t => {
  let fetched = 0
  const catalog = { plugins: [{ name: 'claude-code-setup', description: 'Recommend automations', category: 'development', source: './plugins/claude-code-setup', author: { name: 'Anthropic' } }, { name: 'figma', description: 'Design', category: 'design', source: { source: 'url', url: 'https://gitlab.com/x/y.git' } }] }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-plugins-market-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const plugins = createPlugins({ directory, skills: {}, fetchImpl: async url => { if (String(url).startsWith('https://api.github.com/repos/acme/my-plugins')) return new Response(JSON.stringify({ default_branch: 'master' })); fetched++; assert.match(String(url), /^https:\/\/raw\.githubusercontent\.com\/anthropics\/claude-plugins-official\/main\/\.claude-plugin\/marketplace\.json$/); return new Response(JSON.stringify(catalog)) } })
  const hits = await plugins.search('automations')
  assert.equal(hits.length, 1); assert.equal(hits[0].sourceUrl, 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup')
  const all = await plugins.search('')
  assert.equal(all.length, 2); assert.equal(all[1].sourceUrl, null, 'a non-GitHub source is listed but cannot be installed')
  assert.equal(fetched, 1, 'the catalog is cached')
  assert.equal(await plugins.addMarketplace('https://github.com/acme/my-plugins'), 'acme-my-plugins')
  assert.equal((await plugins.markets()).length, 2); await assert.rejects(plugins.addMarketplace('not a repo'), { code: 'INVALID_INPUT' })
  assert.equal((await plugins.markets()).find(item => item.id === 'acme-my-plugins').ref, 'master', 'the real default branch is stored, never a guessed main')
  assert.throws(() => githubTree('./plugins/x', { repo: 'a/b', ref: 'HEAD' }), { code: 'UNSUPPORTED_SOURCE' })
  await plugins.removeMarketplace('acme-my-plugins'); assert.equal((await plugins.markets()).length, 1)
})

test('one archive feeds every component, and an archive that changed since the preview is refused', async t => {
  const { plugins, calls, directory } = await fixture(t)
  const plan = await plugins.preview('https://github.com/acme/market/tree/main/plugins/setup')
  assert.match(plan.digest, /^[0-9a-f]{64}$/); assert.equal('archive' in plan, false, 'the archive itself is not part of the plan')
  const seen = []
  const skills = { fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }), install: async (url, signal, prefetched) => { seen.push(prefetched); return [{ id: 'ext-recommender', name: 'r' }] }, setEnabled: async () => {}, remove: async () => {} }
  const checked = createPlugins({ directory, skills })
  await checked.install('https://github.com/acme/market/tree/main/plugins/setup', undefined, { expectedDigest: plan.digest })
  assert.ok(seen[0] && Buffer.isBuffer(seen[0].bytes), 'the skills are installed from the archive that was inspected')
  await assert.rejects(checked.install('https://github.com/acme/market/tree/main/plugins/setup', undefined, { expectedDigest: '0'.repeat(64) }), { code: 'PLUGIN_CHANGED' })
  assert.equal(calls.installed.length, 0)
})

test('a skill id owned by another plugin is never overwritten, and a reinstall drops skills the new version lacks', async t => {
  const { plugins, calls, directory } = await fixture(t)
  const url = 'https://github.com/acme/market/tree/main/plugins/setup'
  await plugins.install(url)
  const twin = Buffer.from(zipSync({
    'repo-main/plugins/twin/.claude-plugin/plugin.json': strToU8(JSON.stringify({ name: 'twin' })),
    'repo-main/plugins/twin/skills/recommender/SKILL.md': strToU8('---\nname: recommender\ndescription: Same name\n---\nOther body')
  }))
  const second = createPlugins({ directory, skills: { fetchArchive: async u => ({ bytes: twin, source: parseSource(u) }), install: async () => { calls.installed.push('twin'); return [{ id: 'ext-recommender', name: 'recommender' }] }, setEnabled: async () => {}, remove: async id => { calls.removed.push(id) } } })
  await assert.rejects(second.install('https://github.com/acme/market/tree/main/plugins/twin'), { code: 'PLUGIN_CONFLICT' })
  assert.deepEqual(calls.installed, ['https://github.com/acme/market/tree/main/plugins/setup'], 'nothing of the second plugin was written')
})

test('a skill whose name sits far into its frontmatter is still checked for ownership, and concurrent installs cannot both take one id', async t => {
  const { plugins, directory, calls } = await fixture(t)
  await plugins.install('https://github.com/acme/market/tree/main/plugins/setup')
  const far = Buffer.from(zipSync({
    'repo-main/plugins/far/.claude-plugin/plugin.json': strToU8(JSON.stringify({ name: 'far' })),
    'repo-main/plugins/far/skills/r/SKILL.md': strToU8('---\ndescription: ' + 'x'.repeat(6000) + '\nname: recommender\n---\nBody')
  }))
  const second = createPlugins({ directory, skills: { fetchArchive: async u => ({ bytes: far, source: parseSource(u) }), install: async () => { calls.installed.push('far'); return [{ id: 'ext-recommender', name: 'recommender' }] }, setEnabled: async () => {}, remove: async () => {} } })
  await assert.rejects(second.install('https://github.com/acme/market/tree/main/plugins/far'), { code: 'PLUGIN_CONFLICT' })
  assert.ok(!calls.installed.includes('far'))
})

test('a failed install leaves no new skill behind and no plugin entry', async t => {
  const { directory, calls } = await fixture(t)
  const failing = createPlugins({ directory, skills: { fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }), install: async () => [{ id: 'ext-recommender', name: 'r' }], setEnabled: async () => { throw Object.assign(new Error('x'), { code: 'FAILED' }) }, remove: async id => { calls.removed.push(id) } } })
  await assert.rejects(failing.install('https://github.com/acme/market/tree/main/plugins/setup'))
  assert.deepEqual(calls.removed, ['ext-recommender']); assert.deepEqual(await failing.list(), [])
})

test('a standalone skill with the same id blocks the plugin, and the ids are reserved while the install runs', async t => {
  const { directory } = await fixture(t)
  const written = []
  const standalone = createPlugins({ directory, skills: { has: async id => id === 'ext-recommender', fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }), install: async () => { written.push('x'); return [] }, setEnabled: async () => {}, remove: async () => {} } })
  await assert.rejects(standalone.install('https://github.com/acme/market/tree/main/plugins/setup'), { code: 'PLUGIN_CONFLICT' })
  assert.deepEqual(written, [])
  let during
  const holder = {}
  const reserving = createPlugins({ directory, skills: { fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }), install: async () => { during = await holder.plugins.ownedSkills(); return [{ id: 'ext-recommender', name: 'r' }] }, setEnabled: async () => {}, remove: async () => {} } })
  holder.plugins = reserving
  await reserving.install('https://github.com/acme/market/tree/main/plugins/setup')
  assert.equal(during.get('ext-recommender'), 'setup-helper')
})

test('a plugin never replaces a skill that exists outside it, even when it appeared after the first check', async t => {
  const { directory } = await fixture(t)
  const skillsFake = { has: async () => false, fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }), install: async (url, signal, archiveInput, options) => { assert.deepEqual(options.mayReplace, []); assert.equal(options.owner, 'setup-helper'); throw Object.assign(new Error('x'), { code: 'SKILL_EXISTS' }) }, setEnabled: async () => {}, remove: async () => {} }
  await assert.rejects(createPlugins({ directory, skills: skillsFake }).install('https://github.com/acme/market/tree/main/plugins/setup'), { code: 'PLUGIN_CONFLICT' })
})

test('a skill that cannot be removed stays owned by its plugin, and the failure is reported, for both an update and an uninstall', async t => {
  const { directory } = await fixture(t)
  let failRemove = false
  const removed = []
  const skills = { fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }), install: async () => [{ id: 'ext-recommender', name: 'r' }], setEnabled: async () => {},
    remove: async id => { if (failRemove) throw Object.assign(new Error('x'), { code: 'SKILLS_UNAVAILABLE' }); removed.push(id) } }
  const plugins = createPlugins({ directory, skills })
  await plugins.install('https://github.com/acme/market/tree/main/plugins/setup')
  failRemove = true
  await assert.rejects(plugins.remove('setup-helper'), { code: 'PLUGIN_CLEANUP_PENDING' })
  assert.equal((await plugins.list())[0].skills, 1, 'the plugin record still owns the skill')
  failRemove = false
  assert.equal(await plugins.remove('setup-helper'), true); assert.deepEqual(removed, ['ext-recommender']); assert.deepEqual(await plugins.list(), [])
  // An update that drops a skill the new version no longer has.
  const older = { ...skills, install: async () => [{ id: 'ext-old', name: 'old' }, { id: 'ext-recommender', name: 'r' }] }
  await createPlugins({ directory, skills: older }).install('https://github.com/acme/market/tree/main/plugins/setup')
  failRemove = true
  await assert.rejects(createPlugins({ directory, skills }).install('https://github.com/acme/market/tree/main/plugins/setup'), { code: 'PLUGIN_CLEANUP_PENDING' })
  assert.equal((await createPlugins({ directory, skills }).list())[0].skills, 2, 'the obsolete skill is still tracked until it is really gone')
})

test('an update records the skills it drops as owned until they are confirmed gone, so a restart never leaves one without an owner', async t => {
  const { directory } = await fixture(t)
  const registryFile = path.join(directory, 'plugins.json')
  const seenAtRemoval = []
  const skills = { fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }), install: async () => [{ id: 'ext-recommender', name: 'r' }], setEnabled: async () => {},
    remove: async id => { seenAtRemoval.push(JSON.parse(await fs.readFile(registryFile, 'utf8')).plugins['setup-helper'].skills) } }
  const older = { ...skills, install: async () => [{ id: 'ext-old', name: 'old' }, { id: 'ext-recommender', name: 'r' }] }
  await createPlugins({ directory, skills: older }).install('https://github.com/acme/market/tree/main/plugins/setup')
  await createPlugins({ directory, skills }).install('https://github.com/acme/market/tree/main/plugins/setup')
  assert.deepEqual(seenAtRemoval, [['ext-recommender', 'ext-old']], 'when the obsolete skill is being removed the registry on disk still owns it')
  assert.deepEqual(JSON.parse(await fs.readFile(registryFile, 'utf8')).plugins['setup-helper'].skills, ['ext-recommender'], 'and releases it afterwards')
})

test('ownership is on disk before any skill is written, and a skill that cannot be rolled back keeps its owner', async t => {
  const { directory } = await fixture(t)
  const registryFile = path.join(directory, 'plugins.json')
  let atInstall = null, failRemove = false
  const skills = { fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }),
    install: async () => { atInstall = JSON.parse(await fs.readFile(registryFile, 'utf8')).plugins['setup-helper']; return [{ id: 'ext-recommender', name: 'r' }] },
    setEnabled: async () => { throw Object.assign(new Error('x'), { code: 'FAILED' }) }, remove: async () => { if (failRemove) throw Object.assign(new Error('x'), { code: 'SKILLS_UNAVAILABLE' }) } }
  const plugins = createPlugins({ directory, skills })
  await assert.rejects(plugins.install('https://github.com/acme/market/tree/main/plugins/setup'))
  assert.deepEqual(atInstall.skills, ['ext-recommender']); assert.equal(atInstall.pending, true, 'the incoming skill was already owned (pending) when it was written')
  assert.deepEqual(await plugins.list(), [], 'a clean rollback leaves no record')
  failRemove = true
  await assert.rejects(plugins.install('https://github.com/acme/market/tree/main/plugins/setup'), { code: 'PLUGIN_CLEANUP_PENDING' })
  assert.deepEqual(JSON.parse(await fs.readFile(registryFile, 'utf8')).plugins['setup-helper'].skills, ['ext-recommender'], 'the skill that could not be removed is still owned')
})

test('when a standalone skill appears during the install, the install fails and that skill is never removed by the rollback', async t => {
  const { directory } = await fixture(t)
  const removed = []
  const skills = { fetchArchive: async url => ({ bytes: archive('repo-main'), source: parseSource(url) }),
    install: async () => { throw Object.assign(new Error('x'), { code: 'SKILL_EXISTS' }) }, setEnabled: async () => {}, remove: async id => { removed.push(id) } }
  await assert.rejects(createPlugins({ directory, skills }).install('https://github.com/acme/market/tree/main/plugins/setup'), { code: 'PLUGIN_CONFLICT' })
  assert.deepEqual(removed, [], 'nothing was created by this install, so nothing is removed')
  assert.deepEqual(await createPlugins({ directory, skills }).list(), [], 'and no record is left behind')
})
