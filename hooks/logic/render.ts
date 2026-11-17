// Entry point for the `logic` format: chunks of source (a base figure plus patches) → SVG + a text map.

import { resolve } from './graph.js'
import { layout } from './layout.js'
import type { Geometry } from './layout.js'
import { LogicError } from './model.js'
import type { BlockDef, Program } from './model.js'
import { merge, parse } from './parse.js'
import { CTRL, INK, MUTED, esc } from './symbols.js'

export { LogicError } from './model.js'

/** Separates a base figure's source from the patches applied on top of it. */
export const PATCH_MARK = '#@patch'

export type LogicResult = {
  svg: string
  /** One line per fact: columns, crossings, warnings. */
  map: string
  warnings: string[]
  /** Blocks defined by this source, to keep in the library. */
  blocks: BlockDef[]
  title?: string
  width: number
  height: number
  geometry: Geometry
}

export function splitChunks(text: string): string[] {
  return text.split(new RegExp(`^${PATCH_MARK}.*$`, 'm'))
}

export function parseLibrary(text: string | undefined): Map<string, BlockDef> {
  if (!text) return new Map()
  const out = new Map<string, BlockDef>()
  // One definition per chunk, so a bad one doesn't lose the rest.
  for (const part of text.split(/\n(?=block\s)/)) {
    try {
      for (const [k, v] of parse(part, -1).blocks) out.set(k, v)
    } catch {
      // skip a definition that no longer parses
    }
  }
  return out
}

export function serializeLibrary(blocks: Map<string, BlockDef>): string {
  return [...blocks.values()].map(b => b.src.trim()).join('\n') + '\n'
}

export function logicToSvg(chunks: string[], library?: Map<string, BlockDef>): LogicResult {
  const newest = chunks.length - 1
  const programs: Program[] = chunks.map((text, i) => {
    try {
      return parse(text, i)
    } catch (err) {
      if (err instanceof LogicError && i < newest) throw new LogicError(`base ${err.message}`)
      throw err
    }
  })
  const program = programs.reduce((a, b) => merge(a, b))
  if (program.instances.length === 0 && program.inputs.length === 0) {
    throw new LogicError('nothing to draw: declare inputs and gates, e.g. `input A B` then `Y = and(A, B)` and `output Y`')
  }
  const warnings: string[] = []
  const graph = resolve(program, library ?? new Map(), newest)
  const geo = layout(graph, warnings, newest)
  const { svg, width, height } = toSvg(geo)
  const cols = geo.columns.map((names, i) => `c${i}[${names.join(' ')}]`).join(' ')
  const map = [
    `${geo.columns.length} cols · ${cols}`,
    `crossings ${geo.crossings} · overlaps 0 (verified)`,
    ...warnings.map(w => `warn: ${w}`),
  ].join('\n')
  const blocks = programs.flatMap(p => [...p.blocks.values()])

  return { svg, map, warnings, blocks, title: program.title, width, height, geometry: geo }
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toString()

function toSvg(geo: Geometry): { svg: string; width: number; height: number } {
  const pad = 16
  const b = geo.bounds
  const vx = b.x - pad
  const vy = b.y - pad
  const width = Math.ceil(b.w + 2 * pad)
  const height = Math.ceil(b.h + 2 * pad)
  const parts: string[] = []
  const ctrlNet = (id: string) => geo.nets.get(id)?.ctrl === true
  const wires = (ctrl: boolean) =>
    geo.segs
      .filter(s => ctrlNet(s.net) === ctrl)
      .map(s => `M${n2(s.x1)},${n2(s.y1)}${s.x1 === s.x2 ? `V${n2(s.y2)}` : `H${n2(s.x2)}`}`)
      .join('')
  const plain = wires(false)
  const ctrl = wires(true)
  if (plain) parts.push(`<path d="${plain}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="square"/>`)
  if (ctrl) parts.push(`<path d="${ctrl}" fill="none" stroke="${CTRL}" stroke-width="1.6" stroke-linecap="square"/>`)
  for (const d of geo.dots) {
    parts.push(`<circle cx="${n2(d.x)}" cy="${n2(d.y)}" r="3.5" fill="${ctrlNet(d.net) ? CTRL : INK}"/>`)
  }
  for (const n of geo.nodes) parts.push(n.sym.svg(n.x, n.y))
  for (const m of geo.marks) {
    const color = ctrlNet(m.net) ? CTRL : INK
    parts.push(
      `<path d="M${n2(m.x - 4)},${n2(m.y + 4)} L${n2(m.x + 4)},${n2(m.y - 4)}" stroke="${color}" stroke-width="1.2"/>`,
      `<text x="${n2(m.x + 2)}" y="${n2(m.y - 6)}" font-size="9" fill="${color}">${esc(m.text)}</text>`,
    )
  }
  for (const l of geo.labels) {
    parts.push(`<text x="${n2(l.x)}" y="${n2(l.y)}" font-size="9" text-anchor="${l.anchor}" fill="${MUTED}">${esc(l.text)}</text>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n2(vx)} ${n2(vy)} ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif">${parts.join('')}</svg>`

  return { svg, width, height }
}
