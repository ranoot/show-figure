export type Figure = {
  id: string
  title: string
  alt: string
  kind: 'svg' | 'mermaid'
  svgPath: string
  pngPath: string
  pxWidth: number
  pxHeight: number
  createdAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'show-figure': {
      figures: Shaped<Figure[]>
      /** Index into figures being shown; -1 means "the newest". */
      cursor: number
    }
  }
}
