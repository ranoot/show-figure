// Graph → geometry. A layered layout: columns by logic depth, a 1-D stack per column, and
// orthogonal wires that run only in a node's own band, in reserved lanes through columns, or on
// assigned tracks in the channels between columns. verify() checks the result; nothing that
// fails it is ever returned.

import { LogicError, textWidth, where } from './model.js'
import type { Directive } from './model.js'
import type { GNode, Graph, Net } from './graph.js'
import { P, symbolFor } from './symbols.js'
import type { Sym } from './symbols.js'

const TRACK = 12
/** Every item sits so its pins land on this grid; then two pins either line up or differ by a real step. */
const GRID = P / 2
const MINSEP = 5
const DUMMY_H = 10
const EPS = 0.01

type Item = {
  id: string
  col: number
  node?: GNode
  sym?: Sym
  net?: string
  w: number
  h: number
  bodyTop: number
  y: number
  seq: number
  topTrack: Map<string, number>
  botTrack: Map<string, number>
}

type Access = {
  item: Item
  net: string
  pin?: string
  channel: number
  side: 'L' | 'R'
  dy: number
}

export type Seg = { x1: number; y1: number; x2: number; y2: number; net: string }
export type Box = { x: number; y: number; w: number; h: number }
export type Mark = { x: number; y: number; text: string; net: string; box: Box }
export type TextLabel = { x: number; y: number; text: string; anchor: 'start' | 'end'; net: string; box: Box }

export type Geometry = {
  nodes: { node: GNode; sym: Sym; x: number; y: number }[]
  segs: Seg[]
  dots: { x: number; y: number; net: string }[]
  marks: Mark[]
  labels: TextLabel[]
  nets: Map<string, Net>
  bounds: Box
  columns: string[][]
  crossings: number
}

export type Violation = { what: string; nets: string[]; y: number; x: number }

class Conflict extends Error {
  v: Violation
  constructor(v: Violation) {
    super(v.what)
    this.v = v
  }
}

// ---- columns --------------------------------------------------------------

function assignColumns(g: Graph, warnings: string[], newest: number): Map<string, number> {
  const nodes = g.nodes
  const succ = new Map<string, string[]>()
  const pred = new Map<string, string[]>()
  for (const n of nodes) {
    succ.set(n.id, [])
    pred.set(n.id, [])
  }
  for (const net of g.nets) {
    for (const s of net.sinks) {
      if (s.node === net.driver.node) continue
      succ.get(net.driver.node)!.push(s.node)
    }
  }
  // DFS from inputs and constants, then everything else, dropping back edges.
  const state = new Map<string, number>()
  const forward = new Map<string, string[]>()
  for (const n of nodes) forward.set(n.id, [])
  const visit = (root: string) => {
    const stack: [string, number][] = [[root, 0]]
    state.set(root, 1)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!
      const [v, i] = top
      const out = succ.get(v)!
      if (i < out.length) {
        top[1]++
        const w = out[i]!
        const st = state.get(w) ?? 0
        if (st === 1) continue // back edge
        forward.get(v)!.push(w)
        if (st === 0) {
          state.set(w, 1)
          stack.push([w, 0])
        }
      } else {
        state.set(v, 2)
        stack.pop()
      }
    }
  }
  const roots = [
    ...nodes.filter(n => n.kind === 'input' || n.kind === 'const'),
    ...nodes.filter(n => n.kind !== 'input' && n.kind !== 'const'),
  ]
  for (const r of roots) if ((state.get(r.id) ?? 0) === 0) visit(r.id)
  for (const [v, ws] of forward) for (const w of ws) pred.get(w)!.push(v)

  const forced = new Map<string, number>()
  const at = (d: Directive) => where(d.line, d.chunk, newest)
  const known = (name: string, d: Directive) => {
    if (g.byId.has(name)) return true
    warnings.push(`${at(d)}: '${name}' is not a gate, block or input; ignored`)
    return false
  }
  for (const d of g.directives) {
    if (d.kind === 'col' && known(d.name, d)) forced.set(d.name, d.col)
    if (d.kind === 'at' && known(d.name, d)) forced.set(d.name, d.col)
    if (d.kind === 'order' && d.col !== undefined) for (const n of d.names) if (known(n, d)) forced.set(n, d.col)
  }

  const level = new Map<string, number>()
  const compute = () => {
    level.clear()
    const indeg = new Map<string, number>()
    for (const n of nodes) indeg.set(n.id, pred.get(n.id)!.length)
    const queue = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id)
    const order: string[] = []
    while (queue.length > 0) {
      const v = queue.shift()!
      order.push(v)
      for (const w of forward.get(v)!) {
        indeg.set(w, indeg.get(w)! - 1)
        if (indeg.get(w) === 0) queue.push(w)
      }
    }
    for (const v of order) {
      const f = forced.get(v)
      if (f !== undefined) {
        level.set(v, f)
        continue
      }
      const node = g.byId.get(v)!
      if (node.kind === 'input') {
        level.set(v, 0)
        continue
      }
      let l = 0
      for (const u of pred.get(v)!) l = Math.max(l, (level.get(u) ?? 0) + 1)
      level.set(v, l)
    }
  }
  compute()

  // Relative placement, then a second pass so what follows a moved node moves too.
  let changed = false
  for (const d of g.directives) {
    if (d.kind !== 'place' || !known(d.a, d) || !known(d.b, d)) continue
    if (d.a === d.b) {
      warnings.push(`${at(d)}: place ${d.a} relative to itself; ignored`)
      continue
    }
    const cb = level.get(d.b) ?? 0
    const ca = d.rel === 'left-of' ? cb - 1 : d.rel === 'right-of' ? cb + 1 : d.rel === 'same-row' ? undefined : cb
    if (ca !== undefined) {
      forced.set(d.a, ca)
      changed = true
    }
  }
  for (const d of g.directives) {
    if (d.kind !== 'move' || (d.dir !== 'left' && d.dir !== 'right') || !known(d.name, d)) continue
    forced.set(d.name, (forced.get(d.name) ?? level.get(d.name) ?? 0) + (d.dir === 'left' ? -d.n : d.n))
    changed = true
  }
  if (changed) compute()

  // Constants sit just left of what they feed; outputs line up on the right.
  const cols = new Map(level)
  for (const n of nodes) {
    if (n.kind !== 'const' || forced.has(n.id)) continue
    let c = Infinity
    for (const net of g.nets) {
      if (net.driver.node !== n.id) continue
      for (const s of net.sinks) c = Math.min(c, (cols.get(s.node) ?? 1) - 1)
    }
    cols.set(n.id, c === Infinity ? 0 : c)
  }
  let maxCol = 0
  for (const n of nodes) if (n.kind !== 'output') maxCol = Math.max(maxCol, cols.get(n.id) ?? 0)
  for (const n of nodes) if (n.kind === 'output' && !forced.has(n.id)) cols.set(n.id, maxCol + 1)
  let minCol = Infinity
  for (const c of cols.values()) minCol = Math.min(minCol, c)
  if (minCol !== 0 && minCol !== Infinity) for (const [k, c] of cols) cols.set(k, c - minCol)

  return cols
}

// ---- the layout ------------------------------------------------------------

type Ctx = {
  g: Graph
  spacing: number
  warnings: string[]
  newest: number
  cols: Map<string, number>
  items: Item[]
  columns: Item[][]
  accesses: Access[]
  byNet: Map<string, Access[]>
  neighbors: Map<Item, { mine: Access; other: Access }[]>
  before: Map<number, [Item, Item][]>
  rowPin: Map<Item, number>
  shift: Map<Item, number>
  aligns: [Item, Item][]
  /** Inputs that only feed selects and enables (1) or clocks (2): drawn under the data inputs, clocks last. */
  low: Map<Item, number>
  lowNets: Map<string, number>
  nudge: Map<Item, number>
  /** Where on the grid an item's top goes, so its first pin lands on a grid line. */
  phase: Map<Item, number>
}

function build(g: Graph, spacing: number, warnings: string[], newest: number): Ctx {
  const cols = assignColumns(g, warnings, newest)
  const items: Item[] = []
  const byNode = new Map<string, Item>()
  const connected = new Set<string>()
  for (const net of g.nets) {
    connected.add(`${net.driver.node}.${net.driver.pin}`)
    for (const s of net.sinks) connected.add(`${s.node}.${s.pin}`)
  }

  for (const node of g.nodes) {
    const sym = symbolFor(node, g.showNames)
    const topTrack = new Map<string, number>()
    const botTrack = new Map<string, number>()
    for (const [map, side] of [
      [topTrack, 'top'],
      [botTrack, 'bottom'],
    ] as const) {
      const ps = node.pins.filter(p => p.side === side && connected.has(`${node.id}.${p.name}`))
      const ins = ps.filter(p => p.dir === 'in').sort((a, b) => sym.pins.get(a.name)!.x - sym.pins.get(b.name)!.x)
      const outs = ps.filter(p => p.dir === 'out').sort((a, b) => sym.pins.get(b.name)!.x - sym.pins.get(a.name)!.x)
      ;[...ins, ...outs].forEach((p, k) => map.set(p.name, k))
    }
    const margin = (n: number) => (n > 0 ? n * TRACK + GRID : 0)
    const topM = margin(topTrack.size)
    const botM = margin(botTrack.size)
    const item: Item = {
      id: node.id,
      col: cols.get(node.id) ?? 0,
      node,
      sym,
      w: sym.w,
      h: topM + sym.h + botM,
      bodyTop: topM,
      y: 0,
      seq: node.seq,
      topTrack,
      botTrack,
    }
    items.push(item)
    byNode.set(node.id, item)
  }

  const accesses: Access[] = []
  const byNet = new Map<string, Access[]>()
  const push = (a: Access) => {
    accesses.push(a)
    const list = byNet.get(a.net) ?? []
    list.push(a)
    byNet.set(a.net, list)
  }
  const pinAccess = (item: Item, net: string, pinName: string): Access => {
    const node = item.node!
    const pin = node.pins.find(p => p.name === pinName)!
    const sp = item.sym!.pins.get(pinName)!
    const c = item.col
    switch (sp.side) {
      case 'left':
        return { item, net, pin: pinName, channel: c - 1, side: 'R', dy: item.bodyTop + sp.y }
      case 'right':
        return { item, net, pin: pinName, channel: c, side: 'L', dy: item.bodyTop + sp.y }
      case 'top': {
        const t = item.topTrack.get(pinName) ?? 0
        const dy = item.bodyTop - (t + 1) * TRACK
        return pin.dir === 'in'
          ? { item, net, pin: pinName, channel: c - 1, side: 'R', dy }
          : { item, net, pin: pinName, channel: c, side: 'L', dy }
      }
      default: {
        const t = item.botTrack.get(pinName) ?? 0
        const dy = item.bodyTop + item.sym!.h + (t + 1) * TRACK
        return pin.dir === 'in'
          ? { item, net, pin: pinName, channel: c - 1, side: 'R', dy }
          : { item, net, pin: pinName, channel: c, side: 'L', dy }
      }
    }
  }

  for (const net of g.nets) {
    if (net.sinks.length === 0) continue
    const d = byNode.get(net.driver.node)!
    push(pinAccess(d, net.id, net.driver.pin))
    for (const s of net.sinks) push(pinAccess(byNode.get(s.node)!, net.id, s.pin))
    const list = byNet.get(net.id)!
    let lo = Infinity
    let hi = -Infinity
    for (const a of list) {
      lo = Math.min(lo, a.channel)
      hi = Math.max(hi, a.channel)
    }
    for (let c = lo + 1; c <= hi; c++) {
      const dummy: Item = {
        id: `~${net.id}@${c}`,
        col: c,
        net: net.id,
        w: 0,
        h: DUMMY_H,
        bodyTop: 0,
        y: 0,
        seq: d.seq + 0.5,
        topTrack: new Map(),
        botTrack: new Map(),
      }
      items.push(dummy)
      push({ item: dummy, net: net.id, channel: c - 1, side: 'R', dy: DUMMY_H / 2 })
      push({ item: dummy, net: net.id, channel: c, side: 'L', dy: DUMMY_H / 2 })
    }
  }

  const low = new Map<Item, number>()
  const lowNets = new Map<string, number>()
  for (const net of g.nets) {
    const d = byNode.get(net.driver.node)!
    if (d.node?.kind !== 'input' || net.sinks.length === 0) continue
    const clock = (s: { node: string; pin: string }) =>
      byNode.get(s.node)!.node!.pins.find(p => p.name === s.pin)?.clock === true
    const control = (s: { node: string; pin: string }) => {
      const it = byNode.get(s.node)!
      const side = it.sym!.pins.get(s.pin)?.side
      return clock(s) || side === 'bottom' || side === 'top'
    }
    if (net.sinks.every(clock)) low.set(d, 2)
    else if (net.sinks.every(control)) low.set(d, 1)
    if (low.has(d)) lowNets.set(net.id, low.get(d)!)
  }
  for (const it of items) {
    if (it.net !== undefined && lowNets.has(it.net)) low.set(it, lowNets.get(it.net)!)
  }

  const phase = new Map<Item, number>()
  for (const a of accesses) {
    if (!phase.has(a.item)) phase.set(a.item, (((-a.dy) % GRID) + GRID) % GRID)
  }

  // Neighbours: the other end of the same net across the same channel.
  const neighbors = new Map<Item, { mine: Access; other: Access }[]>()
  for (const list of byNet.values()) {
    for (const a of list) {
      for (const b of list) {
        if (a === b || a.item === b.item || a.channel !== b.channel || a.side === b.side) continue
        const l = neighbors.get(a.item) ?? []
        l.push({ mine: a, other: b })
        neighbors.set(a.item, l)
      }
    }
  }

  let maxCol = 0
  for (const it of items) maxCol = Math.max(maxCol, it.col)
  const columns: Item[][] = Array.from({ length: maxCol + 1 }, () => [])
  for (const it of items) columns[it.col]!.push(it)
  for (const col of columns) col.sort((a, b) => a.seq - b.seq)

  // Order constraints, checked for cycles as they are added.
  const before = new Map<number, [Item, Item][]>()
  const rowPin = new Map<Item, number>()
  const shift = new Map<Item, number>()
  const aligns: [Item, Item][] = []
  const at = (d: Directive) => where(d.line, d.chunk, newest)
  const reaches = (pairs: [Item, Item][], from: Item, to: Item) => {
    const seen = new Set<Item>([from])
    const stack = [from]
    while (stack.length > 0) {
      const v = stack.pop()!
      if (v === to) return true
      for (const [a, b] of pairs) if (a === v && !seen.has(b)) {
        seen.add(b)
        stack.push(b)
      }
    }
    return false
  }
  const precede = (a: Item, b: Item, d: Directive, text: string) => {
    if (a.col !== b.col) {
      warnings.push(`${at(d)}: ${text}: ${a.id} and ${b.id} are in different columns (${a.col}, ${b.col}); ignored`)
      return
    }
    const pairs = before.get(a.col) ?? []
    if (reaches(pairs, b, a)) {
      warnings.push(`${at(d)}: ${text} contradicts an earlier order; ignored`)
      return
    }
    pairs.push([a, b])
    before.set(a.col, pairs)
  }
  for (const d of g.directives) {
    if (d.kind === 'place') {
      const a = byNode.get(d.a)
      const b = byNode.get(d.b)
      if (a === undefined || b === undefined || a === b) continue
      if (d.rel === 'above') precede(a, b, d, `place ${d.a} above ${d.b}`)
      else if (d.rel === 'below') precede(b, a, d, `place ${d.a} below ${d.b}`)
      else if (d.rel === 'same-row') aligns.push([a, b])
    } else if (d.kind === 'order') {
      const its = d.names.map(n => byNode.get(n)).filter((x): x is Item => x !== undefined)
      for (let k = 0; k + 1 < its.length; k++) precede(its[k]!, its[k + 1]!, d, `order ${d.names.join(' ')}`)
    } else if (d.kind === 'at') {
      const it = byNode.get(d.name)
      if (it) rowPin.set(it, d.row)
    } else if (d.kind === 'move' && (d.dir === 'up' || d.dir === 'down')) {
      const it = byNode.get(d.name)
      if (it) shift.set(it, (shift.get(it) ?? 0) + (d.dir === 'up' ? -d.n : d.n))
    }
  }

  return {
    g,
    spacing,
    warnings,
    newest,
    cols,
    items,
    columns,
    accesses,
    byNet,
    neighbors,
    before,
    rowPin,
    shift,
    aligns,
    nudge: new Map(),
    phase,
    low,
    lowNets,
  }
}

function gapBetween(ctx: Ctx, a: Item, b: Item): number {
  // Ports stack at pin pitch, so a gate's inputs can come straight in from a column of them.
  if (a.node?.shape === 'port' && b.node?.shape === 'port') return Math.round((P - 20) * ctx.spacing)
  if (a.node === undefined || b.node === undefined) return Math.round(10 * ctx.spacing)
  return Math.round(30 * ctx.spacing)
}

/** Least-squares positions for a column in a fixed order, no two bands closer than their gap. */
function legalize(ctx: Ctx, col: Item[], desired: number[]) {
  type Cl = { first: number; last: number; sum: number; n: number; len: number }
  const off = col.map(() => 0)
  const cls: Cl[] = []
  for (let i = 0; i < col.length; i++) {
    let cl: Cl = { first: i, last: i, sum: desired[i]!, n: 1, len: col[i]!.h }
    for (;;) {
      const prev = cls[cls.length - 1]
      if (prev === undefined) break
      const gap = gapBetween(ctx, col[prev.last]!, col[cl.first]!)
      if (prev.sum / prev.n + prev.len + gap <= cl.sum / cl.n + 1e-9) break
      const shift = prev.len + gap
      for (let j = cl.first; j <= cl.last; j++) off[j]! += shift
      prev.sum += cl.sum - cl.n * shift
      prev.n += cl.n
      prev.len = shift + cl.len
      prev.last = cl.last
      cls.pop()
      cl = prev
    }
    cls.push(cl)
  }
  for (const cl of cls) {
    const base = Math.round(cl.sum / cl.n)
    for (let j = cl.first; j <= cl.last; j++) col[j]!.y = base + off[j]!
  }
  // Onto the grid, top down, never closer than the gap.
  for (let j = 0; j < col.length; j++) {
    const it = col[j]!
    const ph = ctx.phase.get(it) ?? 0
    let y = Math.round((it.y - ph) / GRID) * GRID + ph
    const prev = col[j - 1]
    if (prev !== undefined) {
      const floor = prev.y + prev.h + gapBetween(ctx, prev, it)
      if (y < floor - EPS) y = Math.ceil((floor - ph) / GRID - 1e-9) * GRID + ph
    }
    it.y = y
  }
}

function desiredOf(ctx: Ctx, it: Item, mode: 'L' | 'R' | 'both'): number | undefined {
  // Clock, select and enable inputs run along the bottom and rise into their pins.
  if (ctx.low.has(it)) {
    let bottom = 0
    for (const o of ctx.items) if (!ctx.low.has(o) && o.node?.kind !== 'input') bottom = Math.max(bottom, o.y + o.h)
    return bottom + 2 * GRID + (ctx.nudge.get(it) ?? 0)
  }
  let s = 0
  let w = 0
  for (const nb of ctx.neighbors.get(it) ?? []) {
    // Those bottom inputs follow the rest; they never pull it down after them.
    if (ctx.lowNets.has(nb.mine.net) && !ctx.lowNets.has(nb.other.net)) continue
    if (ctx.lowNets.has(nb.mine.net) && it.node !== undefined) continue
    const oc = nb.other.item.col
    if (mode === 'L' && oc >= it.col) continue
    if (mode === 'R' && oc <= it.col) continue
    const wt = it.node === undefined && nb.other.item.node === undefined ? 6 : it.node === undefined || nb.other.item.node === undefined ? 2 : 1
    s += wt * (nb.other.item.y + nb.other.dy - nb.mine.dy)
    w += wt
  }
  for (const [a, b] of ctx.aligns) {
    const other = a === it ? b : b === it ? a : undefined
    if (other === undefined) continue
    s += 3 * (other.y + other.h / 2 - it.h / 2)
    w += 3
  }
  return w > 0 ? s / w + (ctx.nudge.get(it) ?? 0) : undefined
}

function stackNaive(ctx: Ctx, col: Item[]) {
  let y = 0
  for (let k = 0; k < col.length; k++) {
    const it = col[k]!
    it.y = y
    y += it.h + (k + 1 < col.length ? gapBetween(ctx, it, col[k + 1]!) : 0)
  }
}

function reorder(ctx: Ctx, c: number, keyed: { it: Item; key: number }[]): Item[] {
  keyed.sort((a, b) => a.key - b.key)
  let order = keyed.map(k => k.it)
  order = [0, 1, 2].flatMap(rank => order.filter(it => (ctx.low.get(it) ?? 0) === rank))
  // Explicit rows and moves, then the precedence constraints, which win.
  for (const [it, row] of ctx.rowPin) {
    if (it.col !== c) continue
    order = order.filter(x => x !== it)
    order.splice(Math.max(0, Math.min(order.length, row)), 0, it)
  }
  for (const [it, by] of ctx.shift) {
    if (it.col !== c) continue
    const i = order.indexOf(it)
    order.splice(i, 1)
    order.splice(Math.max(0, Math.min(order.length, i + by)), 0, it)
  }
  const pairs = ctx.before.get(c) ?? []
  if (pairs.length === 0) return order
  const pos = new Map(order.map((it, i) => [it, i]))
  const indeg = new Map(order.map(it => [it, 0]))
  for (const [, b] of pairs) indeg.set(b, (indeg.get(b) ?? 0) + 1)
  const out: Item[] = []
  const ready = order.filter(it => indeg.get(it) === 0)
  while (ready.length > 0) {
    ready.sort((a, b) => pos.get(a)! - pos.get(b)!)
    const v = ready.shift()!
    out.push(v)
    for (const [a, b] of pairs) {
      if (a !== v) continue
      indeg.set(b, indeg.get(b)! - 1)
      if (indeg.get(b) === 0) ready.push(b)
    }
  }

  return out.length === order.length ? out : order
}

function sweep(ctx: Ctx, mode: 'L' | 'R' | 'both', reorderToo: boolean) {
  const idx = ctx.columns.map((_, i) => i)
  if (mode === 'R') idx.reverse()
  for (const c of idx) {
    let col = ctx.columns[c]!
    const keyed = col.map(it => {
      const d = desiredOf(ctx, it, mode)
      return { it, d: d ?? it.y, key: (d ?? it.y) + it.h / 2 }
    })
    if (reorderToo) {
      col = reorder(ctx, c, keyed.slice())
      ctx.columns[c] = col
    }
    const dmap = new Map(keyed.map(k => [k.it, k.d]))
    legalize(ctx, col, col.map(it => dmap.get(it)!))
  }
}

function placeAll(ctx: Ctx) {
  for (let c = 0; c < ctx.columns.length; c++) {
    ctx.columns[c] = reorder(
      ctx,
      c,
      ctx.columns[c]!.map((it, i) => ({ it, key: i })),
    )
    stackNaive(ctx, ctx.columns[c]!)
  }
  for (let s = 0; s < 6; s++) sweep(ctx, s % 2 === 0 ? 'L' : 'R', true)
  positionOnly(ctx)
}

function positionOnly(ctx: Ctx) {
  for (const it of ctx.items) it.y = 0
  for (const col of ctx.columns) stackNaive(ctx, col)
  for (const mode of ['L', 'R', 'L', 'both', 'both', 'both'] as const) sweep(ctx, mode, false)
  straighten(ctx)
  dejog(ctx)
}

/** How far an item can move in its column without coming closer to its neighbours than their gap. */
function roomOf(ctx: Ctx, it: Item): [number, number] {
  const col = ctx.columns[it.col]!
  const i = col.indexOf(it)
  const prev = col[i - 1]
  const next = col[i + 1]
  const lo = prev ? prev.y + prev.h + gapBetween(ctx, prev, it) : -Infinity
  const hi = next ? next.y - gapBetween(ctx, it, next) - it.h : Infinity
  return [lo, hi]
}

/**
 * Small steps between a pin and the wire it meets read as mistakes. Move each node, within the room
 * its column leaves, to the height that lines up the most of its connections. Every move strictly
 * adds aligned pairs, so this ends.
 */
function dejog(ctx: Ctx) {
  const aligned = (it: Item, y: number) => {
    let n = 0
    for (const nb of ctx.neighbors.get(it) ?? []) {
      if (Math.abs(y + nb.mine.dy - absY(nb.other)) < 0.5) n++
    }
    return n
  }
  for (let pass = 0; pass < 6; pass++) {
    let moved = false
    for (const it of ctx.items) {
      if (ctx.nudge.has(it)) continue
      const [lo, hi] = roomOf(ctx, it)
      const here = aligned(it, it.y)
      let best = here
      let bestY = it.y
      for (const nb of ctx.neighbors.get(it) ?? []) {
        const y = absY(nb.other) - nb.mine.dy
        if (y < lo - EPS || y > hi + EPS) continue
        const n = aligned(it, y)
        if (n > best || (n === best && n > here && Math.abs(y - it.y) < Math.abs(bestY - it.y))) {
          best = n
          bestY = y
        }
      }
      if (best > here) {
        it.y = bestY
        moved = true
      }
    }
    if (!moved) break
  }
}

/** Long wires: move each net's lanes onto one height wherever their columns leave room, so they don't step. */
function straighten(ctx: Ctx) {
  const chains = new Map<string, Item[]>()
  for (const it of ctx.items) {
    if (it.net === undefined) continue
    const l = chains.get(it.net) ?? []
    l.push(it)
    chains.set(it.net, l)
  }
  const room = (it: Item) => roomOf(ctx, it)
  const sorted = [...chains.entries()].sort((a, b) => b[1].length - a[1].length)
  for (let pass = 0; pass < 2; pass++) {
    for (const [net, chain] of sorted) {
      const cands = new Set<number>()
      for (const a of ctx.byNet.get(net) ?? []) cands.add(absY(a) - DUMMY_H / 2)
      let best = -1
      let bestTop = 0
      for (const top of cands) {
        let n = 0
        for (const d of chain) {
          const [lo, hi] = room(d)
          if (top >= lo && top <= hi) n++
        }
        if (n > best) {
          best = n
          bestTop = top
        }
      }
      for (const d of chain) {
        if (ctx.nudge.has(d)) continue
        const [lo, hi] = room(d)
        if (bestTop >= lo && bestTop <= hi) d.y = bestTop
      }
    }
  }
}

// ---- routing ---------------------------------------------------------------

type ChanNet = { net: string; ls: Access[]; rs: Access[]; ymin: number; ymax: number; straight: boolean; track: number }

function absY(a: Access): number {
  return a.item.y + a.dy
}

function routeChannel(k: number, list: Access[]): { nets: ChanNet[]; tracks: number } {
  const byNet = new Map<string, ChanNet>()
  for (const a of list) {
    let cn = byNet.get(a.net)
    if (cn === undefined) {
      cn = { net: a.net, ls: [], rs: [], ymin: Infinity, ymax: -Infinity, straight: false, track: -1 }
      byNet.set(a.net, cn)
    }
    ;(a.side === 'L' ? cn.ls : cn.rs).push(a)
    cn.ymin = Math.min(cn.ymin, absY(a))
    cn.ymax = Math.max(cn.ymax, absY(a))
  }
  const nets = [...byNet.values()]
  for (const cn of nets) cn.straight = cn.ymax - cn.ymin < EPS
  const trunks = nets.filter(n => !n.straight)
  // Same-height access on opposite sides: the left side's net must take the track further left.
  const pred = new Map<ChanNet, Set<ChanNet>>()
  for (const n of nets) pred.set(n, new Set())
  for (const a of nets) {
    for (const b of nets) {
      if (a === b) continue
      for (const la of a.ls) {
        for (const rb of b.rs) {
          const y = absY(la)
          if (Math.abs(y - absY(rb)) >= MINSEP) continue
          if (a.straight || b.straight) {
            throw new Conflict({ what: `wires ${a.net} and ${b.net} meet head-on in channel ${k}`, nets: [a.net, b.net], y, x: k })
          }
          pred.get(b)!.add(a)
        }
      }
    }
  }
  // Left-to-right order of the trunks: fewest crossings, honouring the head-on constraints.
  const inside = (y: number, n: ChanNet) => y > n.ymin + EPS && y < n.ymax - EPS
  const cost = (a: ChanNet, b: ChanNet) => {
    // a is left of b: b's left-side runs cross a's trunk; a's right-side runs cross b's trunk.
    let c = 0
    for (const p of b.ls) if (inside(absY(p), a)) c++
    for (const p of a.rs) if (inside(absY(p), b)) c++
    return c
  }
  const n = trunks.length
  const C = trunks.map(a => trunks.map(b => (a === b ? 0 : cost(a, b))))
  const must = trunks.map(a => trunks.map(b => pred.get(b)!.has(a)))
  const topo = (prio: number[]): number[] => {
    const out: number[] = []
    const done = new Set<number>()
    while (out.length < n) {
      let pick = -1
      for (const i of prio) {
        if (done.has(i)) continue
        if (trunks.every((_, j) => !must[j]![i] || done.has(j))) {
          pick = i
          break
        }
      }
      if (pick < 0) {
        const stuck = prio.find(i => !done.has(i))!
        const other = trunks.findIndex((_, j) => must[j]![stuck] && !done.has(j))
        throw new Conflict({
          what: `wires ${trunks[stuck]!.net} and ${trunks[other]?.net ?? '?'} cross ends in channel ${k}`,
          nets: [trunks[stuck]!.net, trunks[other]?.net ?? trunks[stuck]!.net],
          y: trunks[stuck]!.ymin,
          x: k,
        })
      }
      out.push(pick)
      done.add(pick)
    }
    return out
  }
  const total = (order: number[]) => {
    let c = 0
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) c += C[order[i]!]![order[j]!]!
    return c
  }
  const idx = trunks.map((_, i) => i)
  const seeds = [
    idx.slice().sort((a, b) => trunks[a]!.ymin - trunks[b]!.ymin),
    idx.slice().sort((a, b) => trunks[b]!.ymax - trunks[a]!.ymax),
    idx.slice().sort((a, b) => C[a]!.reduce((s, v) => s + v, 0) - C[b]!.reduce((s, v) => s + v, 0)),
  ]
  let best = topo(seeds[0]!)
  let bestCost = total(best)
  for (const seed of seeds.slice(1)) {
    const o = topo(seed)
    const c = total(o)
    if (c < bestCost) {
      best = o
      bestCost = c
    }
  }
  // Adjacent swaps while they help.
  for (let pass = 0, improved = true; improved && pass < 60; pass++) {
    improved = false
    for (let i = 0; i + 1 < best.length; i++) {
      const a = best[i]!
      const b = best[i + 1]!
      if (must[a]![b]) continue
      if (C[b]![a]! < C[a]![b]!) {
        best[i] = b
        best[i + 1] = a
        improved = true
      }
    }
  }
  // Pack: a trunk takes the first track right of every earlier trunk it overlaps or must follow.
  let t = 0
  best.forEach((i, pos) => {
    const me = trunks[i]!
    let track = 0
    for (const j of best.slice(0, pos)) {
      const o = trunks[j]!
      const overlaps = me.ymin <= o.ymax + 2 * MINSEP && o.ymin <= me.ymax + 2 * MINSEP
      if (overlaps || must[j]![i]) track = Math.max(track, o.track + 1)
    }
    me.track = track
    t = Math.max(t, track + 1)
  })

  return { nets, tracks: t }
}

type Routed = { segs: Seg[]; colX: number[]; colW: number[]; chanX: Map<number, number>; chanW: Map<number, number> }

function route(ctx: Ctx): Routed {
  const C = ctx.columns.length
  const perChan = new Map<number, Access[]>()
  for (const a of ctx.accesses) {
    const l = perChan.get(a.channel) ?? []
    l.push(a)
    perChan.set(a.channel, l)
  }
  const nets = new Map(ctx.g.nets.map(n => [n.id, n]))
  const routed = new Map<number, { nets: ChanNet[]; tracks: number }>()
  for (const [k, list] of perChan) routed.set(k, routeChannel(k, list))

  // Room for bus-width marks (near the driver) and bit-slice labels (near the reader).
  const pads = new Map<number, { l: number; r: number }>()
  for (const [k, list] of perChan) {
    let l = 16
    let r = 16
    for (const a of list) {
      const net = nets.get(a.net)!
      const isDriver = a.item.node !== undefined && net.driver.node === a.item.node.id && net.driver.pin === a.pin
      if (isDriver && net.width > 1) {
        const need = 24 + textWidth(String(net.width), 9)
        if (a.side === 'L') l = Math.max(l, need)
        else r = Math.max(r, need)
      }
      if (!isDriver && a.item.node !== undefined) {
        const slice = net.sinks.find(s => s.node === a.item.node!.id && s.pin === a.pin)?.slice
        if (slice) {
          const need = textWidth(slice, 9) + 12
          if (a.side === 'R') r = Math.max(r, need)
          else l = Math.max(l, need)
        }
      }
    }
    pads.set(k, { l: Math.round(l * Math.max(1, ctx.spacing * 0.8)), r: Math.round(r * Math.max(1, ctx.spacing * 0.8)) })
  }

  const colW = ctx.columns.map(col => Math.max(20, ...col.map(it => it.w)))
  const chanW = new Map<number, number>()
  for (let k = -1; k < C; k++) {
    const r = routed.get(k)
    const pad = pads.get(k) ?? { l: 16, r: 16 }
    const used = r !== undefined && r.nets.length > 0
    const inner = r !== undefined && r.tracks > 0 ? (r.tracks - 1) * TRACK : 0
    // Air between columns: parts read as separate things, joined by visible wires.
    const min = k === -1 || k === C - 1 ? (used ? 40 : 0) : Math.round(64 * ctx.spacing)
    chanW.set(k, Math.max(min, used ? pad.l + inner + pad.r : 0))
  }
  const colX: number[] = []
  const chanX = new Map<number, number>()
  let x = chanW.get(-1)!
  chanX.set(-1, 0)
  for (let c = 0; c < C; c++) {
    colX.push(x)
    x += colW[c]!
    chanX.set(c, x)
    x += chanW.get(c)!
  }

  const segs: Seg[] = []
  const seg = (x1: number, y1: number, x2: number, y2: number, net: string) => {
    if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) < EPS) return
    segs.push({ x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), net })
  }

  // Inside a column: pin stubs to the column edge, top/bottom pins up/down to their track, dummy lanes.
  const nodeX = (it: Item) => colX[it.col]! + Math.round((colW[it.col]! - it.w) / 2)
  for (const a of ctx.accesses) {
    const it = a.item
    const L = colX[it.col]!
    const R = L + colW[it.col]!
    const y = absY(a)
    if (it.node === undefined) {
      if (a.side === 'L') seg(L, y, R, y, a.net)
      continue
    }
    const sp = it.sym!.pins.get(a.pin!)!
    const px = nodeX(it) + sp.x
    if (sp.side === 'left') seg(L, y, px, y, a.net)
    else if (sp.side === 'right') seg(px, y, R, y, a.net)
    else {
      const py = it.y + it.bodyTop + sp.y
      seg(px, py, px, y, a.net)
      seg(a.side === 'R' ? L : px, y, a.side === 'R' ? px : R, y, a.net)
    }
  }

  // Channels.
  for (const [k, r] of routed) {
    const left = chanX.get(k)!
    const right = left + chanW.get(k)!
    const pad = pads.get(k) ?? { l: 16, r: 16 }
    for (const cn of r.nets) {
      if (cn.straight) {
        seg(left, cn.ymin, right, cn.ymin, cn.net)
        continue
      }
      // Tracks sit in the middle of a channel wider than they need, not hugging the left column.
      const slack = chanW.get(k)! - (pad.l + Math.max(0, r.tracks - 1) * TRACK + pad.r)
      const tx = left + pad.l + Math.max(0, Math.round(slack / 2)) + cn.track * TRACK
      for (const a of cn.ls) seg(left, absY(a), tx, absY(a), cn.net)
      for (const a of cn.rs) seg(tx, absY(a), right, absY(a), cn.net)
      seg(tx, cn.ymin, tx, cn.ymax, cn.net)
    }
  }

  return { segs: mergeSegs(segs), colX, colW, chanX, chanW }
}

function mergeSegs(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  const groups = new Map<string, Seg[]>()
  for (const s of segs) {
    const horiz = Math.abs(s.y1 - s.y2) < EPS
    const key = `${s.net}|${horiz ? 'h' : 'v'}|${horiz ? s.y1 : s.x1}`
    const l = groups.get(key) ?? []
    l.push(s)
    groups.set(key, l)
  }
  for (const [key, list] of groups) {
    const horiz = key.split('|')[1] === 'h'
    const lo = (s: Seg) => (horiz ? s.x1 : s.y1)
    const hi = (s: Seg) => (horiz ? s.x2 : s.y2)
    list.sort((a, b) => lo(a) - lo(b))
    let cur = { ...list[0]! }
    for (const s of list.slice(1)) {
      if (lo(s) <= hi(cur) + EPS) {
        if (horiz) cur.x2 = Math.max(cur.x2, s.x2)
        else cur.y2 = Math.max(cur.y2, s.y2)
      } else {
        out.push(cur)
        cur = { ...s }
      }
    }
    out.push(cur)
  }

  return out
}

function junctions(segs: Seg[]): { x: number; y: number; net: string }[] {
  const byNet = new Map<string, Seg[]>()
  for (const s of segs) {
    const l = byNet.get(s.net) ?? []
    l.push(s)
    byNet.set(s.net, l)
  }
  const dots: { x: number; y: number; net: string }[] = []
  for (const [net, list] of byNet) {
    const pts = new Map<string, { x: number; y: number }>()
    for (const s of list) {
      pts.set(`${s.x1},${s.y1}`, { x: s.x1, y: s.y1 })
      pts.set(`${s.x2},${s.y2}`, { x: s.x2, y: s.y2 })
    }
    for (const p of pts.values()) {
      let degree = 0
      for (const s of list) {
        const isEnd = (Math.abs(s.x1 - p.x) < EPS && Math.abs(s.y1 - p.y) < EPS) || (Math.abs(s.x2 - p.x) < EPS && Math.abs(s.y2 - p.y) < EPS)
        if (isEnd) degree += 1
        else if (onSeg(p.x, p.y, s, EPS)) degree += 2
      }
      if (degree >= 3) dots.push({ ...p, net })
    }
  }

  return dots
}

function onSeg(x: number, y: number, s: Seg, eps: number): boolean {
  return x >= s.x1 - eps && x <= s.x2 + eps && y >= s.y1 - eps && y <= s.y2 + eps
}

// ---- verification ------------------------------------------------------------

function boxesOf(ctx: Ctx, r: Routed): { item: Item; box: Box; nets: Set<string> }[] {
  const out: { item: Item; box: Box; nets: Set<string> }[] = []
  const netsOf = new Map<Item, Set<string>>()
  for (const a of ctx.accesses) {
    const s = netsOf.get(a.item) ?? new Set()
    s.add(a.net)
    netsOf.set(a.item, s)
  }
  for (const it of ctx.items) {
    if (it.node === undefined) continue
    const x = r.colX[it.col]! + Math.round((r.colW[it.col]! - it.w) / 2)
    out.push({ item: it, box: { x, y: it.y + it.bodyTop, w: it.w, h: it.sym!.h }, nets: netsOf.get(it) ?? new Set() })
  }

  return out
}

export function verify(
  boxes: { box: Box; nets: Set<string>; name: string }[],
  segs: Seg[],
  labels: { box: Box; net?: string }[] = [],
): { violations: Violation[]; crossings: number } {
  const violations: Violation[] = []
  const overlap = (a: Box, b: Box, m: number) =>
    a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlap(boxes[i]!.box, boxes[j]!.box, 1)) {
        violations.push({ what: `${boxes[i]!.name} overlaps ${boxes[j]!.name}`, nets: [], y: boxes[j]!.box.y, x: boxes[j]!.box.x })
      }
    }
  }
  for (const s of segs) {
    for (const b of boxes) {
      const own = b.nets.has(s.net)
      const m = own ? -0.5 : 2
      const bx = { x: b.box.x - m, y: b.box.y - m, w: b.box.w + 2 * m, h: b.box.h + 2 * m }
      const hits = s.x1 < bx.x + bx.w && s.x2 > bx.x && s.y1 < bx.y + bx.h && s.y2 > bx.y
      if (hits) violations.push({ what: `wire ${s.net} runs through ${b.name}`, nets: [s.net], y: s.y1, x: s.x1 })
    }
  }
  let crossings = 0
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]!
    const ah = Math.abs(a.y1 - a.y2) < EPS
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j]!
      if (a.net === b.net) continue
      const bh = Math.abs(b.y1 - b.y2) < EPS
      if (ah === bh) {
        // Parallel: too close and overlapping along their length.
        const near = ah ? Math.abs(a.y1 - b.y1) < MINSEP : Math.abs(a.x1 - b.x1) < MINSEP
        const lapLo = ah ? Math.max(a.x1, b.x1) : Math.max(a.y1, b.y1)
        const lapHi = ah ? Math.min(a.x2, b.x2) : Math.min(a.y2, b.y2)
        if (near && lapLo < lapHi + MINSEP) {
          violations.push({ what: `wires ${a.net} and ${b.net} run on top of each other`, nets: [a.net, b.net], y: ah ? a.y1 : lapLo, x: ah ? lapLo : a.x1 })
        }
        continue
      }
      const h = ah ? a : b
      const v = ah ? b : a
      const inX = v.x1 >= h.x1 - MINSEP + 1 && v.x1 <= h.x2 + MINSEP - 1
      const inY = h.y1 >= v.y1 - MINSEP + 1 && h.y1 <= v.y2 + MINSEP - 1
      if (!inX || !inY) continue
      const strictX = v.x1 > h.x1 + MINSEP - 1 && v.x1 < h.x2 - MINSEP + 1
      const strictY = h.y1 > v.y1 + MINSEP - 1 && h.y1 < v.y2 - MINSEP + 1
      if (strictX && strictY) crossings++
      else violations.push({ what: `wires ${a.net} and ${b.net} touch`, nets: [a.net, b.net], y: h.y1, x: v.x1 })
    }
  }
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!
    for (const b of boxes) {
      if (overlap(l.box, b.box, 1)) violations.push({ what: `a label overlaps ${b.name}`, nets: [], y: l.box.y, x: l.box.x })
    }
    for (let j = i + 1; j < labels.length; j++) {
      if (overlap(l.box, labels[j]!.box, 1)) violations.push({ what: 'two labels overlap', nets: [], y: l.box.y, x: l.box.x })
    }
  }

  return { violations, crossings }
}

// ---- labels ----------------------------------------------------------------

function segHitsBox(s: Seg, b: Box): boolean {
  return s.x1 < b.x + b.w && s.x2 > b.x && s.y1 < b.y + b.h && s.y2 > b.y
}

function placeLabels(
  ctx: Ctx,
  r: Routed,
  boxes: { box: Box }[],
): { marks: Mark[]; labels: TextLabel[] } {
  const marks: Mark[] = []
  const labels: TextLabel[] = []
  const taken: Box[] = []
  const free = (b: Box, host: Seg) => {
    for (const x of boxes) if (b.x < x.box.x + x.box.w + 2 && x.box.x < b.x + b.w + 2 && b.y < x.box.y + x.box.h + 2 && x.box.y < b.y + b.h + 2) return false
    for (const t of taken) if (b.x < t.x + t.w + 2 && t.x < b.x + b.w + 2 && b.y < t.y + t.h + 2 && t.y < b.y + b.h + 2) return false
    for (const s of r.segs) if (s !== host && segHitsBox(s, b)) return false
    return true
  }
  const horizontals = (net: string) => r.segs.filter(s => s.net === net && Math.abs(s.y1 - s.y2) < EPS)

  // Slice labels have one natural spot each, so they go first; width marks can slide.
  for (const pass of ['slice', 'width'] as const)
  for (const net of ctx.g.nets) {
    if (net.sinks.length === 0) continue
    const hs = horizontals(net.id)
    // Bus width: a slash with the width, nearest the driver first.
    if (pass === 'width' && net.width > 1) {
      const text = String(net.width)
      const tw = textWidth(text, 9)
      const drv = ctx.accesses.find(a => a.net === net.id && a.item.node?.id === net.driver.node && a.pin === net.driver.pin)
      const dy = drv ? absY(drv) : 0
      const sorted = hs.slice().sort((a, b) => Math.abs(a.y1 - dy) - Math.abs(b.y1 - dy) || b.x2 - b.x1 - (a.x2 - a.x1))
      let placed = false
      for (const s of sorted) {
        for (let x = s.x1 + 8; x + tw + 6 <= s.x2 - 6 && !placed; x += 6) {
          const box = { x: x - 5, y: s.y1 - 15, w: tw + 11, h: 20 }
          if (free(box, s)) {
            marks.push({ x, y: s.y1, text, net: net.id, box })
            taken.push(box)
            placed = true
          }
        }
        if (placed) break
      }
      if (!placed) ctx.warnings.push(`no room for the width mark on ${net.id}; left off`)
    }
    // Bit slices: next to the reading pin.
    for (const sink of net.sinks) {
      if (pass !== 'slice' || !sink.slice) continue
      const acc = ctx.accesses.find(a => a.net === net.id && a.item.node?.id === sink.node && a.pin === sink.pin)
      if (acc === undefined) continue
      const tw = textWidth(sink.slice, 9)
      const y = absY(acc)
      const host = hs.find(s => Math.abs(s.y1 - y) < EPS && (acc.side === 'R' ? s.x2 >= r.chanX.get(acc.channel)! + r.chanW.get(acc.channel)! - EPS : s.x1 <= r.chanX.get(acc.channel)! + EPS))
      let placed = false
      if (host) {
        const right = acc.side === 'R'
        for (let k = 0; k < 12 && !placed; k++) {
          for (const below of [false, true]) {
            const xEnd = right ? host.x2 - 4 - k * 6 : host.x1 + 4 + tw + k * 6
            if (xEnd - tw < host.x1 + 2 || xEnd > host.x2 - 2) continue
            const box = { x: xEnd - tw - 1, y: below ? y + 3 : y - 12, w: tw + 2, h: 10 }
            if (free(box, host)) {
              labels.push({ x: xEnd, y: below ? y + 11 : y - 3.5, text: sink.slice, anchor: 'end', net: net.id, box })
              taken.push(box)
              placed = true
              break
            }
          }
        }
      }
      if (!placed) ctx.warnings.push(`no room for the slice label ${sink.slice} at ${sink.node}.${sink.pin}; left off`)
    }
  }

  return { marks, labels }
}

// ---- driver ------------------------------------------------------------------

export function layout(g: Graph, warnings: string[], newest: number): Geometry {
  let spacing = g.spacing
  let lastProblem = ''
  for (let round = 0; round < 3; round++) {
    const local: string[] = []
    const ctx = build(g, spacing, local, newest)
    placeAll(ctx)
    for (let attempt = 0; attempt < 24; attempt++) {
      let violations: Violation[]
      let r: Routed | undefined
      try {
        r = route(ctx)
        const boxes = boxesOf(ctx, r)
        violations = verify(
          boxes.map(b => ({ box: b.box, nets: b.nets, name: b.item.id })),
          r.segs,
        ).violations
      } catch (err) {
        if (!(err instanceof Conflict)) throw err
        violations = [err.v]
      }
      if (violations.length === 0 && r !== undefined) {
        const boxes = boxesOf(ctx, r)
        const { marks, labels } = placeLabels(ctx, r, boxes)
        const final = verify(
          boxes.map(b => ({ box: b.box, nets: b.nets, name: b.item.id })),
          r.segs,
          [...marks, ...labels],
        )
        if (final.violations.length > 0) {
          lastProblem = final.violations[0]!.what
          break
        }
        warnings.push(...local)
        return finish(ctx, r, boxes, marks, labels, final.crossings)
      }
      const v = violations[0]!
      lastProblem = v.what
      nudgeFor(ctx, v, attempt)
      positionOnly(ctx)
    }
    spacing *= 1.5
  }
  throw new LogicError(`could not lay this out without overlaps (${lastProblem}). Try a place/order directive or spacing 2`)
}

function nudgeFor(ctx: Ctx, v: Violation, attempt: number) {
  const cands = ctx.accesses.filter(a => v.nets.includes(a.net))
  let best: Access | undefined
  let bestD = Infinity
  for (const a of cands) {
    const d = Math.abs(absY(a) - v.y) + (a.item.node === undefined ? 0 : 1)
    if (d < bestD) {
      bestD = d
      best = a
    }
  }
  const target = best?.item ?? ctx.items.find(it => v.what.includes(it.id)) ?? ctx.items[attempt % ctx.items.length]!
  // Try either side of where it was, further each time: +10, -10, +20, -20, ...
  ctx.nudge.set(target, (attempt % 2 === 0 ? 1 : -1) * (P / 2) * (1 + Math.floor(attempt / 2)))
}

function finish(ctx: Ctx, r: Routed, boxes: { item: Item; box: Box }[], marks: Mark[], labels: TextLabel[], crossings: number): Geometry {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (b: Box) => {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  for (const b of boxes) grow(b.box)
  for (const s of r.segs) grow({ x: s.x1, y: s.y1, w: s.x2 - s.x1, h: s.y2 - s.y1 })
  for (const m of marks) grow(m.box)
  for (const l of labels) grow(l.box)
  if (minX === Infinity) {
    minX = minY = 0
    maxX = maxY = 10
  }
  const columns = ctx.columns.map(col =>
    col
      .filter(it => it.node !== undefined)
      .map(it => (it.node!.kind === 'output' ? `>${it.node!.label}` : it.node!.kind === 'const' ? it.node!.label : it.id)),
  )

  return {
    nodes: boxes.map(b => ({ node: b.item.node!, sym: b.item.sym!, x: b.box.x, y: b.box.y })),
    segs: r.segs,
    dots: junctions(r.segs),
    marks,
    labels,
    nets: new Map(ctx.g.nets.map(n => [n.id, n])),
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    columns,
    crossings,
  }
}

/** Re-checks a finished geometry from scratch: what the tests use to hold the no-overlap promise. */
export function checkGeometry(geo: Geometry): Violation[] {
  const netsOf = new Map<string, Set<string>>()
  for (const net of geo.nets.values()) {
    if (net.sinks.length === 0) continue
    for (const id of [net.driver.node, ...net.sinks.map(s => s.node)]) {
      const set = netsOf.get(id) ?? new Set()
      set.add(net.id)
      netsOf.set(id, set)
    }
  }
  const boxes = geo.nodes.map(n => ({
    box: { x: n.x, y: n.y, w: n.sym.w, h: n.sym.h },
    nets: netsOf.get(n.node.id) ?? new Set<string>(),
    name: n.node.id,
  }))
  const v = verify(boxes, geo.segs, [...geo.marks, ...geo.labels]).violations
  // Labels must also stay clear of every wire but the one they annotate.
  for (const l of [...geo.marks, ...geo.labels]) {
    const hits = geo.segs.filter(s => segHitsBox(s, l.box))
    const foreign = hits.filter(s => s.net !== l.net)
    if (foreign.length > 0) v.push({ what: `label '${l.text}' sits on wire ${foreign[0]!.net}`, nets: [foreign[0]!.net], x: l.box.x, y: l.box.y })
  }
  return v
}
