import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidePanel } from './SidePanel'
import { getCopy } from './copy'

// The panel reads window.najdAgent; this render has no preload bridge.
(globalThis as { window?: unknown }).window ??= {}

// M2-R30-003: a new chat (no conversation yet) still shows the selected model's context window.
it('shows the selected model context window before the first send', () => {
  const t = getCopy('en')
  const html = renderToStaticMarkup(<SidePanel t={t} language="en" conversationId={null} provider="kimi-code" model="k3-256k" modelWindow={256000}
    busy={false} browserConnected={false} pinned={null} onPin={() => {}} onClose={() => {}} />)
  expect(html).toContain(t.panel.context)
  expect(html).toContain('0 / 256k')
  expect(html).toContain('256,000')
  expect(html).toContain(t.panel.empty)
  expect(html).not.toContain(t.panel.usage)
  const unknown = renderToStaticMarkup(<SidePanel t={t} language="en" conversationId={null} provider="ollama" model="" modelWindow={null}
    busy={false} browserConnected={false} pinned={null} onPin={() => {}} onClose={() => {}} />)
  expect(unknown).toContain(t.panel.windowUnknown)
})

it('a folded card keeps its summary in the heading', () => {
  const t = getCopy('en')
  const store = globalThis as { localStorage?: unknown }
  const previous = store.localStorage
  store.localStorage = { getItem: () => 'closed', setItem: () => {} }
  try {
    const html = renderToStaticMarkup(<SidePanel t={t} language="en" conversationId={null} provider="kimi-code" model="k3-256k" modelWindow={256000}
      busy={false} browserConnected={false} pinned={null} onPin={() => {}} onClose={() => {}} />)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('side-card-summary')
    expect(html).toContain('0%')
    expect(html).not.toContain('0 / 256k')
  } finally { store.localStorage = previous }
})
