// A small 3D force layout and camera for the memory and tool maps. Nodes push each other apart, links pull their ends
// together and everything is held around the middle, so the map is a cloud of stars the owner can turn around, like a globe.
// Positions the viewer already has are the starting point, so a new memory appears next to what it connects to and the rest of
// the map stays where the owner last saw it.
export interface GraphPos { x: number; y: number; z: number }
interface LayoutNode { id: string; type: string; weight: number }
interface LayoutEdge { from: string; to: string; kind: string; weight: number }
export interface Camera { yaw: number; pitch: number; zoom: number }

export const RADIUS = 240 // the cloud fits inside a sphere of this radius
const DISTANCE = 560 // how far the camera is from the middle of the cloud
const LINK_LENGTH: Record<string, number> = { mentions: 78, related: 120, part: 92, shapes: 150, next: 130 }
const radiusOf = (node: LayoutNode) => node.type === 'soul' ? 22 : node.type === 'toolset' ? 12 + Math.min(10, node.weight * 1.5) : node.type === 'note' ? 11 : node.type === 'section' ? 9 : 5 + Math.min(5, node.weight)

// A stable number in [0, 1) from text, so the same graph always lays out the same way.
function unit(text: string, salt: number) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}
// A direction on the sphere from text (uniform over the sphere).
function direction(id: string, salt: number): [number, number, number] {
  const z = unit(id, salt) * 2 - 1, angle = unit(id, salt + 7) * Math.PI * 2, ring = Math.sqrt(Math.max(0, 1 - z * z))
  return [Math.cos(angle) * ring, z, Math.sin(angle) * ring]
}

export function layoutGraph(nodes: LayoutNode[], edges: LayoutEdge[], previous: Map<string, GraphPos>): Map<string, GraphPos> {
  const count = nodes.length
  const result = new Map<string, GraphPos>()
  if (!count) return result
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const px = new Float64Array(count), py = new Float64Array(count), pz = new Float64Array(count)
  const neighbours = nodes.map(() => [] as number[])
  const links: Array<[number, number, number]> = []
  for (const edge of edges) {
    const a = index.get(edge.from), b = index.get(edge.to)
    if (a === undefined || b === undefined || a === b) continue
    links.push([a, b, LINK_LENGTH[edge.kind] || 84]); neighbours[a].push(b); neighbours[b].push(a)
  }
  let fresh = 0
  nodes.forEach((node, i) => {
    const known = previous.get(node.id)
    if (known) { px[i] = known.x; py[i] = known.y; pz[i] = known.z; return }
    fresh++
    // Next to a neighbour that is already placed, otherwise on a shell around the middle (the soul starts in the middle).
    const anchor = neighbours[i].map(j => previous.get(nodes[j].id)).find(Boolean)
    const [dx, dy, dz] = direction(node.id, 1), spread = 36 + unit(node.id, 2) * 40
    if (anchor) { px[i] = anchor.x + dx * spread; py[i] = anchor.y + dy * spread; pz[i] = anchor.z + dz * spread }
    else if (node.type === 'soul') { px[i] = 0; py[i] = 0; pz[i] = 0 }
    else { const shell = 70 + unit(node.id, 3) * RADIUS * 0.7; px[i] = dx * shell; py[i] = dy * shell; pz[i] = dz * shell }
  })
  // Few new nodes on a known map need only a short settling; a whole new map needs the full run.
  // Nothing new means nothing to settle, whatever the size (an edited note keeps every coordinate).
  const iterations = fresh === 0 ? 0 : count > 400 ? 60 : fresh < count / 2 ? 80 : 200
  const radius = nodes.map(radiusOf)
  const dx = new Float64Array(count), dy = new Float64Array(count), dz = new Float64Array(count)
  for (let step = 0; step < iterations; step++) {
    const cool = 1 - step / iterations
    dx.fill(0); dy.fill(0); dz.fill(0)
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      let ex = px[i] - px[j], ey = py[i] - py[j], ez = pz[i] - pz[j]
      let d2 = ex * ex + ey * ey + ez * ez
      if (d2 > 160000) continue
      if (d2 < 0.01) { ex = unit(nodes[i].id, j) - 0.5; ey = unit(nodes[j].id, i) - 0.5; ez = unit(nodes[i].id, j + 3) - 0.5; d2 = ex * ex + ey * ey + ez * ez + 0.01 }
      const d = Math.sqrt(d2), push = (4200 + (radius[i] + radius[j]) * 70) / d2
      dx[i] += ex / d * push; dy[i] += ey / d * push; dz[i] += ez / d * push; dx[j] -= ex / d * push; dy[j] -= ey / d * push; dz[j] -= ez / d * push
    }
    for (const [a, b, length] of links) {
      const ex = px[b] - px[a], ey = py[b] - py[a], ez = pz[b] - pz[a], d = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1, pull = (d - length) * 0.045
      dx[a] += ex / d * pull; dy[a] += ey / d * pull; dz[a] += ez / d * pull; dx[b] -= ex / d * pull; dy[b] -= ey / d * pull; dz[b] -= ez / d * pull
    }
    for (let i = 0; i < count; i++) {
      if (nodes[i].type === 'soul') { px[i] = py[i] = pz[i] = 0; continue }
      dx[i] -= px[i] * 0.012; dy[i] -= py[i] * 0.012; dz[i] -= pz[i] * 0.012
      // Known nodes move far less, so the map does not jump when something is added.
      const damp = previous.has(nodes[i].id) ? 0.08 : 1
      const speed = Math.hypot(dx[i], dy[i], dz[i]) || 1, limit = 14 * cool + 1
      const scale = Math.min(1, limit / speed) * damp
      px[i] += dx[i] * scale; py[i] += dy[i] * scale; pz[i] += dz[i] * scale
    }
  }
  // Keep the cloud inside the sphere: a first layout is scaled to fill about 80% of it, a map that already has stars is only
  // shrunk when it no longer fits, so nothing shifts under the owner's eyes.
  let far = 1
  for (let i = 0; i < count; i++) far = Math.max(far, Math.hypot(px[i], py[i], pz[i]))
  const scale = previous.size ? Math.min(1, RADIUS / far) : Math.min(2.4, RADIUS * 0.85 / far)
  nodes.forEach((node, i) => result.set(node.id, { x: px[i] * scale, y: py[i] * scale, z: pz[i] * scale }))
  return result
}

export interface Projected { x: number; y: number; scale: number; depth: number }

// Where a point of the cloud lands on the screen for a camera turned by yaw (left-right) and pitch (up-down), with a perspective
// that makes near stars larger. `depth` is -1 for the nearest possible point and 1 for the farthest.
export function projectPoint(pos: GraphPos, camera: Camera, width = 900, height = 520): Projected {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch)
  const x1 = pos.x * cy + pos.z * sy, z1 = -pos.x * sy + pos.z * cy
  const y2 = pos.y * cp - z1 * sp, z2 = pos.y * sp + z1 * cp
  const scale = DISTANCE / (DISTANCE + z2) * camera.zoom
  return { x: width / 2 + x1 * scale, y: height / 2 + y2 * scale, scale, depth: Math.max(-1, Math.min(1, z2 / RADIUS)) }
}

// The camera angles that bring a point to the front and centre of the view.
export function facing(pos: GraphPos): { yaw: number; pitch: number } {
  const yaw = Math.atan2(pos.x, -pos.z), reach = Math.hypot(pos.x, pos.z)
  return { yaw, pitch: Math.max(-1.2, Math.min(1.2, -Math.atan2(pos.y, reach || 1))) }
}

export { radiusOf }
