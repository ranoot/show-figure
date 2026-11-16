import { expect, test } from 'claude-code/testing'

// A real 1600x400 PNG (blank white), base64.
const PNG_HEAD = 'iVBORw0KGgoAAAANSUhEUgAABkAAAAGQCAYAAAD2lawGAAANMElEQVR4nO3ZAQ0AIAzAsIfg3zJcx9La6H1rAAAAAAAAQs4AAAAAAADECBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQI0AAAAAAAIAcAQIAAAAAAOQIEAAAAAAAIEeAAAAAAAAAOQIEAAAAAADIESAAAAAAAECOAAEAAAAAAHIECAAAAAAAkCNAAAAAAACAHAECAAAAAADkCBAAAAAAACBHgAAAAAAAADkCBAAAAAAAyBEgAAAAAABAjgABAAAAAAByBAgAAAAAAJAjQAAAAAAAgBwBAgAAAAAA5AgQAAAAAAAgR4AAAAAAAAA5AgQAAAAAAMgRIAAAAAAAQI4AAQAAAAAAcgQIAAAAAACQ8wFjjAcfu3qtEwAAAABJRU5ErkJggg=='
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><text x="10" y="50">hi</text></svg>'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function btoaBytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return out
}

function atobBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | Math.max(0, B64.indexOf(clean[i + k] ?? 'A')), 0)
    for (const shift of [16, 8, 0]) if (o < out.length) out[o++] = (n >> shift) & 255
  }
  return out
}

const PANE = {
  plugin: 'show-figure',
  component: 'Pane',
  requestId: 'figure',
  props: {
    title: 'Figure',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('ShowFigure renders an SVG and every surface draws it', async ($, on) => {
  const written: Record<string, string> = {}
  const ran: string[][] = []
  on('tool.register', () => ({ value: { tool: 'mcp__show-figure__ShowFigure' } }))
  on('command.register', () => ({ value: { command: 'figure' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_, e) =>
    e.as === 'bytes' ? { value: { base64: PNG_HEAD } } : { value: written[e.path] ?? SVG },
  )
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'which') {
      return { value: { exitCode: 0, stdout: `/bin/${e.argv[1]}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 0, stdout: e.argv[0] === 'fc-match' ? 'Noto Sans' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answer = await $.tool.call({ tool: 'mcp__show-figure__ShowFigure', source: SVG, title: 'Hello' })
  expect(answer.deny).toBe(undefined)
  expect(String(answer.result)).toMatch(/1600×400px/)
  expect(ran.some(argv => argv[0] === '/bin/resvg')).toBe(true)

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /Hello/ }))?.text).toBe('Hello')
  expect(await term.find({ type: 'Image' })).toBeTruthy()
  await term.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Svg' })).toBeTruthy()
    await ui.unmount()
  }
})

test('the figure draws inline under the call: Image on the terminal, Svg elsewhere', async ($, on) => {
  const written: Record<string, string> = {}
  on('tool.register', () => ({ value: { tool: 'mcp__show-figure__ShowFigure' } }))
  on('command.register', () => ({ value: { command: 'figure' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_, e) =>
    e.as === 'bytes' ? { value: { base64: PNG_HEAD } } : { value: written[e.path] ?? SVG },
  )
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'which' ? `/bin/${e.argv[1]}\n` : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answer = await $.tool.call({ tool: 'mcp__show-figure__ShowFigure', source: SVG, title: 'Inline' })
  const output = String(answer.result)
  expect(output).toMatch(/PNG at \/home\/t\/\.cache\/show-figure\/\S+\.png/)

  const RESULT = {
    plugin: 'show-figure',
    component: 'ToolResult',
    requestId: 'tu-1',
    viewport: { columns: 100, rows: 40 },
    props: { tool_use_id: 'tu-1', tool: 'mcp__show-figure__ShowFigure', output, isErrored: false },
  } as const

  const term = await $.ui.mount({ ...RESULT, surface: 'terminal' })
  const image = await term.find({ type: 'Image' })
  expect(image).toBeTruthy()
  expect((await term.find({ type: 'Text', text: /Inline/ }))?.text).toMatch(/Inline/)
  await term.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...RESULT, surface })
    expect(await ui.find({ type: 'Svg' })).toBeTruthy()
    await ui.unmount()
  }
})

test('an empty source is refused', async ($, on) => {
  on('tool.register', () => ({ value: { tool: 'mcp__show-figure__ShowFigure' } }))
  on('command.register', () => ({ value: { command: 'figure' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answer = await $.tool.call({ tool: 'mcp__show-figure__ShowFigure', source: '  ' })
  expect(answer.deny).toMatch(/required/)
})

test('a background session draws the figure as half-block cells, inline and in the pane', async ($, on) => {
  const written: Record<string, string> = {}
  const rasters = new Set<string>()
  on('tool.register', () => ({ value: { tool: 'mcp__show-figure__ShowFigure' } }))
  on('command.register', () => ({ value: { command: 'figure' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({
    value: e.name === 'HOME' ? '/home/t' : e.name === 'CLAUDE_CODE_SESSION_KIND' ? 'bg' : undefined,
  }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: rasters.has(e.path) }))
  on('fs.read', (_, e) => {
    const size = /\.(\d+)x(\d+)\.rgba$/.exec(e.path)
    if (size !== null) {
      // Solid red pixels, the size ffmpeg was asked for.
      const px = new Uint8Array(Number(size[1]) * Number(size[2]) * 4)
      for (let i = 0; i < px.length; i += 4) px.set([255, 0, 0, 255], i)
      return { value: { base64: btoaBytes(px) } }
    }
    return e.as === 'bytes' ? { value: { base64: PNG_HEAD } } : { value: written[e.path] ?? SVG }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === '/bin/ffmpeg') rasters.add(e.argv[e.argv.length - 1] ?? '')
    return {
      value: {
        exitCode: 0,
        stdout: e.argv[0] === 'which' ? `/bin/${e.argv[1]}\n` : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answer = await $.tool.call({ tool: 'mcp__show-figure__ShowFigure', source: SVG, title: 'Cells' })
  const output = String(answer.result)

  const inline = await $.ui.mount({
    plugin: 'show-figure',
    component: 'ToolResult',
    requestId: 'tu-2',
    surface: 'terminal',
    viewport: { columns: 100, rows: 40 },
    props: { tool_use_id: 'tu-2', tool: 'mcp__show-figure__ShowFigure', output, isErrored: false },
  })
  expect(await inline.find({ type: 'Image' })).toBe(undefined)
  const raster = await inline.find({ type: 'Raster' })
  expect(raster).toBeTruthy()
  const words = new Uint32Array(atobBytes(String(raster?.props.cells)).buffer)
  expect(words.length).toBe(Number(raster?.props.columns) * Number(raster?.props.rows) * 3)
  expect([words[0], words[1], words[2]]).toEqual([0x2580, 0xff0000, 0xff0000])
  await inline.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Image' })).toBe(undefined)
  expect(await pane.find({ type: 'Raster' })).toBeTruthy()
  await pane.unmount()

  const ran = await $.command.run({
    command: 'figure',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(String(ran.text)).toMatch(/background session/)
})
