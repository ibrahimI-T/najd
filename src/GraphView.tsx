import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Network, Pause, Play, RefreshCw, RotateCcw, RotateCw, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import { CardHeading } from './ui'
import { visibleInterval } from './useVisibleInterval'
import { facing, layoutGraph, projectPoint, radiusOf, type Camera, type GraphPos, type Projected } from './graphLayout'

type Language = 'ar' | 'en'
type Tab = 'memory' | 'tools' | 'retrieval' | 'usage'
const W = 900, H = 520
const START: Camera = { yaw: 0.6, pitch: -0.28, zoom: 1.35 }
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

const words = {
  en: {
    title: 'Memory map', hint: 'What NAJD remembers, drawn as stars you can turn like a globe: drag to rotate, scroll or pinch to zoom, click a star to read or change it. A new star appears and links to the ones it shares something with as soon as it is learned.',
    memory: 'Memory', tools: 'Tools', usage: 'Context use', refresh: 'Refresh', empty: 'Nothing is remembered yet. As NAJD learns from you, stars and lines appear here.',
    stats: (n: number, s: number, l: number) => `${n} memories · ${s} shared stars · ${l} links`, toolStats: (t: number, k: number) => `${t} tool groups · ${k} tools`,
    soul: 'Soul', section: 'Section of the soul', preference: 'Preference', experience: 'Lesson', note: 'Note', star: 'Shared star', toolset: 'Tool group',
    title2: 'Title', text: 'Text', save: 'Save', remove: 'Delete', close: 'Close', confirm: 'Delete this memory?', saved: 'Saved', error: 'Could not save',
    linked: 'Memories linked to this star', start: 'Part of the lean start', loadable: 'NAJD can load it when needed', tools2: 'Tools', profiles: 'Used by profiles',
    soulHint: 'The soul is NAJD\'s character and working rules. Its sections are the stars around it; edit the full text in the Personality box below. Preferences you teach hang from it.',
    sectionHint: 'This part of the soul is edited in the Personality box below.', legend: 'Gold: preferences · Blue: lessons · Cream: notes · Small: shared words and names',
    toolsHint: 'Tool groups NAJD can use. Lines point to the group that usually comes next; with a small model NAJD starts with the highlighted groups and adds the next ones as they are needed.',
    usageHint: 'What each request carried before the answer, in estimated tokens. Sizes only; no text is kept.', none: 'No requests recorded yet.',
    instructions: 'Instructions', toolDefs: 'Tool definitions', history: 'Conversation', task: 'Task so far', condensed: 'Older results shortened', window: 'Window',
    unavailable: 'Not connected or not ready right now, so it cannot be used until it is.',
    newest: (shown: number, total: number) => `Showing the newest ${shown} of ${total} memories.`,
    retrieval: 'Retrieval', retrievalHint: 'What NAJD pulled from memory for each request, why, and how big it was. The question itself is not kept: only sizes, reasons and titles.',
    memStats: (s: Record<string, number>) => `${s.notes ?? 0} memories (${s.enabled ?? 0} available to the model) · ${s.stars ?? 0} shared names and files · ${s.related ?? 0} links${s.conflicts ? ` · ${s.conflicts} possible conflicts` : ''} · ${s.chats ?? 0} indexed conversations`,
    instructionNote: 'The soul and its sections (hollow stars) are instructions: they are always sent, whatever the request, and are not memories.', degraded: 'The memory graph could not be opened, so this picture is built from the notes themselves.',
    engine: 'Memory engine', graphEngine: 'Graph (stored on disk, updated one memory at a time)', legacyEngine: 'Previous engine (built in memory)', shareNotes: 'Send my notes from Settings when a request needs them', shareChats: 'Use earlier conversations when a request needs them', rebuild: 'Rebuild the index', rebuilt: 'Rebuilt',
    dbInfo: (s: Record<string, number>) => `${s.memories} memories · ${s.entities} named entities · ${s.links} links · ${s.chats} conversations (${s.chunks} pieces)`, backupKept: 'Migrated without loss; a copy of the previous files is at', noTraces: 'No request has used memory yet.', budgetWord: 'budget', itemsWord: 'items', tokensWord: 'tokens', chatsHeading: (all: number) => `Earlier conversations memory may use (${all} indexed)`, untitledChat: '(untitled conversation)', chatSearch: 'Search conversations', previous: 'Previous', next: 'Next', chatLimit: 'The list of kept-out conversations is full; allow one again first.', chatFailed: 'The choice could not be saved.', cachedWord: 'cached', estimate: 'Token counts are estimates by script (Arabic and Latin differ); the provider\'s exact figure for each run is in its receipt.',
    sourceLearning: 'Learned by NAJD and approved by you', sourceNotes: 'Written by you in Settings', scopeWord: 'Scope', scopeGlobal: 'all conversations', scopeConversation: 'one conversation only', scopeProject: 'one project', availableWord: 'Available to the model when a request needs it', secretNote: 'Looks like a secret: kept here but never sent to the model.',
    conflictsWord: (n: number) => `${n} possibly conflicting memory(ies): both are sent and the older one is marked`,
    reasons: { match: 'matches the request', name: 'names a file or person in the request', linked: 'linked to a matching memory', pinned: 'newest preference (always shared)', chat: 'an earlier conversation matches the request', newer: 'newer than a conflicting memory' }, createdWord: 'Created', updatedWord: 'Updated', originWord: 'Origin', namesWord: 'Names and files in it',
    left: 'Turn left', right: 'Turn right', zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset the view', autoOn: 'Turn slowly', autoOff: 'Stop turning'
  },
  ar: {
    title: 'خريطة الذاكرة', hint: 'ما يتذكره نجد مرسوماً على شكل نجوم تديرها كالكرة الأرضية: اسحب للتدوير، وبالعجلة أو القرص قرّب وبعّد، واضغط على نجمة لقراءتها أو تعديلها. تظهر النجمة الجديدة وتتصل بما يشاركها فور أن يتعلمها.',
    memory: 'الذاكرة', tools: 'الأدوات', usage: 'استهلاك السياق', refresh: 'تحديث', empty: 'لا شيء محفوظ بعد. كلما تعلّم نجد منك ظهرت هنا نجوم وخطوط.',
    stats: (n: number, s: number, l: number) => `${n} ذكريات · ${s} نجوم مشتركة · ${l} روابط`, toolStats: (t: number, k: number) => `${t} مجموعات أدوات · ${k} أداة`,
    soul: 'الروح', section: 'قسم من الروح', preference: 'تفضيل', experience: 'درس', note: 'ملاحظة', star: 'نجمة مشتركة', toolset: 'مجموعة أدوات',
    title2: 'العنوان', text: 'النص', save: 'حفظ', remove: 'حذف', close: 'إغلاق', confirm: 'حذف هذه الذكرى؟', saved: 'تم الحفظ', error: 'تعذّر الحفظ',
    linked: 'الذكريات المرتبطة بهذه النجمة', start: 'ضمن البداية الخفيفة', loadable: 'يحمّلها نجد عند الحاجة', tools2: 'الأدوات', profiles: 'تستخدمها الأنماط',
    soulHint: 'الروح هي شخصية نجد وقواعد عمله. أقسامها هي النجوم حولها؛ عدّل النص الكامل في خانة الشخصية أدناه. والتفضيلات التي تعلّمها له تتعلق بها.',
    sectionHint: 'يُعدَّل هذا القسم من الروح في خانة الشخصية أدناه.', legend: 'ذهبي: تفضيلات · أزرق: دروس · كريمي: ملاحظات · صغيرة: كلمات وأسماء مشتركة',
    toolsHint: 'مجموعات الأدوات التي يستخدمها نجد. الخط يشير إلى المجموعة التي تأتي عادة بعدها؛ ومع النموذج الصغير يبدأ نجد بالمجموعات المضيئة ويضيف التالية عند الحاجة.',
    usageHint: 'ما حمله كل طلب قبل الجواب، بالرموز التقديرية. أحجام فقط، ولا يُحفظ أي نص.', none: 'لم يُسجَّل أي طلب بعد.',
    instructions: 'التعليمات', toolDefs: 'تعريفات الأدوات', history: 'المحادثة', task: 'المهمة حتى الآن', condensed: 'نتائج قديمة مختصرة', window: 'النافذة',
    unavailable: 'غير متصلة أو غير جاهزة الآن، فلا يمكن استخدامها حتى تجهز.',
    newest: (shown: number, total: number) => `يُعرض أحدث ${shown} من ${total} ذكرى.`,
    retrieval: 'الاسترجاع', retrievalHint: 'ما سحبه نجد من الذاكرة لكل طلب، وسبب اختياره، وحجمه. السؤال نفسه لا يُحفظ: فقط الأحجام والأسباب والعناوين.',
    memStats: (s: Record<string, number>) => `${s.notes ?? 0} ذكرى (${s.enabled ?? 0} متاحة للنموذج) · ${s.stars ?? 0} أسماء وملفات مشتركة · ${s.related ?? 0} روابط${s.conflicts ? ` · ${s.conflicts} تعارضات محتملة` : ''} · ${s.chats ?? 0} محادثات مفهرسة`,
    instructionNote: 'الروح وأقسامها (النجوم المجوّفة) تعليمات: تُرسَل دائماً مهما كان الطلب، وليست ذكريات.', degraded: 'تعذّر فتح رسم الذاكرة، فهذه الصورة مبنية من الملاحظات نفسها.',
    engine: 'محرك الذاكرة', graphEngine: 'الرسم (محفوظ على القرص ويتحدث ذكرى بذكرى)', legacyEngine: 'المحرك السابق (يُبنى في الذاكرة)', shareNotes: 'أرسل ملاحظاتي من الإعدادات عندما يحتاجها الطلب', shareChats: 'استخدم المحادثات السابقة عندما يحتاجها الطلب', rebuild: 'إعادة بناء الفهرس', rebuilt: 'أُعيد البناء',
    dbInfo: (s: Record<string, number>) => `${s.memories} ذكرى · ${s.entities} اسماً مسمّى · ${s.links} روابط · ${s.chats} محادثات (${s.chunks} قطعة)`, backupKept: 'تم الترحيل بلا فقد؛ وفي هذا المسار نسخة من الملفات السابقة', noTraces: 'لم يستخدم أي طلب الذاكرة بعد.', budgetWord: 'الميزانية', itemsWord: 'عناصر', tokensWord: 'رمزاً', chatsHeading: (all: number) => `المحادثات السابقة التي يجوز للذاكرة استخدامها (${all} مفهرسة)`, untitledChat: '(محادثة بلا عنوان)', chatSearch: 'ابحث في المحادثات', previous: 'السابق', next: 'التالي', chatLimit: 'قائمة المحادثات المستبعدة ممتلئة؛ اسمح بإحداها أولاً.', chatFailed: 'تعذّر حفظ الاختيار.', cachedWord: 'من الذاكرة المؤقتة', estimate: 'أعداد الرموز تقديرية بحسب الكتابة (العربية تختلف عن اللاتينية)؛ والرقم الدقيق لكل تشغيل عند المزوّد في إيصاله.',
    sourceLearning: 'تعلّمها نجد ووافقتَ عليها', sourceNotes: 'كتبتَها بنفسك في الإعدادات', scopeWord: 'النطاق', scopeGlobal: 'كل المحادثات', scopeConversation: 'محادثة واحدة فقط', scopeProject: 'مشروع واحد', availableWord: 'متاحة للنموذج عندما يحتاجها الطلب', secretNote: 'تبدو كسر: محفوظة هنا ولا تُرسل إلى النموذج أبداً.',
    conflictsWord: (n: number) => `${n} ذكرى قد تتعارض معها: تُرسلان معاً وتُعلَّم الأقدم`,
    reasons: { match: 'تطابق الطلب', name: 'تذكر ملفاً أو اسماً ورد في الطلب', linked: 'مرتبطة بذكرى مطابقة', pinned: 'أحدث تفضيل (يُرسل دائماً)', chat: 'محادثة سابقة تطابق الطلب', newer: 'أحدث من ذكرى تتعارض معها' }, createdWord: 'أُنشئت', updatedWord: 'عُدّلت', originWord: 'المصدر', namesWord: 'الأسماء والملفات فيها',
    left: 'تدوير لليسار', right: 'تدوير لليمين', zoomIn: 'تقريب', zoomOut: 'تبعيد', reset: 'إعادة العرض', autoOn: 'دوران بطيء', autoOff: 'إيقاف الدوران'
  }
} as const

interface FullNote { id: string; title: string; text: string }

export function GraphView({ language }: { language: Language }) {
  const w = words[language], rtl = language === 'ar'
  const [tab, setTab] = useState<Tab>('memory')
  const [data, setData] = useState<NajdGraphData | null>(null)
  const [usage, setUsage] = useState<NajdContextUsage[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [, setFrame] = useState(0)
  const [turning, setTurning] = useState(true)
  const turningRef = useRef(true) // read by the animation loop, so switching the turn on or off never rebuilds the loaders or resets the view
  const positions = useRef(new Map<string, GraphPos>())
  const known = useRef(new Set<string>()), signature = useRef('')
  const alive = useRef(true), selectedRef = useRef<string | null>(null)
  // The camera and what moves it live outside React state: dragging redraws about thirty times a second without re-running the component logic around it.
  const camera = useRef<Camera>({ ...START })
  const motion = useRef({ vyaw: 0, vpitch: 0, zoomTo: START.zoom, focus: null as null | { yaw: number; pitch: number }, dragging: false, autoUntil: 0, moved: false, suppressUntil: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number; ox: number; oy: number }>()), pinch = useRef(0)
  const frameId = useRef(0), lastDraw = useRef(0)
  const tabRef = useRef(tab)
  tabRef.current = tab
  const generation = useRef(0), requestSeq = useRef(0) // a response is used only if its tab is still showing and no newer request was sent
  const svgRef = useRef<SVGSVGElement>(null)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  const tick = useCallback((now: number) => {
    frameId.current = 0
    const c = camera.current, m = motion.current
    let moving = false
    if (!m.dragging) {
      if (Math.abs(m.vyaw) > 0.0004 || Math.abs(m.vpitch) > 0.0004) { c.yaw += m.vyaw; c.pitch = clamp(c.pitch + m.vpitch, -1.35, 1.35); m.vyaw *= 0.93; m.vpitch *= 0.93; moving = true }
      if (m.focus) {
        let dyaw = m.focus.yaw - c.yaw
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) // the short way round
        const dpitch = m.focus.pitch - c.pitch
        c.yaw += dyaw * 0.14; c.pitch += dpitch * 0.14; moving = true
        if (Math.abs(dyaw) < 0.003 && Math.abs(dpitch) < 0.003) m.focus = null
      } else if (turningRef.current && !reduced && !selectedRef.current && now < m.autoUntil) { c.yaw += 0.0028; moving = true }
    }
    if (Math.abs(m.zoomTo - c.zoom) > 0.002) { c.zoom += (m.zoomTo - c.zoom) * 0.2; moving = true }
    // About thirty frames a second are enough to feel smooth and keep a large map cheap.
    if (moving && now - lastDraw.current >= 28) { lastDraw.current = now; setFrame(count => count + 1) }
    if (moving && alive.current && document.visibilityState === 'visible') frameId.current = requestAnimationFrame(tick)
  }, [reduced])
  const kick = useCallback(() => { if (!frameId.current && alive.current) frameId.current = requestAnimationFrame(tick) }, [tick])
  const wake = useCallback((seconds = 12) => { motion.current.autoUntil = performance.now() + seconds * 1000; kick() }, [kick])

  const load = useCallback(async () => {
    // A loader made for another tab (a save or delete that finishes after the owner switched tabs) never runs.
    if (tabRef.current !== tab) return
    const mine = generation.current, sequence = ++requestSeq.current
    const current = () => alive.current && tabRef.current === tab && generation.current === mine && requestSeq.current === sequence
    try {
      if (tab === 'usage') { const rows = await window.najdGraph?.usage(); if (current() && rows) setUsage(rows); return }
      const next = tab === 'memory' ? await window.najdGraph?.memory() : await window.najdGraph?.tools()
      if (!current() || !next) return
      // The whole picture, so a changed link, weight or date is redrawn (the positions are kept either way).
      const sig = tab + JSON.stringify([next.stats, next.nodes.map(node => [node.id, node.label, node.text, node.kind, node.updatedAt, node.weight, node.start, node.ready]), next.edges.map(edge => [edge.from, edge.to, edge.kind, edge.weight])])
      if (sig === signature.current) return
      signature.current = sig
      positions.current = layoutGraph(next.nodes, next.edges, positions.current)
      // Stars that were not on the map before glow for a few seconds, so the owner sees what was just learned.
      const added = new Set(next.nodes.filter(node => known.current.size > 0 && !known.current.has(node.id)).map(node => node.id))
      known.current = new Set(next.nodes.map(node => node.id))
      setData(next)
      if (added.size) { setFresh(added); window.setTimeout(() => { if (alive.current) setFresh(new Set()) }, 4000); wake(6) }
    } catch { /* the map is a view; a failed refresh keeps the last picture */ }
  }, [tab, wake])

  useEffect(() => {
    alive.current = true; generation.current++; signature.current = ''; known.current = new Set(); positions.current = new Map(); setData(null); setSelected(null); selectedRef.current = null
    camera.current = { ...START }; motion.current.zoomTo = START.zoom; motion.current.focus = null; motion.current.vyaw = 0; motion.current.vpitch = 0
    void load(); wake()
    const stop = visibleInterval(() => { void load() }, 2000)
    return () => { alive.current = false; stop(); if (frameId.current) cancelAnimationFrame(frameId.current); frameId.current = 0 }
  }, [load, wake])

  const select = useCallback((id: string | null) => {
    selectedRef.current = id; setSelected(id)
    const at = id ? positions.current.get(id) : null
    // Like clicking a place on a globe: the view turns to bring the star to the middle and comes a little closer.
    if (at) { motion.current.focus = facing(at); motion.current.zoomTo = Math.max(motion.current.zoomTo, 1.5); kick() }
  }, [kick])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => { event.preventDefault(); motion.current.zoomTo = clamp(motion.current.zoomTo * Math.exp(-event.deltaY * 0.0015), 0.35, 4); wake(0); kick() }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [tab, data, kick, wake])

  function onDown(event: React.PointerEvent<SVGSVGElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, ox: event.clientX, oy: event.clientY })
    const m = motion.current
    m.dragging = true; m.moved = false; m.suppressUntil = 0; m.vyaw = 0; m.vpitch = 0; m.focus = null
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = Math.hypot(a.x - b.x, a.y - b.y) }
  }
  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const known = pointers.current.get(event.pointerId)
    if (!known) return
    const dx = event.clientX - known.x, dy = event.clientY - known.y
    pointers.current.set(event.pointerId, { ...known, x: event.clientX, y: event.clientY })
    const m = motion.current
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()], now = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.current > 0) m.zoomTo = clamp(m.zoomTo * now / pinch.current, 0.35, 4)
      pinch.current = now; m.moved = true; kick(); return
    }
    if (!m.moved && Math.hypot(event.clientX - known.ox, event.clientY - known.oy) < 4) return
    if (!m.moved) { m.moved = true; try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* a drag still works without capture */ } }
    // Dragging right turns the near side of the cloud to the right, dragging down turns it down, as on a globe.
    camera.current.yaw -= dx * 0.0085; camera.current.pitch = clamp(camera.current.pitch + dy * 0.0085, -1.35, 1.35)
    m.vyaw = clamp(-dx * 0.0085 * 0.6, -0.06, 0.06); m.vpitch = clamp(dy * 0.0085 * 0.6, -0.05, 0.05)
    kick(); setFrame(count => count + 1)
  }
  function onUp(event: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId); pinch.current = 0
    const m = motion.current
    if (pointers.current.size === 0) { m.dragging = false; if (m.moved) { m.suppressUntil = performance.now() + 80; kick() } }
  }
  function onKey(event: React.KeyboardEvent<SVGSVGElement>) {
    const m = motion.current
    const turn = (yaw: number, pitch: number) => { event.preventDefault(); m.focus = null; m.vyaw += yaw; m.vpitch += pitch; kick() }
    if (event.key === 'ArrowLeft') turn(0.035, 0); else if (event.key === 'ArrowRight') turn(-0.035, 0); else if (event.key === 'ArrowUp') turn(0, -0.03); else if (event.key === 'ArrowDown') turn(0, 0.03)
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); m.zoomTo = clamp(m.zoomTo * 1.2, 0.35, 4); kick() }
    else if (event.key === '-') { event.preventDefault(); m.zoomTo = clamp(m.zoomTo / 1.2, 0.35, 4); kick() }
    else if (event.key === '0') { event.preventDefault(); resetView() }
  }
  function resetView() { const m = motion.current; m.focus = { yaw: START.yaw, pitch: START.pitch }; m.zoomTo = START.zoom; m.vyaw = 0; m.vpitch = 0; selectedRef.current = null; setSelected(null); kick() }
  const impulse = (yaw: number) => { const m = motion.current; m.focus = null; m.vyaw += yaw; kick() }
  const zoomBy = (factor: number) => { const m = motion.current; m.zoomTo = clamp(m.zoomTo * factor, 0.35, 4); kick() }

  const nodes = data?.nodes ?? [], edges = data?.edges ?? []
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const chosen = selected ? byId.get(selected) ?? null : null
  const related = useMemo(() => {
    const set = new Set<string>()
    if (selected) for (const edge of edges) { if (edge.from === selected) set.add(edge.to); if (edge.to === selected) set.add(edge.from) }
    return set
  }, [selected, edges])
  const colorOf = (node: NajdGraphNode) => node.type === 'note' && node.enabled === false ? 'off' : node.type === 'soul' ? 'soul' : node.type === 'section' ? 'section' : node.type === 'toolset' ? (node.ready === false ? 'idle' : node.start ? 'start' : 'toolset')
    : node.type === 'star' ? 'topic' : node.kind === 'preference' ? 'preference' : node.kind === 'experience' ? 'experience' : 'note'

  // Every star projected for the current camera, far ones first so near ones are drawn over them.
  const view = camera.current
  const projected = new Map<string, Projected>()
  for (const node of nodes) { const at = positions.current.get(node.id); if (at) projected.set(node.id, projectPoint(at, view, W, H)) }
  const drawOrder = nodes.filter(node => projected.has(node.id)).sort((a, b) => (projected.get(b.id) as Projected).depth - (projected.get(a.id) as Projected).depth)

  const label = (node: NajdGraphNode) => node.label.length > 22 ? node.label.slice(0, 21) + '…' : node.label
  const kindName = (node: NajdGraphNode) => node.type === 'soul' ? w.soul : node.type === 'section' ? w.section : node.type === 'toolset' ? w.toolset : node.type === 'star' ? w.star
    : node.kind === 'preference' ? w.preference : node.kind === 'experience' ? w.experience : w.note

  return <div className="browser-card graph-card" dir={rtl ? 'rtl' : 'ltr'}>
    <CardHeading icon={Network} title={w.title} hint={w.hint} />
    <div className="graph-tabs" role="tablist">
      {(['memory', 'tools', 'retrieval', 'usage'] as const).map(name => <button key={name} role="tab" aria-selected={tab === name} className={'graph-tab' + (tab === name ? ' on' : '')} data-graph-tab={name} onClick={() => setTab(name)}>{w[name]}</button>)}
      <button className="graph-tab graph-refresh" onClick={() => { signature.current = ''; void load() }} aria-label={w.refresh} title={w.refresh}><RefreshCw size={14} /></button>
    </div>
    {(tab === 'memory' || tab === 'tools') && <>
      <p className="browser-note graph-stats" role="status">{tab === 'memory' ? w.memStats(data?.stats ?? {}) : w.toolStats(data?.stats.toolsets ?? 0, data?.stats.tools ?? 0)} · {tab === 'memory' ? w.legend : w.toolsHint}</p>
      {tab === 'memory' && <p className="browser-note">{w.instructionNote}</p>}
      {data?.degraded && <p className="browser-error" role="alert">{w.degraded}</p>}
      {data && tab === 'memory' && !(data.stats.notes) && <p className="browser-note">{w.empty}</p>}
      {data && tab === 'memory' && (data.stats.total ?? 0) > (data.stats.notes ?? 0) && <p className="browser-note">{w.newest(data.stats.notes, data.stats.total)}</p>}
      <div className="graph-stage">
        <div className="graph-tools" role="toolbar" aria-label={w.title}>
          <button className="graph-tool" data-graph-tool="left" onClick={() => impulse(0.07)} aria-label={w.left} title={w.left}><RotateCcw size={16} /></button>
          <button className="graph-tool" data-graph-tool="right" onClick={() => impulse(-0.07)} aria-label={w.right} title={w.right}><RotateCw size={16} /></button>
          <button className="graph-tool" data-graph-tool="in" onClick={() => zoomBy(1.3)} aria-label={w.zoomIn} title={w.zoomIn}><ZoomIn size={16} /></button>
          <button className="graph-tool" data-graph-tool="out" onClick={() => zoomBy(1 / 1.3)} aria-label={w.zoomOut} title={w.zoomOut}><ZoomOut size={16} /></button>
          <button className="graph-tool" data-graph-tool="reset" onClick={resetView} aria-label={w.reset} title={w.reset}><ScanSearch size={16} /></button>
          {!reduced && <button className="graph-tool" data-graph-tool="turn" aria-pressed={turning} onClick={() => { turningRef.current = !turningRef.current; setTurning(turningRef.current); wake() }} aria-label={turning ? w.autoOff : w.autoOn} title={turning ? w.autoOff : w.autoOn}>{turning ? <Pause size={16} /> : <Play size={16} />}</button>}
        </div>
        <svg ref={svgRef} className="graph-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={w.title} tabIndex={0} data-graph={tab} data-yaw={view.yaw.toFixed(3)} data-zoom={view.zoom.toFixed(3)}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey} onDoubleClick={event => { if (event.target === event.currentTarget) resetView() }}>
          <defs><filter id="graph-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3.2" /></filter></defs>
          {edges.map((edge, i) => { const a = projected.get(edge.from), b = projected.get(edge.to); if (!a || !b) return null
            const hot = selected && (edge.from === selected || edge.to === selected), far = (a.depth + b.depth) / 2
            return <line key={i} className={'graph-edge ' + edge.kind + (hot ? ' hot' : '') + (selected && !hot ? ' dim' : '')} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ opacity: 1 - (far + 1) / 2 * 0.65 }} /> })}
          {drawOrder.map(node => { const p = projected.get(node.id) as Projected
            const r = radiusOf(node), on = selected === node.id, dim = selected && !on && !related.has(node.id), size = clamp(p.scale, 0.5, 2.1)
            return <g key={node.id} data-node={node.id} transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) scale(${size.toFixed(3)})`} role="button" tabIndex={0} aria-label={`${kindName(node)}: ${node.label}`}
              style={{ opacity: dim ? 0.28 : 0.5 + 0.5 * (1 - (p.depth + 1) / 2) }}
              className={`graph-node ${colorOf(node)}${on ? ' selected' : ''}${fresh.has(node.id) ? ' new' : ''}`}
              onClick={() => { if (performance.now() < motion.current.suppressUntil) return; select(on ? null : node.id) }}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(on ? null : node.id) } }}>
              <circle className="glow" r={r * 1.9} filter="url(#graph-glow)" />
              {node.type === 'star' || node.type === 'toolset' ? <circle className="core" r={r} /> : <path className="core" d={starPath(r)} />}
              {((node.type !== 'star' && p.scale >= 0.8) || on) && <text className="graph-label" y={r + 13} textAnchor="middle">{label(node)}</text>}
            </g> })}
        </svg>
        {chosen && <aside className="graph-panel" aria-live="polite">
          <button className="browser-action graph-close" onClick={() => select(null)}>{w.close}</button>
          <NodeDetails node={chosen} nodes={nodes} edges={edges} kindName={kindName(chosen)} w={w} onPick={select} onChanged={() => { signature.current = ''; void load() }} onGone={() => { if (selectedRef.current === chosen.id) select(null); signature.current = ''; void load() }} />
        </aside>}
      </div>
    </>}
    {tab === 'retrieval' && <RetrievalPanel w={w} />}
    {tab === 'usage' && <UsagePanel rows={usage} w={w} />}
  </div>
}

// A four-pointed star of radius r.
function starPath(r: number) {
  const inner = r * 0.42, points: string[] = []
  for (let i = 0; i < 8; i++) { const angle = -Math.PI / 2 + i * Math.PI / 4, radius = i % 2 === 0 ? r : inner; points.push(`${(Math.cos(angle) * radius).toFixed(1)},${(Math.sin(angle) * radius).toFixed(1)}`) }
  return 'M' + points.join('L') + 'Z'
}

function NodeDetails({ node, nodes, edges, kindName, w, onPick, onChanged, onGone }: { node: NajdGraphNode; nodes: NajdGraphNode[]; edges: NajdGraphEdge[]; kindName: string
  w: typeof words.en | typeof words.ar; onPick: (id: string) => void; onChanged: () => void; onGone: () => void }) {
  const [full, setFull] = useState<FullNote | null>(null), [title, setTitle] = useState(''), [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')
  const [info, setInfo] = useState<NajdMemoryDetail | null>(null)
  const isNote = node.type === 'note' && !!node.noteId
  // Where it came from, what it names and whether it conflicts with another: read from the stored graph.
  useEffect(() => {
    setInfo(null)
    if (!node.uid) return
    let live = true
    void window.najdMemoryGraph?.detail(node.uid).then(value => { if (live) setInfo(value) }).catch(() => {})
    return () => { live = false }
  }, [node.uid, node.updatedAt, node.enabled])
  async function toggle(enabled: boolean) {
    if (!node.uid) return
    try { await window.najdMemoryGraph?.setEnabled(node.uid, enabled); onChanged() } catch { setState('error') }
  }
  // The map carries only a short excerpt, so the full text is read from the store before it can be edited.
  useEffect(() => {
    setFull(null); setState('idle')
    if (!isNote) return
    let live = true
    ;(async () => {
      const list: FullNote[] = node.kind === 'note' ? await window.najdMemory?.list() ?? []
        : ((await window.najdLearning?.list())?.approved?.[node.kind as NajdLearningKind] ?? [])
      const found = list.find(item => item.id === node.noteId)
      if (live && found) { setFull(found); setTitle(found.title); setText(found.text) }
    })().catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [node.id, node.noteId, node.kind, isNote])
  const linked = nodes.filter(other => other.type === 'note' && edges.some(edge => (edge.from === node.id && edge.to === other.id) || (edge.to === node.id && edge.from === other.id)))
  async function save() {
    if (!full) return
    setState('busy')
    try {
      if (node.kind === 'note') await window.najdMemory!.save({ id: full.id, title, text })
      else await window.najdLearning!.edit(node.kind as NajdLearningKind, { id: full.id, title, text })
      setState('saved'); onChanged()
    } catch { setState('error') }
  }
  async function remove() {
    if (!full || !window.confirm(w.confirm)) return
    setState('busy')
    try {
      if (node.kind === 'note') await window.najdMemory!.remove(full.id); else await window.najdLearning!.remove(node.kind as NajdLearningKind, full.id)
      onGone()
    } catch { setState('error') }
  }
  return <div className="graph-details">
    <h4>{node.label}</h4><span className="graph-kind">{kindName}</span>
    {isNote && node.uid && <div className="graph-provenance">
      <p>{node.source === 'notes' ? w.sourceNotes : w.sourceLearning}</p>
      <p>{w.scopeWord}: {!node.scope || node.scope === 'global' ? w.scopeGlobal : node.scope.startsWith('conversation:') ? w.scopeConversation : w.scopeProject}</p>
      {node.createdAt && <p>{w.createdWord}: {new Date(node.createdAt).toLocaleDateString()} · {w.updatedWord}: {node.updatedAt ? new Date(node.updatedAt).toLocaleDateString() : '-'}</p>}
      {node.sensitive ? <p className="browser-error" role="status">{w.secretNote}</p>
        : <label className="personality-enable"><input type="checkbox" data-graph="enabled" checked={node.enabled !== false} onChange={event => { void toggle(event.target.checked) }} />{w.availableWord}</label>}
      {!!info?.entities.length && <p>{w.namesWord}: {info.entities.join(', ')}</p>}
      {!!info?.conflicts && <p>{w.conflictsWord(info.conflicts)}</p>}
    </div>}
    {isNote && (full
      ? <form className="capability-form" onSubmit={event => { event.preventDefault(); void save() }}>
        <label>{w.title2}<input value={title} maxLength={80} required onChange={event => setTitle(event.target.value)} data-graph="title" /></label>
        <label>{w.text}<textarea value={text} rows={5} maxLength={node.kind === 'note' ? 100000 : 2000} required onChange={event => setText(event.target.value)} data-graph="text" /></label>
        <div className="browser-actions"><button className="browser-action" disabled={state === 'busy' || !title.trim() || !text.trim()} data-graph="save">{w.save}</button>
          <button className="browser-action" type="button" disabled={state === 'busy'} onClick={() => { void remove() }} data-graph="delete">{w.remove}</button></div>
        {state === 'saved' && <p role="status">{w.saved}</p>}{state === 'error' && <p className="browser-error" role="alert">{w.error}</p>}
      </form>
      : <p className="memory-text" dir="auto">{node.text}</p>)}
    {node.type === 'soul' && <p className="browser-note">{w.soulHint}</p>}
    {node.type === 'section' && <><p className="browser-note">{w.sectionHint}</p><p className="memory-text" dir="auto">{node.text}</p></>}
    {node.type === 'star' && <><p className="browser-note">{w.linked}</p><ul className="graph-linked">{linked.map(other => <li key={other.id}><button className="browser-action" onClick={() => onPick(other.id)}>{other.label}</button></li>)}</ul></>}
    {node.type === 'toolset' && <>
      <p className="browser-note">{w.tools2}: {node.toolNames?.join(', ')}{(node.tools ?? 0) > (node.toolNames?.length ?? 0) ? '…' : ''}</p>
      {node.ready === false && <p className="browser-note" role="status">{w.unavailable}</p>}
      {node.ready !== false && node.start && <p className="browser-note">{w.start}</p>}{node.ready !== false && node.loadable && <p className="browser-note">{w.loadable}</p>}
      {!!node.profiles?.length && <p className="browser-note">{w.profiles}: {node.profiles.join(', ')}</p>}</>}
  </div>
}

function UsagePanel({ rows, w }: { rows: NajdContextUsage[] | null; w: typeof words.en | typeof words.ar }) {
  if (!rows) return <p role="status">…</p>
  if (!rows.length) return <p className="browser-note">{w.none}</p>
  const top = Math.max(...rows.map(row => row.total), 1)
  return <div className="graph-usage"><p className="browser-note">{w.usageHint}</p>
    {rows.slice().reverse().slice(0, 30).map(row => <div className="graph-usage-row" key={row.at + row.total} title={new Date(row.at).toLocaleString()}>
      <span className="graph-usage-meta">{new Date(row.at).toLocaleTimeString()} · {row.profile || '-'} · {row.tools} · {row.windowTokens ? Math.round(row.windowTokens / 1000) + 'k' : '?'}{row.percent !== null ? ` · ${row.percent}%` : ''}</span>
      <span className="graph-bar" aria-label={`${row.total}`} style={{ width: `${Math.max(4, row.total / top * 100)}%` }}>
        {([['instructions', row.instructions], ['toolDefs', row.toolDefinitions], ['history', row.history], ['task', row.taskSoFar]] as const).map(([key, value]) =>
          <i key={key} className={'seg ' + key} style={{ flexGrow: Math.max(value, 1) }} title={`${w[key]}: ${value}`} />)}</span>
      <span className="graph-usage-total">{row.total}{row.condensed ? ` · ${w.condensed}: ${row.condensed}` : ''}</span></div>)}
    <p className="browser-note graph-usage-legend"><i className="seg instructions" /> {w.instructions} <i className="seg toolDefs" /> {w.toolDefs} <i className="seg history" /> {w.history} <i className="seg task" /> {w.task}</p>
  </div>
}

// The service gives its reasons in English (they are also kept in the trace); the panel shows them in the app's language.
function reasonText(reason: string, w: typeof words.en | typeof words.ar) {
  const base = reason.startsWith('matches') ? w.reasons.match : reason.startsWith('names') ? w.reasons.name : reason.startsWith('linked') ? w.reasons.linked
    : reason.startsWith('newest preference') ? w.reasons.pinned : reason.startsWith('earlier conversation') ? w.reasons.chat : reason
  return reason.includes('newer than a conflicting') ? base + ' · ' + w.reasons.newer : base
}

const CHAT_PAGE = 50

function RetrievalPanel({ w }: { w: typeof words.en | typeof words.ar }) {
  const [traces, setTraces] = useState<NajdMemoryTrace[] | null>(null), [status, setStatus] = useState<NajdMemoryGraphStatus | null>(null), [busy, setBusy] = useState(false), [rebuilt, setRebuilt] = useState(false)
  const [chats, setChats] = useState<{ total: number; matching: number; offset: number; rows: NajdMemoryChat[] }>({ total: 0, matching: 0, offset: 0, rows: [] })
  const [chatQuery, setChatQuery] = useState(''), [chatOffset, setChatOffset] = useState(0), [chatError, setChatError] = useState('')
  const chatView = useRef({ query: '', offset: 0 })
  chatView.current = { query: chatQuery, offset: chatOffset }
  const alive = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const [rows, state, indexed] = await Promise.all([window.najdMemoryGraph!.traces(), window.najdMemoryGraph!.status(), window.najdMemoryGraph!.chats({ ...chatView.current, limit: CHAT_PAGE })])
      if (alive.current) { setTraces(rows); setStatus(state); setChats(indexed) }
    } catch { /* a view only */ }
  }, [])
  useEffect(() => { void refresh() }, [chatQuery, chatOffset, refresh])
  async function allowChat(id: string, allowed: boolean) {
    setBusy(true); setChatError('')
    try { await window.najdMemoryGraph!.setChatAllowed(id, allowed); await refresh() } catch (error) { setChatError(String((error as Error)?.message || '').includes('LIMIT_REACHED') ? w.chatLimit : w.chatFailed) } finally { setBusy(false) }
  }
  useEffect(() => { alive.current = true; void refresh(); const stop = visibleInterval(() => { void refresh() }, 3000); return () => { alive.current = false; stop() } }, [refresh])
  async function change(input: Partial<NajdMemoryGraphStatus['settings']>) { setBusy(true); try { setStatus(await window.najdMemoryGraph!.settings(input)) } catch { /* keeps the last state */ } finally { setBusy(false) } }
  async function rebuild() { setBusy(true); try { await window.najdMemoryGraph!.rebuild(); setRebuilt(true); await refresh() } catch { /* keeps the last state */ } finally { setBusy(false) } }
  if (!window.najdMemoryGraph) return <p className="browser-note">{w.noTraces}</p>
  return <div className="graph-retrieval">
    <p className="browser-note">{w.retrievalHint}</p>
    {status && <div className="capability-form graph-engine">
      <label>{w.engine}<select value={status.settings.engine} disabled={busy} data-graph="engine" onChange={event => { void change({ engine: event.target.value as 'graph' | 'legacy' }) }}>
        <option value="graph">{w.graphEngine}</option><option value="legacy">{w.legacyEngine}</option></select></label>
      <label className="personality-enable"><input type="checkbox" checked={status.settings.shareNotes} disabled={busy} data-graph="share-notes" onChange={event => { void change({ shareNotes: event.target.checked }) }} />{w.shareNotes}</label>
      <label className="personality-enable"><input type="checkbox" checked={status.settings.shareChats} disabled={busy} data-graph="share-chats" onChange={event => { void change({ shareChats: event.target.checked }) }} />{w.shareChats}</label>
      {status.stats && <p className="browser-note">{w.dbInfo(status.stats as unknown as Record<string, number>)}{status.migration && <> · {w.backupKept} <bdi className="graph-path" dir="ltr">{status.migration.backup}</bdi></>}</p>}
      {status.error && <p className="browser-error" role="alert">{status.error}</p>}
      {status.settings.shareChats && chats.total > 0 && <details className="graph-chats" data-graph="chats">
        <summary>{w.chatsHeading(chats.total)}</summary>
        <input type="search" value={chatQuery} placeholder={w.chatSearch} aria-label={w.chatSearch} data-graph="chat-search" onChange={event => { setChatQuery(event.target.value); setChatOffset(0) }} />
        {chatError && <p className="browser-error" role="alert">{chatError}</p>}
        <ul>{chats.rows.map(chat => <li key={chat.id}><label className="personality-enable"><input type="checkbox" checked={chat.allowed} disabled={busy} data-graph-chat={chat.id} onChange={event => { void allowChat(chat.id, event.target.checked) }} />
          <bdi>{chat.title || w.untitledChat}</bdi> <span className="graph-trace-meta">· <bdi>{String(chat.updatedAt).slice(0, 10)}</bdi></span></label></li>)}</ul>
        <div className="graph-chat-pages">
          <button className="browser-action" type="button" disabled={chatOffset === 0} data-graph="chat-prev" onClick={() => setChatOffset(Math.max(0, chatOffset - CHAT_PAGE))}>{w.previous}</button>
          <span role="status"><bdi>{chats.matching ? `${chats.offset + 1}–${chats.offset + chats.rows.length}` : '0'}</bdi> / <bdi>{chats.matching}</bdi></span>
          <button className="browser-action" type="button" disabled={chats.offset + chats.rows.length >= chats.matching} data-graph="chat-next" onClick={() => setChatOffset(chatOffset + CHAT_PAGE)}>{w.next}</button>
        </div>
      </details>}
      <div className="browser-actions"><button className="browser-action" type="button" disabled={busy} data-graph="rebuild" onClick={() => { void rebuild() }}>{w.rebuild}</button>{rebuilt && <span role="status">{w.rebuilt}</span>}</div>
    </div>}
    {traces && !traces.length && <p className="browser-note">{w.noTraces}</p>}
    {traces?.slice(0, 12).map(trace => <div className="graph-trace" key={trace.id}>
      {/* Each mixed-script piece is isolated so times, numbers and English titles keep their order in the Arabic layout. */}
      <p className="graph-trace-head"><strong><bdi>{new Date(trace.at).toLocaleTimeString()}</bdi></strong> · <bdi>{trace.engine}</bdi> · <bdi>{trace.tokens}/{trace.budget_tokens}</bdi> {w.budgetWord} · <bdi>{Math.round(trace.ms * 10) / 10} ms</bdi> · <bdi>{trace.items.length}</bdi> {w.itemsWord}</p>
      <ul>{trace.items.map(item => <li key={item.id}><span className={'graph-trace-kind ' + item.kind}>{item.kind}</span> <bdi>{item.title || item.id.slice(0, 18)}</bdi> <span className="graph-trace-meta">· {reasonText(item.reason, w)} · <bdi>{item.tokens}</bdi> {w.tokensWord}</span></li>)}</ul>
    </div>)}
    <p className="browser-note">{w.estimate}</p>
  </div>
}
