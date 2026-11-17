// Symbols: every node becomes a box with pins on its boundary and an SVG drawing inside it.
// Layout only ever sees { w, h, pins }; nothing drawn here leaves the box.

import { textWidth } from './model.js'
import type { Side } from './model.js'
import type { GNode, GPin } from './graph.js'

export const INK = '#1f2328'
export const CTRL = '#1565c0'
export const MUTED = '#57606a'
/** Pin pitch. */
export const P = 24

export type SymPin = { name: string; side: Side; x: number; y: number }
export type Sym = { w: number; h: number; pins: Map<string, SymPin>; svg: (ox: number, oy: number) => string }

const n2 = (v: number) => (Math.round(v * 100) / 100).toString()

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function text(x: number, y: number, s: string, size: number, anchor: 'start' | 'middle' | 'end', color = INK, extra = '') {
  return `<text x="${n2(x)}" y="${n2(y)}" font-size="${size}" text-anchor="${anchor}" fill="${color}"${extra}>${esc(s)}</text>`
}

const stroke = (w = 2, color = INK) => `fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`

export function symbolFor(node: GNode, showNames: boolean): Sym {
  switch (node.shape) {
    case 'gate':
      return gateSym(node, showNames || node.label !== node.name)
    case 'port':
      return portSym(node)
    case 'mux':
      return muxSym(node, showNames)
    case 'alu':
    case 'adder':
      return trapezoidSym(node)
    default:
      return rectSym(node)
  }
}

function gateSym(node: GNode, withLabel: boolean): Sym {
  const ins = node.pins.filter(p => p.dir === 'in')
  const n = ins.length
  const bodyH = Math.max(2, n) * P
  const h = bodyH + (withLabel ? 14 : 0)
  const w = 70
  const type = node.type
  const bubbleOut = type === 'nand' || type === 'nor' || type === 'xnor' || type === 'not'
  const pinY = (k: number) => (n === 1 ? bodyH / 2 : P / 2 + k * P)
  const pins = new Map<string, SymPin>()
  ins.forEach((p, k) => pins.set(p.name, { name: p.name, side: 'left', x: 0, y: pinY(k) }))
  pins.set('out', { name: 'out', side: 'right', x: w, y: bodyH / 2 })

  const isOr = type === 'or' || type === 'nor' || type === 'xor' || type === 'xnor'
  const isXor = type === 'xor' || type === 'xnor'
  // x of the body's input edge at height y (OR family has a curved back).
  const backX = (y: number) => {
    if (type === 'not' || type === 'buf') return 12
    if (!isOr) return 10
    const t = y / bodyH
    return 10 + 2 * t * (1 - t) * 12
  }

  const svg = (ox: number, oy: number) => {
    const X = (v: number) => n2(ox + v)
    const Y = (v: number) => n2(oy + v)
    const parts: string[] = []
    const mid = bodyH / 2
    if (type === 'not' || type === 'buf') {
      parts.push(`<path d="M${X(12)},${Y(mid - 15)} L${X(52)},${Y(mid)} L${X(12)},${Y(mid + 15)} Z" ${stroke()}/>`)
    } else if (isOr) {
      parts.push(
        `<path d="M${X(10)},${Y(0)} Q${X(45)},${Y(0)} ${X(60)},${Y(mid)} Q${X(45)},${Y(bodyH)} ${X(10)},${Y(bodyH)} Q${X(22)},${Y(mid)} ${X(10)},${Y(0)} Z" ${stroke()}/>`,
      )
      if (isXor) parts.push(`<path d="M${X(3)},${Y(0)} Q${X(15)},${Y(mid)} ${X(3)},${Y(bodyH)}" ${stroke()}/>`)
    } else {
      parts.push(
        `<path d="M${X(10)},${Y(0)} H${X(35)} A25,${n2(mid)} 0 0 1 ${X(35)},${Y(bodyH)} H${X(10)} Z" ${stroke()}/>`,
      )
    }
    const tip = type === 'not' || type === 'buf' ? 52 : 60
    if (bubbleOut) {
      parts.push(`<circle cx="${X(tip + 4)}" cy="${Y(mid)}" r="4" ${stroke(2)}/>`)
      parts.push(`<path d="M${X(tip + 8)},${Y(mid)} H${X(w)}" ${stroke(2)}/>`)
    } else {
      parts.push(`<path d="M${X(tip)},${Y(mid)} H${X(w)}" ${stroke(2)}/>`)
    }
    ins.forEach((p, k) => {
      const y = pinY(k)
      const edge = backX(y)
      if (p.invert) {
        parts.push(`<circle cx="${X(edge - 4)}" cy="${Y(y)}" r="4" ${stroke(2)}/>`)
        if (edge - 8 > 0) parts.push(`<path d="M${X(0)},${Y(y)} H${X(edge - 8)}" ${stroke(2)}/>`)
      } else {
        parts.push(`<path d="M${X(0)},${Y(y)} H${X(edge)}" ${stroke(2)}/>`)
      }
    })
    if (withLabel) parts.push(text(ox + 35, oy + bodyH + 11, node.label, 10, 'middle', MUTED))
    return parts.join('')
  }

  return { w, h, pins, svg }
}

function portSym(node: GNode): Sym {
  const isConst = node.kind === 'const'
  const size = isConst ? 12 : 14
  // Bold runs wider than the regular advance textWidth estimates.
  const tw = Math.ceil(textWidth(node.label, size) * (isConst ? 1 : 1.08))
  const w = tw + 20
  const h = 20
  const pins = new Map<string, SymPin>()
  const isOut = node.kind === 'output'
  pins.set(isOut ? 'in' : 'out', { name: isOut ? 'in' : 'out', side: isOut ? 'left' : 'right', x: isOut ? 0 : w, y: 10 })
  const svg = (ox: number, oy: number) => {
    const style = isConst ? ' font-style="italic"' : ' font-weight="600"'
    if (isOut) {
      return `<path d="M${n2(ox)},${n2(oy + 10)} H${n2(ox + 12)}" ${stroke(2)}/>${text(ox + 18, oy + 15, node.label, size, 'start', INK, style)}`
    }
    return `${text(ox + tw, oy + 15, node.label, size, 'end', INK, style)}<path d="M${n2(ox + tw + 8)},${n2(oy + 10)} H${n2(ox + w)}" ${stroke(2)}/>`
  }

  return { w, h, pins, svg }
}

/** The mux trapezoid: data inputs on the long left edge with their select codes, select from below. */
function muxSym(node: GNode, withLabel: boolean): Sym {
  const data = node.pins.filter(p => p.name.startsWith('in'))
  const n = data.length
  const bodyH = (n + 1) * P
  const label = withLabel && node.label !== '' ? node.label : withLabel ? node.name : ''
  // The name goes above the body: the select wire leaves from the bottom.
  const top = label ? 16 : 0
  const h = bodyH + top
  const codeW = Math.max(0, ...data.map(p => textWidth(p.label ?? '', 12)))
  const w = Math.max(36, codeW + 26)
  const slant = Math.min(P * 0.75, bodyH * 0.2)
  const pins = new Map<string, SymPin>()
  data.forEach((p, k) => pins.set(p.name, { name: p.name, side: 'left', x: 0, y: top + P + k * P }))
  pins.set('out', { name: 'out', side: 'right', x: w, y: top + bodyH / 2 })
  const sel = node.pins.find(p => p.name === 'S')
  if (sel) pins.set('S', { name: 'S', side: 'bottom', x: w / 2, y: h })
  const svg = (ox: number, y0: number) => {
    const oy = y0 + top
    const X = (v: number) => n2(ox + v)
    const Y = (v: number) => n2(oy + v)
    const parts = [`<path d="M${X(0)},${Y(0)} L${X(w)},${Y(slant)} L${X(w)},${Y(bodyH - slant)} L${X(0)},${Y(bodyH)} Z" ${stroke()}/>`]
    if (sel) {
      const ss = node.pins.find(p => p.name === 'S')!
      parts.push(`<path d="M${X(w / 2)},${Y(bodyH - slant / 2)} V${Y(bodyH)}" ${stroke(2, ss.ctrl ? CTRL : INK)}/>`)
    }
    data.forEach((p, k) => {
      const y = P + k * P
      parts.push(text(ox + (p.invert ? 10 : 6), oy + y + 4, p.label ?? String(k), 12, 'start'))
      if (p.invert) parts.push(`<circle cx="${X(3)}" cy="${Y(y)}" r="3" ${stroke(1.6)}/>`)
    })
    if (label) parts.push(text(ox + w / 2, y0 + 11, label, 11, 'middle', MUTED))
    return parts.join('')
  }

  return { w, h, pins, svg }
}

/** ALU / adder: the notched trapezoid. Left inputs avoid the notch; right outputs sit on the short edge. */
function trapezoidSym(node: GNode): Sym {
  const isAlu = node.shape === 'alu'
  const left = node.pins.filter(p => p.side === 'left')
  const right = node.pins.filter(p => p.side === 'right')
  const top = node.pins.filter(p => p.side === 'top')
  const bottom = node.pins.filter(p => p.side === 'bottom')
  const half = Math.max(1, Math.ceil(left.length / 2))
  const h = Math.max(isAlu ? 120 : 90, (half * 2 + 2) * P, (right.length + 3) * P)
  const w = isAlu ? 80 : 50
  const slant = h * (isAlu ? 0.29 : 0.28)
  const notch = h * 0.1
  const mid = h / 2
  const pins = new Map<string, SymPin>()
  // Upper inputs from the top down, lower inputs from the bottom up, both outside the notch.
  const upper = left.slice(0, half)
  const lower = left.slice(half)
  const pitchU = (mid - notch - 6) / upper.length
  upper.forEach((p, k) => pins.set(p.name, { name: p.name, side: 'left', x: 0, y: Math.round(6 + pitchU * (k + 0.5)) }))
  const pitchL = (mid - notch - 6) / Math.max(1, lower.length)
  lower.forEach((p, k) =>
    pins.set(p.name, { name: p.name, side: 'left', x: 0, y: Math.round(mid + notch + pitchL * (k + 0.5)) }),
  )
  const edge = h - 2 * slant
  right.forEach((p, k) =>
    pins.set(p.name, { name: p.name, side: 'right', x: w, y: Math.round(slant + (edge * (k + 1)) / (right.length + 1)) }),
  )
  top.forEach((p, k) => pins.set(p.name, { name: p.name, side: 'top', x: Math.round((w * (k + 1)) / (top.length + 1)), y: 0 }))
  bottom.forEach((p, k) =>
    pins.set(p.name, { name: p.name, side: 'bottom', x: Math.round((w * (k + 1)) / (bottom.length + 1)), y: h }),
  )
  const yTop = (x: number) => (slant * x) / w
  const svg = (ox: number, oy: number) => {
    const X = (v: number) => n2(ox + v)
    const Y = (v: number) => n2(oy + v)
    const parts = [
      `<path d="M${X(0)},${Y(0)} L${X(w)},${Y(slant)} L${X(w)},${Y(h - slant)} L${X(0)},${Y(h)} L${X(0)},${Y(mid + notch)} L${X(w * 0.2)},${Y(mid)} L${X(0)},${Y(mid - notch)} Z" ${stroke()}/>`,
    ]
    for (const p of top) {
      const sp = pins.get(p.name)!
      parts.push(`<path d="M${X(sp.x)},${Y(0)} V${Y(yTop(sp.x))}" ${stroke(1.4, p.ctrl ? CTRL : INK)}/>`)
    }
    for (const p of bottom) {
      const sp = pins.get(p.name)!
      parts.push(`<path d="M${X(sp.x)},${Y(h)} V${Y(h - yTop(sp.x))}" ${stroke(1.4, p.ctrl ? CTRL : INK)}/>`)
    }
    const label = node.label
    if (label) parts.push(text(ox + w * (isAlu ? 0.42 : 0.58), oy + mid + 4.5, label, isAlu ? 13 : 11, 'middle', INK, ' font-weight="600"'))
    if (isAlu || right.length > 1) {
      for (const p of right) {
        const sp = pins.get(p.name)!
        if (right.length === 1 && !isAlu) continue
        parts.push(text(ox + w - 3, oy + sp.y + 3, p.label ?? p.name, 8, 'end', MUTED))
      }
    }
    for (const p of left) {
      if (!p.invert) continue
      const sp = pins.get(p.name)!
      parts.push(`<circle cx="${X(3)}" cy="${Y(sp.y)}" r="3" ${stroke(1.4)}/>`)
    }
    return parts.join('')
  }

  // ALU result labels need room: keep names short. The label sits right of the notch.
  return { w, h, pins, svg }
}

/** Generic block: a rectangle with named pins on any side; the label in the middle. */
function rectSym(node: GNode): Sym {
  const FS = 12
  const left = node.pins.filter(p => p.side === 'left')
  const right = node.pins.filter(p => p.side === 'right')
  const top = node.pins.filter(p => p.side === 'top')
  const bottom = node.pins.filter(p => p.side === 'bottom')
  const nameOf = (p: GPin) => p.label ?? p.name
  const nameW = (ps: GPin[]) => Math.max(0, ...ps.map(p => (nameOf(p) ? textWidth(nameOf(p), FS) : 0) + (p.clock ? 13 : 0)))
  const lines = node.label ? node.label.split('\n') : []
  const labelW = Math.max(0, ...lines.map(l => textWidth(l, 12)))
  const LH = 14
  const topPad = top.length > 0 ? 18 : 6
  const botPad = bottom.length > 0 ? 18 : 6
  const rows = Math.max(left.length, right.length, 1)
  const inner = Math.max(rows * P, lines.length * LH + 8)
  const h = Math.ceil((topPad + botPad + inner) / 10) * 10
  const maxL = nameW(left)
  const maxR = nameW(right)
  const sideNames = (ps: GPin[]) => ps.reduce((s, p) => s + textWidth(nameOf(p), FS) + 10, 10)
  const w = Math.ceil(
    Math.max(
      50,
      maxL + maxR + (labelW > 0 ? labelW + 24 : 16),
      (top.length + 1) * P,
      (bottom.length + 1) * P,
      sideNames(top),
      sideNames(bottom),
    ) / 10,
  ) * 10
  const pins = new Map<string, SymPin>()
  // Both sides share rows from the top, so a flip-flop's Q sits level with its D.
  const column = (ps: GPin[], x: number, side: Side) => {
    const start = topPad + (h - topPad - botPad - rows * P) / 2 + P / 2
    ps.forEach((p, k) => pins.set(p.name, { name: p.name, side, x, y: Math.round(start + k * P) }))
  }
  column(left, 0, 'left')
  column(right, w, 'right')
  top.forEach((p, k) => pins.set(p.name, { name: p.name, side: 'top', x: Math.round((w * (k + 1)) / (top.length + 1)), y: 0 }))
  bottom.forEach((p, k) =>
    pins.set(p.name, { name: p.name, side: 'bottom', x: Math.round((w * (k + 1)) / (bottom.length + 1)), y: h }),
  )

  const svg = (ox: number, oy: number) => {
    const parts = [`<rect x="${n2(ox)}" y="${n2(oy)}" width="${w}" height="${h}" rx="2" ${stroke()}/>`]
    for (const p of node.pins) {
      const sp = pins.get(p.name)
      if (sp === undefined) continue
      const color = p.ctrl ? CTRL : INK
      const name = nameOf(p)
      const x = ox + sp.x
      const y = oy + sp.y
      if (sp.side === 'left') {
        let at = x + 4
        if (p.clock) {
          parts.push(`<path d="M${n2(x)},${n2(y - 7)} L${n2(x + 11)},${n2(y)} L${n2(x)},${n2(y + 7)}" ${stroke(2)}/>`)
          at += 12
        }
        // The bubble sits just outside the edge, over the end of the wire.
        if (p.invert) parts.push(`<circle cx="${n2(x - 4)}" cy="${n2(y)}" r="4" fill="white" stroke="${INK}" stroke-width="2"/>`)
        if (name) parts.push(text(at, y + 4, name, FS, 'start', color))
      } else if (sp.side === 'right') {
        if (name) parts.push(text(x - 4, y + 3.5, name, FS, 'end', color))
      } else if (sp.side === 'top') {
        if (name) parts.push(text(x, y + 12, name, FS, 'middle', color))
      } else if (name) {
        parts.push(text(x, y - 5, name, FS, 'middle', color))
      }
    }
    if (lines.length > 0) {
      const cx = ox + maxL + 8 + (w - maxL - maxR - 16) / 2
      const cy = oy + topPad + (h - topPad - botPad) / 2 - ((lines.length - 1) * LH) / 2 + 4.5
      lines.forEach((l, k) => parts.push(text(cx, cy + k * LH, l, 12, 'middle', INK, ' font-weight="600"')))
    }
    return parts.join('')
  }

  return { w, h, pins, svg }
}
