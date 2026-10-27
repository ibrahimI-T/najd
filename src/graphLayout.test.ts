import { describe, expect, it } from 'vitest'
import { facing, layoutGraph, projectPoint, RADIUS, type GraphPos } from './graphLayout'

const note = (id: string) => ({ id, type: 'note', weight: 1 })
const star = (id: string) => ({ id, type: 'star', weight: 2 })
const dist = (a: GraphPos, b: GraphPos) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('graph layout', () => {
  const nodes = [note('n1'), note('n2'), note('n3'), star('s1'), star('s2'), { id: 'soul', type: 'soul', weight: 6 }]
  const edges = [{ from: 'n1', to: 's1', kind: 'mentions', weight: 1 }, { from: 'n2', to: 's1', kind: 'mentions', weight: 1 }, { from: 'n3', to: 's2', kind: 'mentions', weight: 1 },
    { from: 'soul', to: 'n1', kind: 'shapes', weight: 1 }, { from: 'n1', to: 'n2', kind: 'related', weight: 1 }]

  it('places every node inside the sphere, apart from each other, the same way every time, with the soul in the middle', () => {
    const a = layoutGraph(nodes, edges, new Map()), b = layoutGraph(nodes, edges, new Map())
    expect([...a.keys()].sort()).toEqual(nodes.map(node => node.id).sort())
    for (const [id, p] of a) {
      expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true)
      expect(Math.hypot(p.x, p.y, p.z)).toBeLessThanOrEqual(RADIUS + 1)
      expect(b.get(id)).toEqual(p)
    }
    expect(a.get('soul')).toEqual({ x: 0, y: 0, z: 0 })
    const list = [...a.values()]
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(dist(list[i], list[j])).toBeGreaterThan(8)
  })

  it('keeps known stars where they were and puts a new one next to what it links to', () => {
    const first = layoutGraph(nodes, edges, new Map())
    const second = layoutGraph([...nodes, note('n4')], [...edges, { from: 'n4', to: 's2', kind: 'mentions', weight: 1 }], first)
    for (const node of nodes) expect(dist(first.get(node.id) as GraphPos, second.get(node.id) as GraphPos)).toBeLessThan(70)
    expect(dist(second.get('s2') as GraphPos, second.get('n4') as GraphPos)).toBeLessThan(170)
  })

  it('handles an empty map, a single star and a few hundred stars', () => {
    expect(layoutGraph([], [], new Map()).size).toBe(0)
    expect(layoutGraph([note('only')], [], new Map()).get('only')).toBeDefined()
    const many = Array.from({ length: 350 }, (_, i) => note('m' + i))
    expect(layoutGraph(many, many.slice(1).map((n, i) => ({ from: many[i].id, to: n.id, kind: 'related', weight: 1 })), new Map()).size).toBe(350)
  })
})

describe('graph camera', () => {
  const front = { yaw: 0, pitch: 0, zoom: 1 }
  it('draws near stars larger and lower in depth value than far ones, and zoom scales the picture', () => {
    const near = projectPoint({ x: 0, y: 0, z: -150 }, front), far = projectPoint({ x: 0, y: 0, z: 150 }, front)
    expect(near.scale).toBeGreaterThan(far.scale); expect(near.depth).toBeLessThan(far.depth)
    const out = projectPoint({ x: 100, y: 0, z: 0 }, front), zoomed = projectPoint({ x: 100, y: 0, z: 0 }, { ...front, zoom: 2 })
    expect(zoomed.x - 450).toBeCloseTo((out.x - 450) * 2, 5)
  })

  it('turning right or left moves a star around the middle, and a full turn comes back', () => {
    const point = { x: 120, y: 30, z: 0 }
    const a = projectPoint(point, front), right = projectPoint(point, { ...front, yaw: Math.PI / 2 }), back = projectPoint(point, { ...front, yaw: Math.PI * 2 })
    expect(a.x).toBeGreaterThan(450); expect(Math.abs(right.x - 450)).toBeLessThan(1); expect(right.depth).not.toBe(a.depth)
    expect(back.x).toBeCloseTo(a.x, 5); expect(back.y).toBeCloseTo(a.y, 5)
  })

  it('facing a star brings it to the centre and to the front', () => {
    for (const p of [{ x: 100, y: 40, z: -60 }, { x: -80, y: -90, z: 120 }, { x: 0, y: 0, z: 50 }]) {
      const angles = facing(p), shown = projectPoint(p, { ...angles, zoom: 1 })
      expect(Math.abs(shown.x - 450)).toBeLessThan(2); expect(Math.abs(shown.y - 260)).toBeLessThan(2); expect(shown.depth).toBeLessThan(0)
    }
  })
})

describe('graph layout cost', () => {
  it('does no settling work when nothing is new, however large the map is', () => {
    const many = Array.from({ length: 900 }, (_, i) => note('m' + i))
    const edges = many.slice(1).map((n, i) => ({ from: many[i].id, to: n.id, kind: 'related', weight: 1 }))
    const first = layoutGraph(many.slice(0, 60), edges.slice(0, 59), new Map())
    const big = layoutGraph(many, edges, new Map([...first, ...many.slice(60).map((n, i) => [n.id, { x: i % 30 * 5, y: Math.floor(i / 30) * 5, z: 0 }] as [string, GraphPos])]))
    const started = performance.now()
    const again = layoutGraph(many, edges, big)
    expect(performance.now() - started).toBeLessThan(150)
    for (const [id, p] of big) expect(again.get(id)).toEqual(p)
  })
})
