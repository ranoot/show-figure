// Shared types for the `logic` figure format: source text → Program → Graph → geometry → SVG.

export type Side = 'left' | 'right' | 'top' | 'bottom'
export type Dir = 'in' | 'out'

export type Ref =
  | { kind: 'net'; node: string; pin?: string; slice?: string; invert: boolean; line: number; chunk: number; text: string }
  | { kind: 'const'; value: string; invert: boolean; line: number; chunk: number; text: string }

export type PinDecl = {
  name: string
  side: Side
  dir: Dir
  width: number
  ctrl: boolean
  clock: boolean
  /** Built-in pins drawn only when something connects to them. */
  optional?: boolean
  /** Text drawn for the pin, when it differs from its name. */
  label?: string
  /** An inline box's connection, written as `Pin=ref` in the box body. */
  conn?: Ref
}

export type BlockShape = 'rect' | 'alu' | 'adder'

export type BlockDef = {
  name: string
  label: string
  shape: BlockShape
  pins: PinDecl[]
  line: number
  chunk: number
  /** The definition's own source text, kept for the block library. */
  src: string
}

export type Arg = { pin?: string; ref: Ref }

export type Instance = {
  name: string
  type: string
  label?: string
  args: Arg[]
  /** Set for `X = box "..." { ... }`. */
  block?: BlockDef
  line: number
  chunk: number
}

export type Directive = { line: number; chunk: number } & (
  | { kind: 'place'; a: string; rel: 'above' | 'below' | 'left-of' | 'right-of' | 'same-row'; b: string }
  | { kind: 'order'; col?: number; names: string[] }
  | { kind: 'move'; name: string; dir: 'up' | 'down' | 'left' | 'right'; n: number }
  | { kind: 'col'; name: string; col: number }
  | { kind: 'at'; name: string; col: number; row: number }
)

export type Program = {
  title?: string
  inputs: { name: string; width: number; line: number; chunk: number }[]
  outputs: { ref: Ref; label?: string; line: number; chunk: number }[]
  blocks: Map<string, BlockDef>
  instances: Instance[]
  assigns: { node: string; pin: string; ref: Ref; line: number; chunk: number }[]
  directives: Directive[]
  removes: string[]
  spacing?: number
  showNames?: boolean
}

export class LogicError extends Error {}

/** "line 4" for the newest chunk, "base line 4" for an earlier one. */
export function where(line: number, chunk: number, newest: number): string {
  return chunk < newest ? `base line ${line}` : `line ${line}`
}

/** Rough advance width of sans-serif text: enough to size boxes and keep labels apart. */
export function textWidth(text: string, size: number): number {
  let w = 0
  for (const ch of text) {
    if ('il.,:;|!\'[]()'.includes(ch)) w += 0.32
    else if ('mwMW'.includes(ch)) w += 0.9
    else if (ch >= 'A' && ch <= 'Z') w += 0.7
    else if (ch >= '0' && ch <= '9') w += 0.58
    else w += 0.56
  }
  return Math.ceil(w * size)
}

export function closest(name: string, options: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestD = Infinity
  for (const o of options) {
    const d = editDistance(name.toLowerCase(), o.toLowerCase())
    if (d < bestD) {
      bestD = d
      best = o
    }
  }
  return best !== undefined && bestD <= Math.max(1, Math.floor(name.length / 3)) ? best : undefined
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]!
}
