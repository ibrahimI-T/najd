import { onBeforeUnmount, onMounted } from 'vue'

// Every .w-menu is placed against its button in fixed position and kept inside the window (live test 2026-11-09: the workbench "+" menu
// opened past the right edge in Arabic and the scrolling tab strip clipped it, so it never showed). Fixed position also escapes any
// container with overflow. The menu keeps its own markup and classes: .end aligns it with the button's far edge, .up opens it above.
const MARGIN = 8

function place(menu: HTMLElement) {
  const anchor = (menu.closest('.w-menu-box') || menu.parentElement) as HTMLElement | null
  if (!anchor) return
  const box = anchor.getBoundingClientRect()
  menu.style.position = 'fixed'
  menu.style.insetInlineStart = 'auto'; menu.style.insetInlineEnd = 'auto'; menu.style.right = 'auto'; menu.style.bottom = 'auto'
  const width = menu.offsetWidth, height = menu.offsetHeight
  const rtl = getComputedStyle(anchor).direction === 'rtl'
  // .end means the menu's far edge lines up with the button's far edge (in reading direction).
  const alignRight = menu.classList.contains('end') ? !rtl : rtl
  let left = alignRight ? box.right - width : box.left
  left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN)
  const below = box.bottom + 4, above = box.top - 4 - height
  const up = menu.classList.contains('up') ? above >= MARGIN || below + height > window.innerHeight : below + height > window.innerHeight - MARGIN && above >= MARGIN
  menu.style.left = Math.max(MARGIN, left) + 'px'
  menu.style.top = (up ? Math.max(MARGIN, above) : Math.min(below, window.innerHeight - height - MARGIN)) + 'px'
}

export function useMenuPlacement() {
  let observer: MutationObserver | null = null
  const placeAll = () => document.querySelectorAll<HTMLElement>('.w-menu').forEach(place)
  onMounted(() => {
    observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) { if (node.classList.contains('w-menu')) place(node); node.querySelectorAll?.<HTMLElement>('.w-menu').forEach(place) } })
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', placeAll)
    // A scroll inside any container moves the button: the open menu follows it.
    window.addEventListener('scroll', placeAll, true)
  })
  onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('resize', placeAll); window.removeEventListener('scroll', placeAll, true) })
}
