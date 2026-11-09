import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Figure } from '../types'

const PLUGIN = 'show-figure'
const TOOL = 'ShowFigure'
const FULL_TOOL = `mcp__${PLUGIN}__${TOOL}`
const PANE = 'figure'
const KEEP = 30
// Terminal cells are roughly twice as tall as they are wide.
const CELL_ASPECT = 2
// An Image's `{ png }` source holds at most 2 MiB decoded.
const MAX_INLINE_PNG = 2 * 1024 * 1024
const MAX_SVG_CHARS = 131072

const figures = atom({ plugin: 'show-figure', key: 'figures' } as const, [] as Figure[], {
  shape: 'figures-1',
})
const cursor = atom({ plugin: 'show-figure', key: 'cursor' } as const, -1)

const DESCRIPTION = [
  'Render a static figure and show it to the user immediately in a docked "Figure" pane beside the chat',
  '(a real image in the terminal; native SVG on the desktop app). Use it to explain things visually:',
  'diagrams, architectures, flows, state machines, sequence diagrams, geometry, data sketches, annotated layouts.',
  '',
  'Input `source` is either a complete SVG document (`<svg xmlns="http://www.w3.org/2000/svg" viewBox=...>...</svg>`)',
  'or Mermaid source (flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, mindmap, ...).',
  '`format` is detected from the source when omitted (starts with "<" → svg).',
  '',
  'SVG tips: always set a viewBox; use plain <text> (no <foreignObject>, no external images/fonts, no scripts);',
  'font-family sans-serif / serif / monospace; the default background is white, so draw in dark colors',
  'unless you pass another `background`. Aim for roughly 16:9 or wider so it fits a side pane.',
  '',
  'The result gives the PNG path; Read it if you want to check the rendering. Each call adds to the pane\'s',
  'history (the user can page back). For interactive or shareable visuals, publish an artifact instead.',
].join('\n')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'A full SVG document, or Mermaid diagram source.' },
    format: { type: 'string', enum: ['svg', 'mermaid'], description: 'Omit to auto-detect.' },
    title: { type: 'string', description: 'Short title shown above the figure.' },
    alt: { type: 'string', description: 'One-sentence description, shown where images cannot be drawn.' },
    background: { type: 'string', description: 'Background color, default "white". "transparent" for none.' },
    theme: {
      type: 'string',
      enum: ['default', 'neutral', 'dark', 'forest'],
      description: 'Mermaid theme (Mermaid only).',
    },
    width: { type: 'number', description: 'Raster width in pixels, default 1600 (200-3000).' },
  },
  required: ['source'],
}

type Input = {
  source: string
  format?: 'svg' | 'mermaid'
  title?: string
  alt?: string
  background?: string
  theme?: string
  width?: number
}

// Module-level caches: rebuilt after a reload, which is fine.
let toolPaths: Record<string, string | null> = {}
let fonts: { sans?: string; serif?: string; mono?: string } | undefined

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? '/tmp'
}

async function cacheDir($: EngineInterface): Promise<string> {
  const xdg = await $.env.get('XDG_CACHE_HOME')
  return `${xdg ?? `${await home($)}/.cache`}/show-figure`
}

/** Finds a binary on PATH or in a few well-known install spots. */
async function findBinary($: EngineInterface, name: string): Promise<string | null> {
  const cached = toolPaths[name]
  if (cached !== undefined) return cached
  let found: string | null = null
  try {
    const which = await $.process.run(['which', name], { timeoutMs: 5000 })
    if (which.exitCode === 0 && which.stdout.trim() !== '') found = which.stdout.trim().split('\n')[0] ?? null
  } catch {
    // no `which`; fall through to the fixed spots
  }
  if (found === null) {
    const h = await home($)
    for (const dir of [`${h}/.cargo/bin`, `${h}/.local/bin`, `${h}/node/bin`, '/usr/local/bin', '/usr/bin']) {
      if (await $.fs.exists(`${dir}/${name}`)) {
        found = `${dir}/${name}`
        break
      }
    }
  }
  toolPaths[name] = found

  return found
}

async function fontFamilies($: EngineInterface) {
  if (fonts !== undefined) return fonts
  const ask = async (pattern: string) => {
    try {
      const r = await $.process.run(['fc-match', '-f', '%{family[0]}', pattern], { timeoutMs: 5000 })
      return r.exitCode === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : undefined
    } catch {
      return undefined
    }
  }
  fonts = { sans: await ask('sans-serif'), serif: await ask('serif'), mono: await ask('monospace') }

  return fonts
}

function tail(text: string): string {
  const lines = text
    .split('\n')
    .filter(l => l.trim() !== '' && !l.startsWith('Warning'))
  return lines.slice(-8).join('\n').slice(-1500)
}

async function mermaidToSvg(
  $: EngineInterface,
  dir: string,
  id: string,
  source: string,
  background: string,
  theme: string,
): Promise<string> {
  const mmdc = await findBinary($, 'mmdc')
  if (mmdc === null) {
    throw new Error(
      'mmdc (Mermaid CLI) is not installed. Install it with `npm i -g @mermaid-js/mermaid-cli`, or send SVG instead.',
    )
  }
  const mmdPath = `${dir}/${id}.mmd`
  const svgPath = `${dir}/${id}.svg`
  const configPath = `${dir}/mermaid-config.json`
  const puppeteerPath = `${dir}/puppeteer-config.json`
  await $.fs.write(mmdPath, source)
  // htmlLabels off: labels become SVG <text>, which resvg/rsvg can draw
  // (they cannot draw <foreignObject>).
  await $.fs.write(
    configPath,
    JSON.stringify({
      theme,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      class: { htmlLabels: false },
      state: { htmlLabels: false },
    }),
  )
  let chrome: string | null = null
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    chrome = await findBinary($, name)
    if (chrome !== null) break
  }
  await $.fs.write(
    puppeteerPath,
    JSON.stringify({
      ...(chrome !== null ? { executablePath: chrome } : {}),
      args: ['--no-sandbox', '--headless=new'],
    }),
  )
  const r = await $.process.run(
    ['mmdc', '-q', '-i', mmdPath, '-o', svgPath, '-c', configPath, '-p', puppeteerPath, '-b', background].map(
      (arg, i) => (i === 0 ? mmdc : arg),
    ),
    { timeoutMs: 60000 },
  )
  if (r.exitCode !== 0 || !(await $.fs.exists(svgPath))) {
    throw new Error(`Mermaid failed to render:\n${tail(r.stderr || r.stdout)}`)
  }

  return svgPath
}

async function svgToPng(
  $: EngineInterface,
  svgPath: string,
  pngPath: string,
  width: number,
  background: string,
): Promise<void> {
  const resvg = await findBinary($, 'resvg')
  if (resvg !== null) {
    const f = await fontFamilies($)
    const argv = [resvg, '-w', String(width)]
    if (background !== 'transparent') argv.push('--background', background)
    if (f.sans) argv.push('--sans-serif-family', f.sans)
    if (f.serif) argv.push('--serif-family', f.serif)
    if (f.mono) argv.push('--monospace-family', f.mono)
    argv.push(svgPath, pngPath)
    const r = await $.process.run(argv, { timeoutMs: 30000 })
    if (r.exitCode === 0) return
    throw new Error(`resvg could not render the SVG:\n${tail(r.stderr)}`)
  }
  const rsvg = await findBinary($, 'rsvg-convert')
  if (rsvg !== null) {
    const argv = [rsvg, '-w', String(width), '-f', 'png', '-o', pngPath]
    if (background !== 'transparent') argv.push('-b', background)
    argv.push(svgPath)
    const r = await $.process.run(argv, { timeoutMs: 30000 })
    if (r.exitCode === 0) return
    throw new Error(`rsvg-convert could not render the SVG:\n${tail(r.stderr)}`)
  }
  throw new Error(
    'Neither resvg nor rsvg-convert is installed. Install one: `cargo install resvg` or `sudo apt install librsvg2-bin`.',
  )
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Width and height from a base64 PNG's IHDR chunk (bytes 16-23). */
function pngSize(base64: string): { width: number; height: number } {
  const bytes: number[] = []
  for (let i = 0; i + 3 < 32 && i + 3 < base64.length; i += 4) {
    const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | Math.max(0, B64.indexOf(base64[i + k] ?? 'A')), 0)
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const u32 = (at: number) =>
    ((bytes[at] ?? 0) * 2 ** 24) + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0)
  return { width: u32(16), height: u32(20) }
}

async function showFigure($: EngineInterface, input: Input) {
  const source = typeof input.source === 'string' ? input.source.trim() : ''
  if (source === '') return { deny: '`source` is required: an SVG document or Mermaid source.' }
  const kind: Figure['kind'] = input.format ?? (source.startsWith('<') ? 'svg' : 'mermaid')
  const background = input.background?.trim() || 'white'
  const width = Math.round(Math.min(3000, Math.max(200, input.width ?? 1600)))
  const dir = await cacheDir($)
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const pngPath = `${dir}/${id}.png`

  let svgPath: string
  try {
    if (kind === 'svg') {
      if (!/<svg[\s>]/i.test(source)) return { deny: 'format is svg but the source holds no <svg> element.' }
      svgPath = `${dir}/${id}.svg`
      await $.fs.write(svgPath, source)
    } else {
      svgPath = await mermaidToSvg($, dir, id, source, background, input.theme ?? 'default')
    }
    await svgToPng($, svgPath, pngPath, width, background)
  } catch (err) {
    return { deny: err instanceof Error ? err.message : String(err) }
  }

  const { base64 } = await $.fs.read(pngPath, { as: 'bytes' })
  const { width: pxWidth, height: pxHeight } = pngSize(base64)
  const title = input.title?.trim() || (kind === 'mermaid' ? 'Diagram' : 'Figure')
  const figure: Figure = {
    id,
    title,
    alt: input.alt?.trim() || title,
    kind,
    svgPath,
    pngPath,
    pxWidth,
    pxHeight,
    createdAt: Date.now(),
  }
  await update($, figures, list => [...list, figure].slice(-KEEP))
  await update($, cursor, () => -1)

  // The inline drawing reads the two paths back out of this text, so keep
  // "PNG at <path>" and "SVG at <path>" in it.
  return {
    result: `Shown to the user inline under this call (also in the Figure pane, /figure). Rendered ${kind} → ${pxWidth}×${pxHeight}px PNG at ${pngPath} (SVG at ${svgPath}). Read the PNG to check it if needed.`,
  }
}

// ---- Inline drawing under the tool call --------------------------------

const INLINE_MAX_ROWS = 20
// The transcript indents a tool result; leave room for it.
const INLINE_INDENT = 6

type Png = { base64: string; width: number; height: number }
// Keyed by file path: a figure's files never change once written.
const pngCache = new Map<string, Png>()
const svgCache = new Map<string, string>()
// Tool calls whose inline drawing fell back to the pane already.
const paneFallbacks = new Set<string>()

function pathsFrom(output: unknown): { pngPath?: string; svgPath?: string } {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  return {
    pngPath: /PNG at (\S+?\.png)\b/.exec(text)?.[1],
    svgPath: /SVG at (\S+?\.svg)\b/.exec(text)?.[1],
  }
}

async function loadPng($: EngineInterface, path: string): Promise<Png> {
  const hit = pngCache.get(path)
  if (hit !== undefined) return hit
  const { base64 } = await $.fs.read(path, { as: 'bytes' })
  const png = { base64, ...pngSize(base64) }
  pngCache.set(path, png)

  return png
}

async function loadSvg($: EngineInterface, path: string): Promise<string> {
  const hit = svgCache.get(path)
  if (hit !== undefined) return hit
  const svg = await $.fs.read(path)
  svgCache.set(path, svg)

  return svg
}

/** Opens the pane once per call whose figure could not be drawn inline. */
function fallBackToPane($: EngineInterface, toolUseId: string) {
  if (paneFallbacks.has(toolUseId)) return
  paneFallbacks.add(toolUseId)
  void $.ui.open({ id: PANE, title: 'Figure' }).catch(() => undefined)
}

/** Cells for a picture: as wide as the transcript, at most 20 rows tall. */
function fitCells(pxWidth: number, pxHeight: number, columns: number) {
  const ratio = pxHeight / Math.max(1, pxWidth)
  let cols = Math.max(10, Math.min(255, columns - INLINE_INDENT))
  let rows = Math.max(1, Math.round((cols * ratio) / CELL_ASPECT))
  if (rows > INLINE_MAX_ROWS) {
    rows = INLINE_MAX_ROWS
    cols = Math.max(1, Math.min(cols, Math.round((rows * CELL_ASPECT) / ratio)))
  }

  return { cols, rows }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({
      name: 'figure',
      description: 'Show the Figure pane (figures drawn with ShowFigure)',
    })

    return next(e)
  })

  on('tool.call', { tool: FULL_TOOL }, async ($, e) => {
    return showFigure($, e as unknown as Input)
  })

  // The call's row: show the title rather than pages of SVG source.
  on('ui.render', { component: 'ToolUse', props: { tool: 'mcp__show-figure__ShowFigure' } }, async ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const input = (e.props.input ?? {}) as Partial<Input>
    const source = typeof input.source === 'string' ? input.source.trim() : ''
    const format = input.format ?? (source.startsWith('<') ? 'svg' : 'mermaid')
    const shown: Record<string, string> = { title: input.title?.trim() || 'Figure', format }

    return next({ ...e, props: { ...e.props, input: shown } })
  })

  // The result under the call: the figure itself.
  on(
    'ui.render',
    { component: 'ToolResult', props: { tool: 'mcp__show-figure__ShowFigure' } },
    async ($, e, next) => {
      if (e.props.isErrored || e.props.isExpanded === true) return next(e)
      const { pngPath, svgPath } = pathsFrom(e.props.output)
      if (pngPath === undefined) return next(e)
      const list = await read($, figures)
      const figure = list.find(f => f.pngPath === pngPath)
      const title = figure?.title ?? 'Figure'
      const alt = figure?.alt ?? title
      const columns = e.viewport?.columns ?? 80

      if (e.surface === 'terminal') {
        const els = $.ui.resolve(e)
        const { Box, Text } = els
        if (!('Image' in els) || els.Image === undefined) {
          fallBackToPane($, e.props.tool_use_id)
          return <Text dimColor>{`▣ ${title}: shown in the Figure pane (/figure)`}</Text>
        }
        const { Image } = els
        const png = await loadPng($, pngPath)
        const { cols, rows } = fitCells(png.width, png.height, columns)
        const source =
          (png.base64.length * 3) / 4 <= MAX_INLINE_PNG
            ? { png: png.base64 }
            : { file: pngPath, format: 'png' as const }

        return (
          <Box flexDirection="column">
            <Image key={`fig-${e.props.tool_use_id}`} source={source} columns={cols} rows={rows} alt={`▣ ${title}: ${alt}`} />
            <Text dimColor>{`${title} · /figure opens it in the pane`}</Text>
          </Box>
        )
      }

      const els = $.ui.resolve(e)
      const { Box, Text } = els
      const svg = svgPath === undefined ? undefined : await loadSvg($, svgPath)
      if (!('Svg' in els) || els.Svg === undefined || svg === undefined || svg.length > MAX_SVG_CHARS) {
        fallBackToPane($, e.props.tool_use_id)
        return <Text dimColor>{`▣ ${title}: shown in the Figure pane (/figure)`}</Text>
      }
      const { Svg } = els
      const ratio = figure !== undefined ? figure.pxHeight / Math.max(1, figure.pxWidth) : 0.5625
      // About 8 CSS px per cell across, 18 down: fit the width, cap the height.
      const width = Math.round(Math.min((columns - INLINE_INDENT) * 8, (INLINE_MAX_ROWS * 18) / ratio))

      return (
        <Box flexDirection="column">
          <Svg source={svg} alt={alt} width={width} />
          <Text dimColor>{title}</Text>
        </Box>
      )
    },
  ).catch(($, e) => {
    // A drawing the surface refuses: one caption line, and the pane instead.
    fallBackToPane($, e.props.tool_use_id)
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>▣ Figure: could not be drawn inline; shown in the Figure pane (/figure)</Text>
  })

  on('command.run', { command: 'figure' }, async $ => {
    const list = await read($, figures)
    const opened = await $.ui.open({ id: PANE, title: 'Figure' })
    if (list.length === 0) return { text: 'No figures yet. Ask Claude to draw something.' }
    if (!opened.isPlaced) return { text: `Figure pane waiting: ${opened.reason}` }

    // Re-send the shown picture: the engine says whether it can draw pixels here.
    const at = await read($, cursor)
    const figure = list[at < 0 || at >= list.length ? list.length - 1 : at]
    if (figure === undefined) return { text: 'Figure pane shown.' }
    const { base64 } = await $.fs.read(figure.pngPath, { as: 'bytes' })
    const probe = await $.ui.blit({ requestId: PANE, key: 'figure', source: { png: base64 } })
    if (probe.deny === undefined) return { text: 'Figure pane shown; the image is drawn.' }
    if (probe.fix === 'tmux-passthrough') {
      return {
        text:
          'Figure pane shown, but tmux is holding the image back: `allow-passthrough` and `focus-events` must both be on ' +
          '(`tmux set -g allow-passthrough on`). If they are on now, restart Claude Code inside tmux so it detects them again.',
      }
    }

    return { text: `Figure pane shown, but the image is not drawn: ${probe.deny}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, figures)
    const at = await read($, cursor)
    const index = list.length === 0 ? -1 : at < 0 || at >= list.length ? list.length - 1 : at
    const figure = index >= 0 ? list[index] : undefined
    const columns = Math.max(10, e.props.bodyColumns)
    const bodyRows = Math.max(6, e.props.scroll.bodyRows)

    const go = (to: number) => () =>
      update($, cursor, () => (to >= list.length - 1 ? -1 : Math.max(0, to)))

    if (e.surface === 'terminal') {
      const { Box, Text, Button, Image } = $.ui.resolve(e)
      if (figure === undefined) {
        return <Text dimColor>No figures yet. Claude draws here with ShowFigure.</Text>
      }
      // Fit the picture to the pane, keeping its aspect ratio.
      const maxRows = Math.max(3, bodyRows - 3)
      const ratio = figure.pxHeight / Math.max(1, figure.pxWidth)
      let cols = Math.min(255, columns)
      let rows = Math.max(1, Math.round((cols * ratio) / CELL_ASPECT))
      if (rows > maxRows) {
        rows = maxRows
        cols = Math.max(1, Math.min(cols, Math.round((rows * CELL_ASPECT) / ratio)))
      }
      rows = Math.min(255, rows)

      const { base64 } = await $.fs.read(figure.pngPath, { as: 'bytes' })
      const isInline = (base64.length * 3) / 4 <= MAX_INLINE_PNG
      const source = isInline
        ? { png: base64 }
        : { file: figure.pngPath, format: 'png' as const, generation: figure.createdAt }

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{figure.title}</Text>
            {list.length > 1 && (
              <Box flexDirection="row" gap={1}>
                {index > 0 && (
                  <Button key="prev" plain hotkey="p" onPress={go(index - 1)}>
                    ◀
                  </Button>
                )}
                <Text dimColor>
                  {index + 1}/{list.length}
                </Text>
                {index < list.length - 1 && (
                  <Button key="next" plain hotkey="n" onPress={go(index + 1)}>
                    ▶
                  </Button>
                )}
              </Box>
            )}
          </Box>
          <Image key="figure" source={source} columns={cols} rows={rows} alt={figure.alt} />
          <Text dimColor wrap="truncate-start">
            {figure.pngPath}
          </Text>
        </Box>
      )
    }

    // Desktop, editor and mobile draw the SVG itself, crisp at any size.
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    if (figure === undefined) {
      return <Text dimColor>No figures yet. Claude draws here with ShowFigure.</Text>
    }
    const svg = await $.fs.read(figure.svgPath)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{figure.title}</Text>
          {list.length > 1 && (
            <Box flexDirection="row" gap={1}>
              {index > 0 && <Button key="prev" label="◀ Prev" onPress={go(index - 1)} />}
              <Text dimColor>
                {index + 1}/{list.length}
              </Text>
              {index < list.length - 1 && <Button key="next" label="Next ▶" onPress={go(index + 1)} />}
            </Box>
          )}
        </Box>
        {svg.length <= MAX_SVG_CHARS ? (
          <Svg source={svg} alt={figure.alt} />
        ) : (
          <Text dimColor>
            {figure.alt} (SVG too large to draw here; PNG at {figure.pngPath})
          </Text>
        )}
      </Box>
    )
  })
}
