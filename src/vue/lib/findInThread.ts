// Find in the open conversation (Ctrl+F, owner request 2026-11-10: keep developing NAJD). Text ranges are found in the thread's DOM and
// marked with the CSS Custom Highlight API, so the page is never rewritten. Case and Arabic diacritics are ignored.
const DIACRITICS = /[ً-ْٰـ]/g
const DIACRITIC = /[ً-ْٰـ]/
export const fold = (text: string) => text.replace(DIACRITICS, '').toLowerCase()

// Start/end offsets of every match of `query` in `text` (diacritics ignored on both sides; offsets refer to the original text).
export function matchOffsets(text: string, query: string): [number, number][] {
  const needle = fold(query.trim())
  if (!needle) return []
  const map: number[] = []
  let folded = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (DIACRITIC.test(char)) continue
    folded += char.toLowerCase(); map.push(index)
  }
  const found: [number, number][] = []
  let at = folded.indexOf(needle)
  while (at !== -1 && found.length < 2000) {
    found.push([map[at], map[at + needle.length - 1] + 1])
    at = folded.indexOf(needle, at + needle.length)
  }
  return found
}

export function findRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => (node.parentElement?.closest('.c-body, .c-msg bdi') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) })
  for (let node = walker.nextNode(); node && ranges.length < 2000; node = walker.nextNode()) {
    for (const [start, end] of matchOffsets(node.textContent || '', query)) {
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end); ranges.push(range)
    }
  }
  return ranges
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void }
const registry = () => (globalThis.CSS as unknown as { highlights?: HighlightRegistry })?.highlights
const HighlightClass = () => (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
export function paint(ranges: Range[], current: number) {
  const highlights = registry(), Make = HighlightClass()
  if (!highlights || !Make) return
  highlights.set('najd-find', new Make(...ranges.filter((_, index) => index !== current)))
  if (ranges[current]) highlights.set('najd-find-current', new Make(ranges[current])); else highlights.delete('najd-find-current')
}
export function clearPaint() { const highlights = registry(); highlights?.delete('najd-find'); highlights?.delete('najd-find-current') }
