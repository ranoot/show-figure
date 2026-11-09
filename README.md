# show-figure

A Claude Code mod that lets Claude draw figures straight into your terminal.

It registers a `ShowFigure` tool. Claude passes it SVG or Mermaid source; the mod renders it to PNG and shows it in a docked **Figure** pane beside the chat. In the desktop app (and VS Code / mobile) the SVG is drawn natively instead. The pane keeps the last 30 figures; page through them with ◀ ▶ (`p` / `n` while the pane has focus). `/figure` reopens the pane and tells you if the terminal can't draw images.

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
- **A terminal that draws images:** kitty or Ghostty (kitty graphics protocol), or iTerm2 3.5+ with fullscreen rendering. Elsewhere the pane shows the figure's description and PNG path.
- **Inside tmux:** turn on passthrough (and keep `focus-events` on), then restart Claude Code:

  ```
  set -g allow-passthrough on
  set -g focus-events on
  ```

Rendered files go to `$XDG_CACHE_HOME/show-figure` (default `~/.cache/show-figure`).
