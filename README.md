# show-figure

A Claude Code mod that lets Claude draw figures straight into your terminal.

It registers a `ShowFigure` tool. Claude passes it SVG or Mermaid source; the mod renders it to PNG and draws it inline in the transcript, right under the tool call (up to 20 rows tall). In the desktop app (and VS Code / mobile) the SVG is drawn natively instead. Every figure is also kept in a **Figure** pane (the last 30; page with ◀ ▶, or `p` / `n` while the pane has focus): `/figure` opens it and tells you if the terminal can't draw images, and it opens by itself when a figure can't be drawn inline.

Use it for anything you can express as SVG: diagrams, geometry, plots, memory layouts, UI sketches, illustrations — or Mermaid for quick flowcharts, sequence/state/class/ER diagrams, gantt charts and mind maps.

## Logic circuits and datapaths

With `format: "logic"`, Claude writes a netlist instead of an SVG, and the mod lays it out, routes the wires and draws it. A full adder takes about 45 tokens, where a hand-written SVG takes about 1,500:

```
input A B Cin
S1   = xor(A, B)
S    = xor(S1, Cin)
C1   = and(A, B)
C2   = and(S1, Cin)
Cout = or(C1, C2)
output S Cout
```

- **Gates:** `and or nand nor xor xnor not buf`, with 2 to 8 inputs; `!X` draws an inversion bubble.
- **Built-in blocks:** `mux(A, B, S=sel)`, `alu(A, B, op=…)` (`.Result`, `.Zero`), `adder`, `dff`, `jkff`, `tff`, `srlatch` (`.Q`, `.Qn`) and `reg`. Numbers such as `4` are constants.
- **Your own blocks**, with pins on any side and bus widths:

  ```
  block RegFile "Registers" { left: RR1[5] RR2[5] WR[5] WD[32]; right: RD1[32] RD2[32]; top: RegWrite }
  RF = RegFile(RR1=Instr[25:21], RR2=Instr[20:16], WR=WRmux, WD=WBmux, RegWrite=Ctl.RegWrite)
  ```

  Pins on the right are outputs. `top out:` makes one elsewhere, `~Pin` marks a control pin (drawn in blue when the figure has datapath blocks; a gate-level figure keeps every wire black) and `^Pin` a clock. A one-off can be written inline as `box "Label" { left: …; right: … }`. Blocks are remembered across calls, in `blocks.logic` in the cache folder.
- **Rearranging**, without coordinates: `place A above|below|left-of|right-of|same-row B`, `order col 2: A B`, `move A up|down|left|right [n]`, `col A 3`, `spacing 1.5`, `show names`, `remove A`.

**Nothing overlaps.** Layout and routing are built to keep gates, wires and labels apart, and every figure is checked again before it is shown. If a check fails, the layout is repaired and tried again. A figure that still can't pass is refused, never drawn wrong. A directive that conflicts with another is dropped with a warning.

**Cheap to iterate.** The result lists each column's contents, top to bottom, and gives the figure an id. To change something, Claude calls again with `base: "<id>"` and only the new lines, such as `place C1 above S1`. Same-named gates are replaced. Claude doesn't need to look at the PNG.

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
