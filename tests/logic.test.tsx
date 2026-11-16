import { expect, test } from 'claude-code/testing'

import { checkGeometry } from '../hooks/logic/layout.js'
import { LogicError, logicToSvg } from '../hooks/logic/render.js'
import { randomCircuit } from './random-circuit.js'

const TOOL = 'mcp__show-figure__ShowFigure'

const FULL_ADDER = `
input A B Cin
S1   = xor(A, B)
S    = xor(S1, Cin)
C1   = and(A, B)
C2   = and(S1, Cin)
Cout = or(C1, C2)
output S Cout
`

const CIRCUITS: Record<string, string> = {
  'half adder': 'input A B\nS = xor(A, B)\nC = and(A, B)\noutput S C',
  'full adder': FULL_ADDER,
  '2:1 mux from gates': 'input A B S\nNS = not(S)\nT1 = and(A, NS)\nT2 = and(B, S)\nY = or(T1, T2)\noutput Y',
  'SR latch (feedback)': 'input S R\nQ = nor(R, Qn)\nQn = nor(S, Q)\noutput Q Qn',
  'counter (D flip-flops)': `
input clk
FF0 = dff(D=!FF0, CLK=clk)
T1 = xor(FF1, FF0)
FF1 = dff(D=T1, CLK=clk)
A2 = and(FF0, FF1)
T2 = xor(FF2, A2)
FF2 = dff(D=T2, CLK=clk)
output FF0 FF1 FF2`,
}

const DATAPATH = `
block RegFile "Registers" {
  left:  RR1[5] RR2[5] WR[5] WD[32]
  right: RD1[32] RD2[32]
  top:   RegWrite
}
block DMem "Data\\nmemory" { left: Addr[32] WD[32]; right: RD[32]; top: MemWrite; bottom: MemRead }
block Control { left: Op[6]; right: ~RegDst ~ALUSrc ~MemtoReg ~RegWrite ~MemRead ~MemWrite ~ALUOp[2] }
block PipeReg "IF/ID" { left: D[32]; right: Q[32]; bottom: ^clk }
input clk
PC  = reg(D=PCnext, CLK=clk)
Add4 = adder(PC, 4)
IM  = box "Instruction\\nmemory" { left: Addr[32]=PC; right: Instr[32] }
IFID = PipeReg(D=IM.Instr, clk=clk)
IFID2 = PipeReg(D=Add4, clk=clk)
Ctl = Control(Op=IFID.Q[31:26])
WRmux = mux(IFID.Q[20:16], IFID.Q[15:11], S=Ctl.RegDst)
RF  = RegFile(RR1=IFID.Q[25:21], RR2=IFID.Q[20:16], WR=WRmux, WD=WBmux, RegWrite=Ctl.RegWrite)
Ext = box "Sign\\nextend" { left: In[16]=IFID.Q[15:0]; right: Out[32] }
SrcMux = mux(RF.RD2, Ext, S=Ctl.ALUSrc)
ALU = alu(A=RF.RD1, B=SrcMux, op=Ctl.ALUOp)
DM  = DMem(Addr=ALU.Result, WD=RF.RD2, MemWrite=Ctl.MemWrite, MemRead=Ctl.MemRead)
WBmux = mux(ALU.Result, DM.RD, S=Ctl.MemtoReg)
PCnext = buf(IFID2.Q)
`

const error = (src: string): string => {
  try {
    logicToSvg([src])
  } catch (err) {
    if (err instanceof LogicError) return err.message
    throw err
  }
  throw new Error('expected a LogicError')
}

test('mistakes come back with the line and a fix', async () => {
  expect(error('input A B\nY = and(A, C)\noutput Y')).toMatch(/^line 2: unknown net 'C'/)
  expect(error('input A Bee\nY = and(A, Be)')).toMatch(/did you mean 'Bee'/)
  expect(error('input A B\nY = and(A, B)\nY.in1 = B')).toMatch(/line 3: Y\.in1 already has a driver \(line 2\)/)
  expect(error('input A\nY = not(A, A)')).toMatch(/line 2: not takes exactly 1 input/)
  expect(error('input A\nY = nad(A, A)')).toMatch(/unknown type 'nad' \(did you mean 'nand'\?\)/)
  expect(error('input A\nY = and(A, A)\nY = or(A, A)')).toMatch(/line 3: 'Y' is already defined on line 2/)
  expect(error('block R { left: a; right: q }\ninput A\nX = R(b=A)')).toMatch(/no input pin 'b' \(inputs: a\)/)
  expect(error('input A\nX = alu(A, A)\nY = not(X.Res)')).toMatch(/line 3: X has no output 'Res' \(outputs: Zero Result\)/)
})

test('textbook circuits lay out with nothing overlapping, the same way every time', async () => {
  for (const [name, src] of Object.entries(CIRCUITS)) {
    const a = logicToSvg([src])
    expect({ name, violations: checkGeometry(a.geometry).map(v => v.what) }).toEqual({ name, violations: [] })
    expect(a.map).toMatch(/overlaps 0 \(verified\)/)
    expect(logicToSvg([src]).svg).toBe(a.svg)
  }
  const full = logicToSvg([FULL_ADDER])
  expect(full.map).toMatch(/^5 cols · c0\[[A-Za-z ]+\] c1\[/)
  expect(full.geometry.dots.length).toBeGreaterThan(0)
})

test('a pipelined datapath: blocks used twice, control pins, buses, slices, feedback', async () => {
  const r = logicToSvg([DATAPATH])
  expect(checkGeometry(r.geometry).map(v => v.what)).toEqual([])
  expect(r.geometry.marks.some(m => m.text === '32')).toBe(true)
  expect(r.geometry.labels.some(l => l.text === '[25:21]')).toBe(true)
  expect(r.svg).toContain('Registers')
  expect(r.svg).toContain('#1565c0')
  expect(r.geometry.nodes.filter(n => n.node.type === 'PipeReg').length).toBe(2)
  expect(r.blocks.map(b => b.name).sort()).toEqual(['Control', 'DMem', 'PipeReg', 'RegFile'])
})

test('directives move things, and contradictions are warned about, never drawn overlapping', async () => {
  const column = (map: string, k: number) => new RegExp(`c${k}\\[([^\\]]*)\\]`).exec(map)?.[1]?.split(' ') ?? []
  const base = logicToSvg([FULL_ADDER])
  const c1 = column(base.map, 1)
  const [top, bottom] = c1
  const swapped = logicToSvg([FULL_ADDER, `place ${bottom} above ${top}`])
  expect(column(swapped.map, 1)).toEqual([bottom, top])
  expect(logicToSvg([FULL_ADDER, `move ${top} down 1`]).map).toContain(`c1[${bottom} ${top}]`)
  expect(column(logicToSvg([FULL_ADDER, 'col Cout 4']).map, 4)).toContain('Cout')
  const clash = logicToSvg([FULL_ADDER, 'place S1 above C1\nplace C1 above S1'])
  expect(clash.map).toMatch(/warn: line 2: place C1 above S1 contradicts an earlier order; ignored/)
  expect(checkGeometry(clash.geometry)).toEqual([])
  expect(logicToSvg([FULL_ADDER, 'place Nope above S1']).map).toMatch(/'Nope' is not a gate/)
})

test('patches replace, add and remove; base errors are marked as such', async () => {
  const r = logicToSvg([FULL_ADDER, 'C1 = nand(A, B)\nX = not(Cout)\noutput X'])
  expect(r.geometry.nodes.find(n => n.node.id === 'C1')?.node.type).toBe('nand')
  expect(r.geometry.nodes.some(n => n.node.id === '>X')).toBe(true)
  try {
    logicToSvg(['input A\nY = not(A)\nZ = buf(Y)\noutput Z', 'remove Y'])
    throw new Error('expected a LogicError')
  } catch (err) {
    expect((err as Error).message).toMatch(/^base line 3: unknown net 'Y'/)
  }
  try {
    logicToSvg(['input A\nY = and(A, Q)', 'output Y'])
    throw new Error('expected a LogicError')
  } catch (err) {
    expect((err as Error).message).toMatch(/^base line 2: unknown net 'Q'/)
  }
})

test('200 random netlists: every one lays out, and an independent check finds no overlap', async () => {
  const failures: string[] = []
  for (let seed = 1; seed <= 200; seed++) {
    const src = randomCircuit(seed)
    try {
      const v = checkGeometry(logicToSvg([src]).geometry)
      if (v.length > 0) failures.push(`seed ${seed}: ${v[0]!.what}`)
    } catch (err) {
      failures.push(`seed ${seed}: ${(err as Error).message}`)
    }
  }
  expect(failures).toEqual([])
})

// ---- through the tool -----------------------------------------------------------

/** A PNG header of the given size (enough for the IHDR read). */
function pngOf(width: number, height: number): string {
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]
  for (const v of [width, height]) bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  bytes.push(8, 6, 0, 0, 0, 0, 0, 0)
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + A[(n >> 6) & 63]! + A[n & 63]!
  }
  return out
}

test('the tool draws logic, hands back an id and a map, and applies a one-line patch on top', async ($, on) => {
  const files: Record<string, string> = {}
  const ran: string[][] = []
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('command.register', () => ({ value: { command: 'figure' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => (e.as === 'bytes' ? { value: { base64: pngOf(964, 280) } } : { value: files[e.path] ?? '' }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[0] === 'which' ? `/bin/${e.argv[1]}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const first = await $.tool.call({ tool: TOOL, source: FULL_ADDER, title: 'Full adder' })
  expect(first.deny).toBe(undefined)
  const text = String(first.result)
  expect(text).toMatch(/Rendered logic → 964×280px PNG/)
  expect(text).toMatch(/overlaps 0 \(verified\)/)
  const id = /id (\S+) ·/.exec(text)?.[1]
  expect(id).toBeTruthy()
  expect(files[`/home/t/.cache/show-figure/${id}.logic`]).toContain('Cout = or(C1, C2)')
  expect(ran.some(argv => argv[0] === '/bin/resvg')).toBe(true)

  const second = await $.tool.call({ tool: TOOL, base: id, source: 'place C1 above S1' })
  expect(second.deny).toBe(undefined)
  expect(String(second.result)).toMatch(/c1\[C1 S1\]/)
  const id2 = /id (\S+) ·/.exec(String(second.result))?.[1]
  expect(files[`/home/t/.cache/show-figure/${id2}.logic`]).toMatch(/#@patch\nplace C1 above S1/)

  const broken = await $.tool.call({ tool: TOOL, base: id, source: 'Z = and(Q, A)' })
  expect(broken.deny).toMatch(/^logic: line 1: unknown net 'Q'/)
  const missing = await $.tool.call({ tool: TOOL, base: 'nope', source: 'move S up 1' })
  expect(missing.deny).toMatch(/no logic figure with id 'nope'/)

  // A block defined once is remembered for later figures.
  const lib = await $.tool.call({ tool: TOOL, format: 'logic', source: 'block Acc { left: d[8]; right: q[8] }\ninput x[8]\nA = Acc(x)\noutput A' })
  expect(lib.deny).toBe(undefined)
  expect(files['/home/t/.cache/show-figure/blocks.logic']).toContain('block Acc')
  const reuse = await $.tool.call({ tool: TOOL, source: 'input y[8]\nB = Acc(y)\noutput B' })
  expect(reuse.deny).toBe(undefined)
})
