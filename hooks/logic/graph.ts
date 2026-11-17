// Program → Graph: every gate, block and port as a node with concrete pins, every driver as a net.

import { LogicError, closest, where } from './model.js'
import type { BlockDef, BlockShape, Directive, PinDecl, Program, Ref } from './model.js'

export type GPin = PinDecl & { invert: boolean }

export type NodeKind = 'input' | 'output' | 'const' | 'gate' | 'block'

export type GNode = {
  id: string
  name: string
  kind: NodeKind
  /** Gate type (`and`, …) or built-in/user block type. */
  type: string
  shape: 'gate' | 'port' | BlockShape | 'mux'
  label: string
  pins: GPin[]
  line: number
  chunk: number
  seq: number
}

export type Sink = { node: string; pin: string; slice?: string }

export type Net = {
  id: string
  driver: { node: string; pin: string }
  sinks: Sink[]
  width: number
  ctrl: boolean
}

export type Graph = {
  nodes: GNode[]
  byId: Map<string, GNode>
  nets: Net[]
  directives: Directive[]
  spacing: number
  showNames: boolean
  title?: string
}

export const GATES = new Set(['and', 'or', 'nand', 'nor', 'xor', 'xnor', 'not', 'buf', 'inv'])

const pin = (name: string, side: PinDecl['side'], dir: PinDecl['dir'], extra: Partial<PinDecl> = {}): PinDecl => ({
  name,
  side,
  dir,
  width: 1,
  ctrl: false,
  clock: false,
  ...extra,
})

const BUILTINS: Record<string, { shape: BlockShape; label: (name: string) => string; pins: PinDecl[] }> = {
  alu: {
    shape: 'alu',
    label: () => 'ALU',
    pins: [
      pin('A', 'left', 'in'),
      pin('B', 'left', 'in'),
      pin('op', 'bottom', 'in', { ctrl: true, optional: true }),
      pin('Zero', 'right', 'out', { optional: true }),
      pin('Result', 'right', 'out'),
    ],
  },
  adder: {
    shape: 'adder',
    label: () => 'Add',
    pins: [pin('A', 'left', 'in'), pin('B', 'left', 'in'), pin('Sum', 'right', 'out')],
  },
  dff: {
    shape: 'rect',
    label: () => '',
    pins: [
      pin('D', 'left', 'in'),
      pin('CLK', 'left', 'in', { clock: true, label: '' }),
      pin('Q', 'right', 'out'),
      pin('Qn', 'right', 'out', { optional: true, label: "Q'" }),
    ],
  },
  tff: {
    shape: 'rect',
    label: () => '',
    pins: [
      pin('T', 'left', 'in'),
      pin('CLK', 'left', 'in', { clock: true, label: '' }),
      pin('Q', 'right', 'out'),
      pin('Qn', 'right', 'out', { optional: true, label: "Q'" }),
    ],
  },
  jkff: {
    shape: 'rect',
    label: () => '',
    pins: [
      pin('J', 'left', 'in'),
      pin('CLK', 'left', 'in', { clock: true, label: '' }),
      pin('K', 'left', 'in'),
      pin('Q', 'right', 'out'),
      pin('Qn', 'right', 'out', { optional: true, label: "Q'" }),
    ],
  },
  srlatch: {
    shape: 'rect',
    label: () => '',
    pins: [
      pin('S', 'left', 'in'),
      pin('R', 'left', 'in'),
      pin('Q', 'right', 'out'),
      pin('Qn', 'right', 'out', { optional: true, label: "Q'" }),
    ],
  },
  reg: {
    shape: 'rect',
    label: name => name,
    pins: [
      pin('D', 'left', 'in'),
      pin('CLK', 'left', 'in', { clock: true, optional: true, label: '' }),
      pin('EN', 'top', 'in', { ctrl: true, optional: true }),
      pin('Q', 'right', 'out'),
    ],
  },
}
BUILTINS.add = BUILTINS.adder!

/** Built-ins that are storage, not datapath blocks. */
const STORAGE = new Set(['dff', 'tff', 'jkff', 'srlatch', 'reg'])

/** Output pins whose width follows the widest data input of the same node. */
const PASS_WIDTH: Record<string, [string, string[]]> = {
  alu: ['Result', ['A', 'B']],
  adder: ['Sum', ['A', 'B']],
  add: ['Sum', ['A', 'B']],
  reg: ['Q', ['D']],
}

type Request = { node: string; pin: string; ref: Ref; line: number; chunk: number }

export function resolve(program: Program, library: Map<string, BlockDef>, newest: number): Graph {
  const nodes: GNode[] = []
  const byId = new Map<string, GNode>()
  const at = (line: number, chunk: number) => where(line, chunk, newest)
  const add = (n: Omit<GNode, 'seq'>) => {
    const node = { ...n, seq: nodes.length }
    nodes.push(node)
    byId.set(node.id, node)
    return node
  }
  const requests: Request[] = []
  const blocks = new Map([...library, ...program.blocks])

  for (const i of program.inputs) {
    add({
      id: i.name,
      name: i.name,
      kind: 'input',
      type: 'input',
      shape: 'port',
      label: i.name,
      pins: [{ ...pin('out', 'right', 'out'), width: i.width, invert: false }],
      line: i.line,
      chunk: i.chunk,
    })
  }

  for (const inst of program.instances) {
    const where_ = at(inst.line, inst.chunk)
    const type = inst.type === 'inv' ? 'not' : inst.type
    if (GATES.has(type)) {
      if (inst.args.some(a => a.pin !== undefined)) throw new LogicError(`${where_}: gate inputs are positional: ${type}(A, B)`)
      const n = inst.args.length
      const one = type === 'not' || type === 'buf'
      if (one ? n !== 1 : n < 2 || n > 8) {
        throw new LogicError(`${where_}: ${type} takes ${one ? 'exactly 1 input' : '2 to 8 inputs'}, got ${n}`)
      }
      const pins: GPin[] = inst.args.map((a, k) => ({ ...pin(`in${k + 1}`, 'left', 'in'), invert: a.ref.invert }))
      pins.push({ ...pin('out', 'right', 'out'), invert: false })
      add({ id: inst.name, name: inst.name, kind: 'gate', type, shape: 'gate', label: inst.label ?? inst.name, pins, line: inst.line, chunk: inst.chunk })
      inst.args.forEach((a, k) => requests.push({ node: inst.name, pin: `in${k + 1}`, ref: { ...a.ref, invert: false }, line: inst.line, chunk: inst.chunk }))
      continue
    }

    if (type === 'mux') {
      const data = inst.args.filter(a => a.pin === undefined)
      const named = inst.args.filter(a => a.pin !== undefined)
      if (data.length < 2 || data.length > 8) throw new LogicError(`${where_}: mux takes 2 to 8 data inputs, got ${data.length}`)
      // Select codes in binary, as wide as the select: 0 1 for a 2:1 mux, 00 01 10 11 for a 4:1.
      const bits = Math.max(1, Math.ceil(Math.log2(data.length)))
      const code = (k: number) => (bits === 1 ? String(k) : k.toString(2).padStart(bits, '0'))
      const pins: GPin[] = data.map((a, k) => ({ ...pin(`in${k}`, 'left', 'in', { label: code(k) }), invert: a.ref.invert }))
      let hasSel = false
      for (const a of named) {
        if (!/^(s|sel|S|Sel|SEL)$/.test(a.pin!)) throw new LogicError(`${where_}: mux has data inputs (positional) and S=select, not '${a.pin}'`)
        hasSel = true
      }
      if (hasSel) pins.push({ ...pin('S', 'bottom', 'in', { ctrl: true }), invert: false })
      pins.push({ ...pin('out', 'right', 'out'), invert: false })
      add({ id: inst.name, name: inst.name, kind: 'block', type: 'mux', shape: 'mux', label: inst.label ?? '', pins, line: inst.line, chunk: inst.chunk })
      data.forEach((a, k) => requests.push({ node: inst.name, pin: `in${k}`, ref: a.ref, line: inst.line, chunk: inst.chunk }))
      for (const a of named) requests.push({ node: inst.name, pin: 'S', ref: a.ref, line: inst.line, chunk: inst.chunk })
      continue
    }

    let def: { shape: BlockShape; label: string; pins: PinDecl[] }
    if (inst.block !== undefined) def = inst.block
    else if (BUILTINS[type] !== undefined) def = { ...BUILTINS[type]!, label: BUILTINS[type]!.label(inst.name) }
    else if (blocks.has(inst.type)) def = blocks.get(inst.type)!
    else {
      const all = [...GATES, 'mux', 'box', ...Object.keys(BUILTINS), ...blocks.keys()]
      const guess = closest(inst.type, all)
      throw new LogicError(
        `${where_}: unknown type '${inst.type}'${guess ? ` (did you mean '${guess}'?)` : ''}. Gates: and or nand nor xor xnor not buf; blocks: mux alu adder dff jkff tff srlatch reg box, or define one with block Name { left: …; right: … }`,
      )
    }
    const pins: GPin[] = def.pins.map(p => ({ ...p, conn: undefined, invert: false }))
    const assigned = new Set<string>()
    const connect = (pinName: string, ref: Ref) => {
      const p = pins.find(x => x.name === pinName) ?? pins.find(x => x.name.toLowerCase() === pinName.toLowerCase())
      if (p === undefined) {
        const ins = pins.filter(x => x.dir === 'in').map(x => x.name)
        throw new LogicError(`${where_}: ${inst.name} has no input pin '${pinName}' (inputs: ${ins.join(' ') || 'none'})`)
      }
      if (p.dir === 'out') throw new LogicError(`${where_}: ${inst.name}.${p.name} is an output; it can't be driven`)
      if (assigned.has(p.name)) throw new LogicError(`${where_}: ${inst.name}.${p.name} is connected twice`)
      assigned.add(p.name)
      if (ref.invert) p.invert = true
      requests.push({ node: inst.name, pin: p.name, ref: { ...ref, invert: false }, line: inst.line, chunk: inst.chunk })
    }
    for (const p of def.pins) if (p.conn !== undefined) connect(p.name, p.conn)
    for (const a of inst.args) if (a.pin !== undefined) connect(a.pin, a.ref)
    for (const a of inst.args) {
      if (a.pin !== undefined) continue
      const free = pins.find(p => p.dir === 'in' && !assigned.has(p.name))
      if (free === undefined) throw new LogicError(`${where_}: too many inputs for ${inst.name}`)
      connect(free.name, a.ref)
    }
    add({
      id: inst.name,
      name: inst.name,
      kind: 'block',
      type,
      shape: def.shape,
      label: inst.label ?? def.label,
      pins,
      line: inst.line,
      chunk: inst.chunk,
    })
  }

  for (const a of program.assigns) {
    const node = byId.get(a.node)
    const w = at(a.line, a.chunk)
    if (node === undefined || node.kind === 'input') {
      const guess = closest(a.node, nodes.filter(n => n.kind !== 'input').map(n => n.name))
      throw new LogicError(`${w}: no gate or block named '${a.node}'${guess ? ` (did you mean '${guess}'?)` : ''}`)
    }
    const p = node.pins.find(x => x.name === a.pin) ?? node.pins.find(x => x.name.toLowerCase() === a.pin.toLowerCase())
    if (p === undefined || p.dir !== 'in') {
      const ins = node.pins.filter(x => x.dir === 'in').map(x => x.name)
      throw new LogicError(`${w}: ${a.node} has no input pin '${a.pin}' (inputs: ${ins.join(' ') || 'none'})`)
    }
    if (a.ref.invert) p.invert = true
    requests.push({ node: a.node, pin: p.name, ref: { ...a.ref, invert: false }, line: a.line, chunk: a.chunk })
  }

  program.outputs.forEach((o, k) => {
    const id = `>${o.label ?? o.ref.text}`
    if (byId.has(id)) throw new LogicError(`${at(o.line, o.chunk)}: output '${o.label ?? o.ref.text}' is listed twice`)
    add({
      id,
      name: id,
      kind: 'output',
      type: 'output',
      shape: 'port',
      label: o.label ?? o.ref.text,
      pins: [{ ...pin('in', 'left', 'in'), invert: o.ref.invert }],
      line: o.line,
      chunk: o.chunk,
    })
    requests.push({ node: id, pin: 'in', ref: { ...o.ref, invert: false }, line: o.line, chunk: o.chunk })
    void k
  })

  // Resolve every request to its driver.
  const nets = new Map<string, Net>()
  const drivenPins = new Map<string, Request>()
  let constCount = 0
  for (const r of requests) {
    const key = `${r.node}.${r.pin}`
    const prev = drivenPins.get(key)
    if (prev !== undefined && prev !== r) {
      throw new LogicError(`${at(r.line, r.chunk)}: ${key} already has a driver (${at(prev.line, prev.chunk)})`)
    }
    drivenPins.set(key, r)
    let driver: { node: string; pin: string }
    const ref = r.ref
    if (ref.kind === 'const') {
      const id = `#${constCount++}`
      add({
        id,
        name: id,
        kind: 'const',
        type: 'const',
        shape: 'port',
        label: ref.value,
        pins: [{ ...pin('out', 'right', 'out'), invert: false }],
        line: r.line,
        chunk: r.chunk,
      })
      driver = { node: id, pin: 'out' }
    } else {
      const src = byId.get(ref.node)
      if (src === undefined || src.kind === 'output' || src.kind === 'const') {
        const guess = closest(
          ref.node,
          nodes.filter(n => n.kind === 'input' || n.kind === 'gate' || n.kind === 'block').map(n => n.name),
        )
        throw new LogicError(`${at(ref.line, ref.chunk)}: unknown net '${ref.node}'${guess ? ` (did you mean '${guess}'?)` : ''}`)
      }
      const outs = src.pins.filter(p => p.dir === 'out')
      let p: GPin | undefined
      if (ref.pin === undefined) {
        p = outs.find(x => !x.optional) ?? outs[0]
      } else {
        p = src.pins.find(x => x.name === ref.pin) ?? src.pins.find(x => x.name.toLowerCase() === ref.pin!.toLowerCase())
        if (p === undefined || p.dir !== 'out') {
          throw new LogicError(
            `${at(ref.line, ref.chunk)}: ${src.name} has no output '${ref.pin}' (outputs: ${outs.map(x => x.name).join(' ') || 'none'})`,
          )
        }
      }
      if (p === undefined) throw new LogicError(`${at(ref.line, ref.chunk)}: ${src.name} has no outputs`)
      driver = { node: src.id, pin: p.name }
    }
    const netId = `${driver.node}.${driver.pin}`
    let net = nets.get(netId)
    if (net === undefined) {
      net = { id: netId, driver, sinks: [], width: 1, ctrl: false }
      nets.set(netId, net)
    }
    net.sinks.push({ node: r.node, pin: r.pin, slice: ref.kind === 'net' ? ref.slice : undefined })
  }

  // Optional pins appear only when used.
  for (const node of nodes) {
    node.pins = node.pins.filter(p => {
      if (!p.optional) return true
      return p.dir === 'in' ? drivenPins.has(`${node.id}.${p.name}`) : nets.has(`${node.id}.${p.name}`)
    })
  }

  // Bus widths: the driver's, carried through muxes, ALUs, adders and registers.
  const pinOf = (node: string, name: string) => byId.get(node)?.pins.find(p => p.name === name)
  const netInto = new Map<string, Net>()
  for (const net of nets.values()) for (const s of net.sinks) netInto.set(`${s.node}.${s.pin}`, net)
  for (const net of nets.values()) net.width = pinOf(net.driver.node, net.driver.pin)?.width ?? 1
  for (let pass = 0; pass < 4; pass++) {
    for (const node of nodes) {
      const rule = node.type === 'mux' ? (['out', node.pins.filter(p => p.name.startsWith('in')).map(p => p.name)] as const) : PASS_WIDTH[node.type]
      if (rule === undefined) continue
      const out = nets.get(`${node.id}.${rule[0]}`)
      if (out === undefined || (pinOf(node.id, rule[0])?.width ?? 1) > 1) continue
      let w = 1
      for (const name of rule[1]) w = Math.max(w, netInto.get(`${node.id}.${name}`)?.width ?? 1)
      out.width = w
    }
  }

  for (const net of nets.values()) {
    const dp = pinOf(net.driver.node, net.driver.pin)
    net.ctrl = (dp?.ctrl ?? false) || (net.sinks.length > 0 && net.sinks.every(s => pinOf(s.node, s.pin)?.ctrl === true))
  }

  // Blue control wires are a datapath convention; in a gate-level figure a select or enable is just a wire.
  const datapath = nodes.some(n => n.shape === 'alu' || n.shape === 'adder' || (n.shape === 'rect' && !STORAGE.has(n.type)))
  if (!datapath) {
    for (const net of nets.values()) net.ctrl = false
    for (const n of nodes) for (const p of n.pins) p.ctrl = false
  }

  return {
    nodes,
    byId,
    nets: [...nets.values()],
    directives: program.directives,
    spacing: program.spacing ?? 1,
    showNames: program.showNames ?? false,
    title: program.title,
  }
}
