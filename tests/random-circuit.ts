// Random netlists for fuzzing: gates, blocks with pins on every side, buses, feedback, directives.
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

export function randomCircuit(seed: number): string {
  const r = rng(seed)
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!
  const lines: string[] = []
  const nIn = int(1, 5)
  const nets: string[] = []
  const inputs = Array.from({ length: nIn }, (_, i) => `I${i}`)
  lines.push(`input ${inputs.map(n => (r() < 0.2 ? `${n}[${int(2, 32)}]` : n)).join(' ')}`)
  nets.push(...inputs)
  const blocks: { name: string; ins: string[]; outs: string[] }[] = []
  for (let b = 0; b < int(0, 2); b++) {
    const name = `Blk${b}`
    const ins: string[] = []
    const outs: string[] = []
    const sides: string[] = []
    const left = Array.from({ length: int(1, 4) }, (_, i) => `a${i}${r() < 0.3 ? `[${int(2, 16)}]` : ''}`)
    ins.push(...left.map(p => p.replace(/\[.*/, '')))
    sides.push(`left: ${left.join(' ')}`)
    const right = Array.from({ length: int(1, 3) }, (_, i) => `y${i}${r() < 0.3 ? `[${int(2, 16)}]` : ''}`)
    outs.push(...right.map(p => p.replace(/\[.*/, '')))
    sides.push(`right: ${right.join(' ')}`)
    if (r() < 0.6) {
      const top = Array.from({ length: int(1, 3) }, (_, i) => `t${i}`)
      ins.push(...top)
      sides.push(`top: ${top.join(' ')}`)
    }
    if (r() < 0.4) {
      const bot = Array.from({ length: int(1, 2) }, (_, i) => `b${i}`)
      ins.push(...bot)
      sides.push(`bottom: ${bot.join(' ')}`)
    }
    if (r() < 0.3) {
      outs.push('z')
      sides.push('top out: z')
    }
    lines.push(`block ${name} "${pick(['Unit', 'Register\\nfile', 'Mem', 'Ctl'])}" { ${sides.join('; ')} }`)
    blocks.push({ name, ins, outs })
  }
  const nG = int(2, 22)
  const names = Array.from({ length: nG }, (_, i) => `G${i}`)
  const ref = (i: number) => {
    // Mostly earlier nets, sometimes a later gate (feedback), sometimes a constant or an inversion.
    if (r() < 0.12 && i + 1 < nG) return names[int(i + 1, nG - 1)]!
    if (r() < 0.05) return String(int(0, 9))
    const n = pick(nets)
    return (r() < 0.1 ? '!' : '') + n
  }
  for (let i = 0; i < nG; i++) {
    const kind = r()
    if (kind < 0.62) {
      const t = pick(['and', 'or', 'nand', 'nor', 'xor', 'xnor', 'not', 'buf'])
      const k = t === 'not' || t === 'buf' ? 1 : int(2, 4)
      lines.push(`${names[i]} = ${t}(${Array.from({ length: k }, () => ref(i)).join(', ')})`)
      nets.push(names[i]!)
    } else if (kind < 0.72) {
      lines.push(`${names[i]} = mux(${Array.from({ length: int(2, 4) }, () => ref(i)).join(', ')}${r() < 0.8 ? `, S=${ref(i)}` : ''})`)
      nets.push(names[i]!)
    } else if (kind < 0.78) {
      lines.push(`${names[i]} = alu(A=${ref(i)}, B=${ref(i)}${r() < 0.5 ? `, op=${ref(i)}` : ''})`)
      nets.push(`${names[i]}.Result`)
      if (r() < 0.5) nets.push(`${names[i]}.Zero`)
    } else if (kind < 0.84) {
      lines.push(`${names[i]} = ${pick(['dff', 'tff'])}(${ref(i)}, CLK=${pick(inputs)})`)
      nets.push(names[i]!)
      if (r() < 0.4) nets.push(`${names[i]}.Qn`)
    } else if (blocks.length > 0) {
      const b = pick(blocks)
      const args = b.ins.filter(() => r() < 0.85).map(p => `${p}=${ref(i)}`)
      lines.push(`${names[i]} = ${b.name}(${args.join(', ')})`)
      nets.push(...b.outs.map(o => `${names[i]}.${o}`))
    } else {
      lines.push(`${names[i]} = adder(${ref(i)}, ${ref(i)})`)
      nets.push(names[i]!)
    }
  }
  const outs = nets.filter(n => !inputs.includes(n) && r() < 0.25).slice(0, 5)
  if (outs.length) lines.push(`output ${outs.join(' ')}`)
  for (let d = 0; d < int(0, 4); d++) {
    const a = pick(names)
    const b = pick(names)
    const k = r()
    if (k < 0.25) lines.push(`place ${a} ${pick(['above', 'below', 'left-of', 'right-of', 'same-row'])} ${b}`)
    else if (k < 0.45) lines.push(`order ${a} ${b}`)
    else if (k < 0.65) lines.push(`move ${a} ${pick(['up', 'down', 'left', 'right'])} ${int(1, 2)}`)
    else if (k < 0.8) lines.push(`col ${a} ${int(0, 6)}`)
    else if (k < 0.9) lines.push(`spacing ${pick(['0.5', '1.5', '2'])}`)
    else lines.push('show names')
  }
  return lines.join('\n')
}
