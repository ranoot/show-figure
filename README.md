# show-figure

A Claude Code mod that lets Claude draw figures straight into your terminal.

It registers a `ShowFigure` tool. Claude passes it SVG or Mermaid source; the mod renders it to PNG and draws it inline in the transcript, right under the tool call (up to 20 rows tall). In the desktop app (and VS Code / mobile) the SVG is drawn natively instead. Every figure is also kept in a **Figure** pane (the last 30; page with ◀ ▶, or `p` / `n` while the pane has focus): `/figure` opens it and tells you if the terminal can't draw images, and it opens by itself when a figure can't be drawn inline.

Use it for anything you can express as SVG: diagrams, geometry, plots, memory layouts, UI sketches, illustrations — or Mermaid for quick flowcharts, sequence/state/class/ER diagrams, gantt charts and mind maps.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install show-figure --marketplace ranoot/show-figure
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it load in every session).

From a shell:

```
claude plugin install show-figure --marketplace ranoot/show-figure
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `ranoot/show-figure`, then Add plugin.

## Requirements

- **SVG → PNG:** [`resvg`](https://github.com/linebender/resvg) (`cargo install resvg`) or `rsvg-convert` (`sudo apt install librsvg2-bin` / `brew install librsvg`).
- **Mermaid (optional):** `mmdc` from `npm i -g @mermaid-js/mermaid-cli`. The mod points it at an installed Chrome/Chromium if it finds one, so you can install with `PUPPETEER_SKIP_DOWNLOAD=1`.
- **A terminal that draws images:** kitty or Ghostty (kitty graphics protocol), or iTerm2 3.5+ with fullscreen rendering. Elsewhere the figure is drawn as coloured half-block text cells (see below), or, failing that, as its description and PNG path.
- **Background sessions:** a background job draws into a virtual terminal that passes text but not images, so there figures are drawn as coloured half-block cells (`▀`, two pixels per cell, up to 40 rows inline). Shapes, plots and colours read; small text does not. This needs `ffmpeg` or `python3` with Pillow. Run Claude Code in the foreground for full-resolution figures.
- **Inside tmux:** turn on passthrough (and keep `focus-events` on), then restart Claude Code:

  ```
  set -g allow-passthrough on
  set -g focus-events on
  ```

Rendered files go to `$XDG_CACHE_HOME/show-figure` (default `~/.cache/show-figure`).
