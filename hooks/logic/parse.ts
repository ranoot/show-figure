// Source text → Program. Each statement is one line; newlines inside (), {} and [] don't end it.

import { LogicError } from './model.js'
import type { Arg, BlockDef, BlockShape, Directive, Dir, Instance, PinDecl, Program, Ref, Side } from './model.js'

type Tok = { t: 'id' | 'num' | 'str' | 'p'; v: string; line: number; pos: number; end: number }

const SIDES = new Set(['left', 'right', 'top', 'bottom'])

function tokenize(src: string): (Tok | { t: 'nl'; line: number })[] {
  const out: (Tok | { t: 'nl'; line: number })[] = []
  let i = 0
  let line = 1
  while (i < src.length) {
    const c = src[i]!
    if (c === '\n') {
      out.push({ t: 'nl', line })
      line++
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '"') {
      const start = i
      let j = i + 1
      let text = ''
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\' && src[j + 1] === 'n') {
          text += '\n'
          j += 2
        } else if (src[j] === '\\' && src[j + 1] === '"') {
          text += '"'
          j += 2
        } else {
          text += src[j]
          j++
        }
      }
      if (src[j] !== '"') throw new LogicError(`line ${line}: unclosed string`)
      out.push({ t: 'str', v: text, line, pos: start, end: j + 1 })
      i = j + 1
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i
      while (i < src.length && /[A-Za-z0-9_']/.test(src[i]!)) i++
      out.push({ t: 'id', v: src.slice(start, i), line, pos: start, end: i })
    } else if (/[0-9]/.test(c)) {
      const start = i
      while (i < src.length && /[A-Za-z0-9_']/.test(src[i]!)) i++
      out.push({ t: 'num', v: src.slice(start, i), line, pos: start, end: i })
    } else if (c === '-' && src[i + 1] === '>') {
      out.push({ t: 'p', v: '->', line, pos: i, end: i + 2 })
      i += 2
    } else if ('=(){}[],;:.!@~^->'.includes(c)) {
      out.push({ t: 'p', v: c, line, pos: i, end: i + 1 })
      i++
    } else {
      throw new LogicError(`line ${line}: unexpected character '${c}'`)
    }
  }

  return out
}

/** Splits tokens into statements: a newline or `;` at depth 0 ends one; inside {} a newline acts as `;`. */
function statements(src: string): Tok[][] {
  const toks = tokenize(src)
  const out: Tok[][] = []
  let cur: Tok[] = []
  const stack: string[] = []
  for (const tok of toks) {
    if (tok.t === 'nl') {
      if (stack.length === 0) {
        if (cur.length > 0) out.push(cur)
        cur = []
      } else if (stack[stack.length - 1] === '{') {
        cur.push({ t: 'p', v: ';', line: tok.line, pos: -1, end: -1 })
      }
      continue
    }
    if (tok.t === 'p') {
      if (tok.v === '(' || tok.v === '{' || tok.v === '[') stack.push(tok.v)
      else if (tok.v === ')' || tok.v === '}' || tok.v === ']') {
        const open = stack.pop()
        const want = tok.v === ')' ? '(' : tok.v === '}' ? '{' : '['
        if (open !== want) throw new LogicError(`line ${tok.line}: unmatched '${tok.v}'`)
      } else if (tok.v === ';' && stack.length === 0) {
        if (cur.length > 0) out.push(cur)
        cur = []
        continue
      }
    }
    cur.push(tok)
  }
  if (stack.length > 0) {
    const last = cur[cur.length - 1] ?? out[out.length - 1]?.[0]
    throw new LogicError(`line ${last?.line ?? 1}: unclosed '${stack[stack.length - 1]}'`)
  }
  if (cur.length > 0) out.push(cur)

  return out
}

class Cursor {
  i = 0
  toks: Tok[]
  chunk: number
  src: string
  constructor(toks: Tok[], chunk: number, src: string) {
    this.toks = toks
    this.chunk = chunk
    this.src = src
  }
  get line(): number {
    return (this.toks[Math.min(this.i, this.toks.length - 1)] ?? this.toks[0])?.line ?? 1
  }
  peek(k = 0): Tok | undefined {
    return this.toks[this.i + k]
  }
  is(v: string, k = 0): boolean {
    const t = this.peek(k)
    return t !== undefined && (t.t === 'p' || t.t === 'id') && t.v === v
  }
  done(): boolean {
    return this.i >= this.toks.length
  }
  next(): Tok {
    const t = this.toks[this.i]
    if (t === undefined) throw this.fail('unexpected end of line')
    this.i++
    return t
  }
  eat(v: string): boolean {
    if (this.is(v)) {
      this.i++
      return true
    }
    return false
  }
  expect(v: string, what?: string): Tok {
    if (!this.is(v)) {
      const t = this.peek()
      throw this.fail(`expected ${what ?? `'${v}'`}${t ? `, found '${t.v}'` : ' at end of line'}`)
    }
    return this.next()
  }
  ident(what = 'a name'): string {
    const t = this.peek()
    if (t?.t !== 'id') throw this.fail(`expected ${what}${t ? `, found '${t.v}'` : ' at end of line'}`)
    this.i++
    return t.v
  }
  num(what = 'a number'): number {
    const t = this.peek()
    if (t?.t !== 'num' || !/^[0-9]+$/.test(t.v)) throw this.fail(`expected ${what}${t ? `, found '${t.v}'` : ''}`)
    this.i++
    return Number(t.v)
  }
  fail(msg: string): LogicError {
    return new LogicError(`line ${this.line}: ${msg}`)
  }
  end(): void {
    if (!this.done()) throw this.fail(`unexpected '${this.peek()!.v}'`)
  }
}

function parseRef(c: Cursor): Ref {
  const line = c.line
  const start = c.peek()?.pos ?? 0
  const invert = c.eat('!') || c.eat('~')
  const t = c.peek()
  if (t?.t === 'num') {
    c.next()
    return { kind: 'const', value: t.v, invert, line, chunk: c.chunk, text: (invert ? '!' : '') + t.v }
  }
  const node = c.ident('a net name')
  let pin: string | undefined
  if (c.eat('.')) pin = c.ident('a pin name')
  let slice: string | undefined
  if (c.is('[')) {
    c.next()
    const hi = c.num('a bit index')
    slice = `[${hi}]`
    if (c.eat(':')) slice = `[${hi}:${c.num('a bit index')}]`
    c.expect(']')
  }
  const endTok = c.toks[c.i - 1]
  const text = endTok !== undefined && endTok.end > start ? c.src.slice(start, endTok.end) : node

  return { kind: 'net', node, pin, slice, invert, line, chunk: c.chunk, text }
}

function parseWidth(c: Cursor): number {
  if (!c.eat('[')) return 1
  const hi = c.num('a bus width')
  let w = hi
  if (c.eat(':')) w = Math.abs(hi - c.num('a bit index')) + 1
  c.expect(']')
  if (w < 1 || w > 4096) throw c.fail(`bus width ${w} is out of range`)

  return w
}

/** `{ left: A B[32]; right: Y; top: ~En; shape: alu }`. Pins with `=ref` are only allowed in inline boxes. */
function parseBlockBody(c: Cursor, inline: boolean): { pins: PinDecl[]; shape: BlockShape } {
  c.expect('{')
  const pins: PinDecl[] = []
  let shape: BlockShape = 'rect'
  while (!c.is('}')) {
    if (c.eat(';') || c.eat(',')) continue
    const key = c.ident('a side (left, right, top, bottom) or shape')
    if (key === 'shape') {
      c.expect(':')
      const s = c.ident('a shape')
      if (s !== 'rect' && s !== 'alu' && s !== 'adder') throw c.fail(`unknown shape '${s}' (rect, alu, adder)`)
      shape = s
      continue
    }
    if (!SIDES.has(key)) throw c.fail(`expected a side (left, right, top, bottom), found '${key}'`)
    const side = key as Side
    let dir: Dir = side === 'right' ? 'out' : 'in'
    if (c.is('in') || c.is('out')) dir = c.next().v as Dir
    c.expect(':')
    while (!c.is(';') && !c.is('}')) {
      if (c.eat(',')) continue
      let ctrl = (side === 'top' || side === 'bottom') && dir === 'in'
      let clock = false
      for (;;) {
        if (c.eat('~')) ctrl = true
        else if (c.eat('^')) clock = true
        else break
      }
      const name = c.ident('a pin name')
      const width = parseWidth(c)
      let conn: Ref | undefined
      if (c.eat('=')) {
        if (!inline) throw c.fail(`'${name}=…' connects a pin; do that where the block is used, not in its definition`)
        if (dir === 'out') throw c.fail(`'${name}' is an output; connect its readers to it instead`)
        conn = parseRef(c)
      }
      if (pins.some(p => p.name === name)) throw c.fail(`pin '${name}' is declared twice`)
      pins.push({ name, side, dir, width, ctrl, clock, conn })
    }
  }
  c.expect('}')

  return { pins, shape }
}

function parseArgs(c: Cursor): Arg[] {
  c.expect('(', "'(' and the inputs")
  const args: Arg[] = []
  while (!c.is(')')) {
    if (c.eat(',') || c.eat(';')) continue
    if (c.peek()?.t === 'id' && c.is('=', 1)) {
      const pin = c.next().v
      c.next()
      args.push({ pin, ref: parseRef(c) })
    } else {
      args.push({ ref: parseRef(c) })
    }
  }
  c.expect(')')

  return args
}

/** Trailing `"label"` and `@ col,row` on an instance line. */
function parseTrailer(c: Cursor, name: string, inst: Instance, program: Program) {
  while (!c.done()) {
    const t = c.peek()!
    if (t.t === 'str') {
      c.next()
      inst.label = t.v
    } else if (c.eat('@')) {
      const col = c.num('a column')
      c.expect(',')
      const row = c.num('a row')
      program.directives.push({ kind: 'at', name, col, row, line: inst.line, chunk: inst.chunk })
    } else {
      throw c.fail(`unexpected '${t.v}' after the instance`)
    }
  }
}

export function parse(src: string, chunk = 0): Program {
  const program: Program = {
    inputs: [],
    outputs: [],
    blocks: new Map(),
    instances: [],
    assigns: [],
    directives: [],
    removes: [],
  }
  const seen = new Map<string, number>()
  const claim = (name: string, line: number) => {
    const prev = seen.get(name)
    if (prev !== undefined) throw new LogicError(`line ${line}: '${name}' is already defined on line ${prev}`)
    seen.set(name, line)
  }

  for (const toks of statements(src)) {
    const c = new Cursor(toks, chunk, src)
    const line = c.line
    const head = c.peek()!

    // Name = ...
    if (head.t === 'id' && c.is('=', 1)) {
      const name = c.next().v
      c.next()
      claim(name, line)
      const inst: Instance = { name, type: '', args: [], line, chunk }
      if (c.is('box')) {
        c.next()
        let label = name
        if (c.peek()?.t === 'str') label = c.next().v
        const bodyStart = c.peek()?.pos ?? 0
        const { pins, shape } = parseBlockBody(c, true)
        inst.type = 'box'
        inst.block = { name, label, shape, pins, line, chunk, src: src.slice(bodyStart, c.toks[c.i - 1]!.end) }
        if (c.is('(')) inst.args = parseArgs(c)
      } else {
        inst.type = c.ident('a gate or block type')
        inst.args = parseArgs(c)
      }
      parseTrailer(c, name, inst, program)
      program.instances.push(inst)
      continue
    }

    // Name.Pin = ref
    if (head.t === 'id' && c.is('.', 1) && c.is('=', 3)) {
      const node = c.next().v
      c.next()
      const pin = c.ident('a pin name')
      c.next()
      const ref = parseRef(c)
      c.end()
      program.assigns.push({ node, pin, ref, line, chunk })
      continue
    }

    if (head.t !== 'id') throw c.fail(`a statement can't start with '${head.v}'`)
    const kw = c.next().v
    switch (kw) {
      case 'title': {
        const t = c.next()
        if (t.t !== 'str') throw c.fail('expected a quoted title')
        program.title = t.v
        c.end()
        break
      }
      case 'input':
      case 'inputs': {
        if (c.done()) throw c.fail('name at least one input')
        while (!c.done()) {
          if (c.eat(',')) continue
          const name = c.ident('an input name')
          claim(name, line)
          program.inputs.push({ name, width: parseWidth(c), line, chunk })
        }
        break
      }
      case 'output':
      case 'outputs': {
        if (c.done()) throw c.fail('name at least one output')
        while (!c.done()) {
          if (c.eat(',')) continue
          const ref = parseRef(c)
          if (ref.kind === 'const') throw c.fail('an output needs a net, not a constant')
          let label: string | undefined
          if (c.peek()?.t === 'str') label = c.next().v
          program.outputs.push({ ref, label, line, chunk })
        }
        break
      }
      case 'block': {
        const name = c.ident('a block name')
        let label = name
        if (c.peek()?.t === 'str') label = c.next().v
        const start = head.pos
        const { pins, shape } = parseBlockBody(c, false)
        c.end()
        if (program.blocks.has(name)) throw c.fail(`block '${name}' is defined twice`)
        if (!pins.some(p => p.dir === 'out')) throw c.fail(`block '${name}' has no outputs (put them under right:)`)
        program.blocks.set(name, { name, label, shape, pins, line, chunk, src: src.slice(start, toks[toks.length - 1]!.end) })
        break
      }
      case 'place': {
        const a = c.ident()
        let rel = c.ident('above, below, left-of, right-of or same-row')
        if ((rel === 'left' || rel === 'right') && c.eat('-')) rel += `-${c.ident()}`
        else if (rel === 'same' && c.eat('-')) rel += `-${c.ident()}`
        const rels = ['above', 'below', 'left-of', 'right-of', 'same-row']
        if (!rels.includes(rel)) throw c.fail(`'${rel}' is not one of ${rels.join(', ')}`)
        const b = c.ident()
        c.end()
        program.directives.push({ kind: 'place', a, rel: rel as 'above', b, line, chunk })
        break
      }
      case 'order': {
        let col: number | undefined
        if (c.is('col')) {
          c.next()
          col = c.num('a column')
          c.expect(':')
        }
        const names: string[] = []
        while (!c.done()) {
          if (c.eat(',')) continue
          names.push(c.ident())
        }
        if (names.length < (col === undefined ? 2 : 1)) throw c.fail('order needs names, top to bottom')
        program.directives.push({ kind: 'order', col, names, line, chunk })
        break
      }
      case 'move': {
        const name = c.ident()
        const dir = c.ident('up, down, left or right')
        if (!['up', 'down', 'left', 'right'].includes(dir)) throw c.fail(`'${dir}' is not up, down, left or right`)
        const n = c.done() ? 1 : c.num()
        c.end()
        program.directives.push({ kind: 'move', name, dir: dir as 'up', n, line, chunk })
        break
      }
      case 'col': {
        const name = c.ident()
        const col = c.num('a column')
        c.end()
        program.directives.push({ kind: 'col', name, col, line, chunk })
        break
      }
      case 'spacing': {
        let text = c.next().v
        if (c.eat('.')) text += `.${c.next().v}`
        const n = Number(text)
        if (!(n >= 0.5 && n <= 4)) throw c.fail('spacing takes a number from 0.5 to 4')
        c.end()
        program.spacing = n
        break
      }
      case 'show': {
        const what = c.ident('names')
        if (what !== 'names') throw c.fail(`'show ${what}': only 'show names' exists`)
        c.end()
        program.showNames = true
        break
      }
      case 'remove': {
        while (!c.done()) {
          if (c.eat(',')) continue
          program.removes.push(c.ident())
        }
        break
      }
      default:
        throw new LogicError(
          `line ${line}: can't read '${kw} …'. Lines look like: input A B · Y = and(A, B) · output Y · block Name { left: …; right: … } · place/order/move/col/spacing/remove`,
        )
    }
  }

  return program
}

/** Folds a later chunk (a patch sent with `base`) into the program so far: same-named things are replaced. */
export function merge(a: Program, b: Program): Program {
  const removed = new Set(b.removes)
  const inputs = new Map(a.inputs.map(i => [i.name, i]))
  for (const i of b.inputs) inputs.set(i.name, i)
  const instances = new Map(a.instances.map(i => [i.name, i]))
  for (const i of b.instances) {
    instances.set(i.name, i)
    inputs.delete(i.name)
  }
  for (const i of b.inputs) instances.delete(i.name)
  const outputs = [...a.outputs]
  for (const o of b.outputs) if (!outputs.some(x => x.ref.text === o.ref.text)) outputs.push(o)
  const assigns = a.assigns.filter(x => !b.assigns.some(y => y.node === x.node && y.pin === x.pin))
  const blocks = new Map(a.blocks)
  for (const [k, v] of b.blocks) blocks.set(k, v)
  const gone = (name: string) => removed.has(name)

  return {
    title: b.title ?? a.title,
    inputs: [...inputs.values()].filter(i => !gone(i.name)),
    outputs: outputs.filter(o => !(o.ref.kind === 'net' && gone(o.ref.text))),
    blocks,
    instances: [...instances.values()].filter(i => !gone(i.name)),
    assigns: [...assigns, ...b.assigns].filter(x => !gone(x.node)),
    directives: [...a.directives, ...b.directives].filter(d => !('name' in d) || !gone(d.name)),
    removes: [],
    spacing: b.spacing ?? a.spacing,
    showNames: b.showNames ?? a.showNames,
  }
}
