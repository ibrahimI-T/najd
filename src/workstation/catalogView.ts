import type { CapabilityKind, CatalogEntry, Lang } from './types'

// What a card shows and how the hub filters. Every returned entry stays reachable: filtering narrows, it never caps.
export const nameOf = (entry: CatalogEntry, lang: Lang) => (lang === 'ar' && entry.i18n?.ar?.displayName) || entry.displayName
export const descriptionOf = (entry: CatalogEntry, lang: Lang) => (lang === 'ar' && entry.i18n?.ar?.description) || entry.description || ''
export const canInstallPackage = (entry: CatalogEntry) => entry.packageInstalled !== true && entry.installable === true
export const canManagePackage = (entry: CatalogEntry) => entry.packageInstalled === true && entry.manageable === true
export type SortKey = 'relevance' | 'name' | 'downloads'

export function filterEntries(entries: CatalogEntry[], { kind, category, query, sort, lang }: { kind: CapabilityKind; category: string; query: string; sort: SortKey; lang: Lang }) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = entries.filter(entry => entry.kind === kind && (category === 'all' || entry.categories.includes(category)) &&
    words.every(word => [entry.id, entry.displayName, entry.description, entry.i18n?.ar?.displayName, entry.i18n?.ar?.description, entry.publisher.name].some(field => field?.toLowerCase().includes(word))))
  if (sort === 'name') return [...list].sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  if (sort === 'downloads') return [...list].sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
  return [...list].sort((a, b) => Number(!!b.prominent) - Number(!!a.prominent))
}

const NEEDS: Record<string, { ar: string; en: string }> = {
  office: { ar: 'حزمة المستندات غير مثبتة', en: 'The document pack is not installed' }, web: { ar: 'أداة الويب غير جاهزة', en: 'The web tool is not ready' },
  media: { ar: 'لا يوجد مزود وسائط مهيأ', en: 'No media provider is set up' }, gateway: { ar: 'البوابة لا تعمل', en: 'The gateway is not running' },
  'mobile-toolchain': { ar: 'أدوات بناء الجوال غير مثبتة', en: 'The mobile toolchain is not installed' }, '3d-runtime': { ar: 'بيئة ثلاثية الأبعاد غير مثبتة', en: 'The 3D runtime is not installed' },
  'github-account': { ar: 'حساب GitHub غير مربوط', en: 'No GitHub account is linked' }, macos: { ar: 'تعمل على macOS فقط', en: 'Works on macOS only' },
  'channel-setup': { ar: 'إعداد هذه القناة غير متوفر في نجد بعد', en: 'Setting up this channel is not available in NAJD yet' }, mcp: { ar: 'لا يوجد خادم MCP متصل', en: 'No MCP server is connected' }, 'desktop-pet': { ar: 'الرفيق المكتبي لم يُبنَ بعد', en: 'The desktop pet is not built yet' }
}
export function reasonText(reason: string | null, lang: Lang): string {
  if (!reason) return ''
  const ar = lang === 'ar'
  if (reason.startsWith('NEEDS:')) return reason.slice(6).split(',').map(key => NEEDS[key]?.[lang] || key).join(ar ? '، ' : ', ')
  if (reason === 'BROWSER_NOT_CONNECTED') return ar ? 'إضافة المتصفح غير متصلة' : 'The browser extension is not connected'
  if (reason === 'WINDOWS_NODE_NOT_INSTALLED') return ar ? 'مكوّن ويندوز غير مثبت' : 'The Windows component is not installed'
  if (reason.startsWith('OFFICE_PACK_')) return NEEDS.office[lang]
  return reason
}
export const stateLabel = (state: CatalogEntry['state'], lang: Lang) => ({
  AVAILABLE: ['جاهز', 'Ready'], NOT_INSTALLED: ['غير مثبت', 'Not installed'], INSTALLING: ['يُثبَّت', 'Installing'], NOT_READY: ['غير جاهز', 'Not ready'], DISABLED: ['معطل', 'Disabled'],
  UPDATE_AVAILABLE: ['يوجد تحديث', 'Update available'], QUARANTINED: ['معزول', 'Quarantined'], ERROR: ['خطأ', 'Error']
}[state][lang === 'ar' ? 0 : 1])
