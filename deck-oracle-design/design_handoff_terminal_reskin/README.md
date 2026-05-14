# Handoff: Deck Oracle — TERMINAL Reskin

## Overview
A full visual reskin of the Deck Oracle MTG probability suite into a **Bloomberg / quant trading terminal** aesthetic — dense, monospace, hairline-ruled panels, ticker-coded calculator tabs, giant numeric hero readouts, and live status/tape feeds. Functionality, math, and screen structure stay the same; this is purely a chrome + density overhaul.

The hero example shown in this prototype is the **Portent of Calamity** results screen, but the visual language is meant to apply uniformly across every calculator tab (Wave, Surge, Vortex, Rashmi, Lumra, Lands, Mulligan, Mara, Dream Harvest).

---

## About the Design Files

The files in this bundle (`canvas/terminal.jsx`, `canvas/portent-math.js`, `Terminal Preview.html`) are **design references** built in React + inline-styled JSX. **Do not** add React to the production codebase or copy these files in literally.

Implement this reskin **in the existing `KyleOps/deck-oracle` codebase** — vanilla ES6 modules, Chart.js, semantic HTML, and the existing `css/base.css` + `css/components.css` + `css/mobile.css` + `css/ux-enhancements.css` token/class architecture. The existing app already has:

- CSS-variable theming (`--theme-tint`, `--accent`, `--text-light`, `--glass-border`, `--bg-gradient-1`, etc.)
- A per-calculator `theme-*` body class swap
- A tab-group nav + sub-nav pill structure
- Per-calculator templates in `index.html` driven by `js/main.js`
- Chart.js for every chart

**The task is to add a new theme variant (or replace the current dark theme) using the existing CSS-variable plumbing, plus restyle the navigation chrome and add the few new structural elements listed in §"New structural elements"** — not to rewrite the JS app.

## Fidelity

**High-fidelity.** All colors, sizes, spacing, typography, and per-pixel measurements below are final. Recreate them exactly using the existing vanilla CSS/JS architecture.

---

## Design Tokens

Add these as CSS custom properties on `:root` (or under a `body.theme-terminal` selector if you want to keep the old skin available behind a toggle).

### Colors

```css
:root {
  /* Surface */
  --tx-bg:        #080a09;   /* page background — deep near-black, slight green undertone */
  --tx-panel:     #0e1311;   /* panel fill (header/status/cards) */
  --tx-panel-alt: #121815;   /* alternating row / hover surface */
  --tx-rule:      #1c2520;   /* hairline rule, default border */
  --tx-rule-hi:   #2a3530;   /* prominent rule (under header band etc.) */
  --tx-row-hi:    #161e1a;   /* selected/active table row */

  /* Text */
  --tx-dim:    #5a6b66;      /* labels, metadata, axis ticks */
  --tx-mid:    #8b9b95;      /* secondary text, sub-labels */
  --tx-text:   #d4dfd9;      /* primary body */
  --tx-bright: #ecf2ed;      /* hero numbers, focused values */

  /* Accents (oklch — share chroma/lightness, vary hue) */
  --tx-green:     oklch(0.78 0.18 145);   /* primary success / P(free) curve */
  --tx-green-dim: oklch(0.45 0.12 145);   /* dim green for inactive */
  --tx-amber:     oklch(0.82 0.16 80);    /* active state / focus / E[X] */
  --tx-amber-dim: oklch(0.55 0.12 80);    /* expected-cards bars */
  --tx-red:       oklch(0.68 0.20 25);    /* alert / FIZZ / loss */
  --tx-blue:      oklch(0.72 0.14 235);   /* secondary chart series */
}
```

### Type-color mapping (consistent across all calc panels)
```
Creature      → var(--tx-green)
Instant       → var(--tx-blue)
Sorcery       → oklch(0.72 0.16 290)
Artifact      → oklch(0.72 0.04 80)
Enchantment   → oklch(0.72 0.14 60)
Planeswalker  → oklch(0.68 0.20 0)
Land          → oklch(0.55 0.08 110)
Battle        → var(--tx-red)
```

### Type-code 3-letter abbreviations (used in chips, sample reveals, sweep tables)
```
Creature → CRE   Instant → INS   Sorcery → SOR   Artifact → ART
Enchantment → ENC   Planeswalker → PWK   Land → LND   Battle → BTL
```

### Typography

**Single family:** `'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace` — applied to the entire app, no serifs anywhere. Tabular numerals via `font-feature-settings: 'tnum' 1, 'cv01' 1; letter-spacing: 0.01em;`.

Type scale:

| Role | Size | Weight | Letter-spacing | Color |
|---|---|---|---|---|
| Status-bar text (top + bottom strips) | 10px | 400 | 0.12em uppercase | `--tx-dim` |
| Panel header (`.tx-h` band) | 10px | 500 | 0.16em uppercase | `--tx-dim` |
| Panel header — right text | 10px | 500 | 0.08em | `--tx-mid` |
| Tab code (3 letters) | 11px | 700 | 0.12em uppercase | varies |
| Tab name (next to code) | 10px | 400 | — | varies, opacity 0.75 |
| Body text | 11–12px | 400 | 0.01em | `--tx-text` |
| Table data | 11px | 400 | — | `--tx-text` |
| Table header | 9px | 500 | 0.12em uppercase | `--tx-dim` |
| Stat label | 10px | 400 | 0.16em uppercase | `--tx-dim` |
| Hero stat number (big) | **56px** | 600 | -0.02em | accent color |
| Hero stat number (medium) | 32px | 600 | -0.02em | accent color |
| Massive single-value (X param readout) | 56px | 700 | -0.02em | `--tx-bright` |
| Pill (`.tx-pill`) | 11px | 400 | 0.08em uppercase | `--tx-mid` |
| Keyboard-shortcut hints (footer) | 9px | 400 | 0.12em uppercase | `--tx-dim` |

**Critical:** numerics always use `font-feature-settings: 'tnum' 1` so columns line up. Pad time/seed values with leading zeros (`pad(n, 2)`).

### Spacing

- Status bars: **28px** top, **26px** bottom
- Main header band: **64px** tall
- Sub-bar (deck input row): **38px**
- Panel header band (`.tx-h`): 9px vertical / 14px horizontal padding, bottom-bordered with `--tx-rule`
- Panel inner padding: **16px** (or 14–18px context-dependent)
- Sample-reveal card: 12px vertical / 16px horizontal padding, bottom-bordered with `--tx-rule`
- Hero stat block: 20px vertical / 24px horizontal padding, right-bordered with `--tx-rule`
- Table cell: 6–8px vertical / 14px horizontal
- Hairline rule width: **1px solid var(--tx-rule)**
- Border-radius: **0 everywhere.** No rounded corners. No shadows. (Crucial — kills the current glassmorphism completely.)

### Layout grid (desktop, 1440 wide)

```
┌─ STATUS BAR  28px ─────────────────────────────────────────────────────┐
│ NET·OK   DECK-ORACLE://v2.4.1   ENGINE: MC-3000   SEED: 0x…   UTC TIME │
├─ HEADER  64px ─────────────────────────────────────────────────────────┤
│ DECK ORACLE wordmark │ calc tabs (POR WAV SUR VOR RSH LMR LND MUL …) │ deck-loaded pill │
├─ SUB-BAR  38px ────────────────────────────────────────────────────────┤
│ SRC »  [moxfield URL input]   OR   [paste textarea]   [FETCH ↵]    last-import meta │
├────────────────────────────────────────────────────────────────────────┤
│ ┌─────── 320px ─────┬──────────── flex ────────────┬─────── 320px ──┐  │
│ │ 01 · X PARAM      │  hero numerics (3-up)        │ 06 · SAMPLE     │  │
│ │   big X readout   │   P(FREE) · E[CARDS] · LOSS  │   REVEAL trial1 │  │
│ │   slider          │                              │   trial2        │  │
│ │   X chip presets  │  04 · KERNEL chart           │   trial3        │  │
│ │ 02 · LIBRARY      │   (220–280px tall)           │   trial4        │  │
│ │   stacked-bar +   │                              │ 07 · LIVE TAPE  │  │
│ │   type-code grid  │  05 · X SWEEP table          │   14 P-tick rows│  │
│ │ 03 · TRIGGER RULE │                              │                 │  │
│ └───────────────────┴──────────────────────────────┴─────────────────┘  │
├─ FOOTER  26px ─────────────────────────────────────────────────────────┤
│ ↑↓ SELECT X   R RESHUFFLE   F FETCH DECK   / SEARCH CALC   BUILD …   │
└────────────────────────────────────────────────────────────────────────┘
```

Three-column main grid: `grid-template-columns: 320px 1fr 320px;` separated by vertical hairlines.

---

## Screens

The terminal reskin applies to **every existing calculator tab** in `index.html`. Below is the spec for the hero example, the **Portent of Calamity** screen. Apply the same chrome + panel grammar to every other tab.

### Portent of Calamity — Results View

**Purpose:** Show the user, for their imported decklist, the probability that revealing X cards triggers Portent's "free spell" bonus (≥4 distinct card types) and the expected cards drawn to hand. Let them sweep X and see live sample reveals.

#### Components

**Status bar (top, 28px)** — fixed 12px-tall hairline rule below.
- Left: flashing green dot + `NET OK` text (animated opacity 1 → 0.45 → 1, 1.4s ease-in-out, infinite). CSS class `.tx-flicker`.
- Then comma-separated meta: `DECK-ORACLE://v2.4.1`, `ENGINE: MC-3000`, `SEED: 0x{hex}`.
- Right: live UTC clock `HH:MM:SS UTC`, then `FOLIO 01/01`.

**Header band (64px)** — `grid-template-columns: 320px 1fr 320px;`
- Left cell (`padding: 0 18px`): wordmark "DECK ORACLE". `DECK` is 22px/700, bright text. `ORACLE` is 22px/400, amber. After them: small "◇ TERMINAL" tag at 9px in `--tx-dim`.
- Center cell: horizontal flex row of calculator tabs. Each tab: 6px×10px padding, 11px text, 0.12em letter-spacing, uppercase, right-bordered with `--tx-rule`. Code (3 letters, 700) on left, name (10px, opacity 0.75) on right. **Active tab** has amber fill (`--tx-amber` background, `--tx-bg` text). Hover: `--tx-panel-alt` background, `--tx-text` color.
- Right cell: deck-loaded pill (`.tx-pill` — 2px×8px padding, 1px solid `--tx-rule`, panel fill, 11px uppercase, leading green dot). Format: "DECK LOADED · N=99". Faint hex hash next to it.

**Sub-bar (38px) — deck import row** — background `--tx-panel`.
- "SRC »" label (10px dim, 0.16em letter-spacing).
- 380px-wide URL input (placeholder: "moxfield.com/decks/…", or "paste decklist URL").
- "OR" separator (10px dim).
- 280px-wide text input ("paste decklist…").
- `FETCH ↵` button: transparent fill, 1px amber border, amber text, 5px×14px padding, 11px uppercase 0.12em. Hover: invert (amber fill, bg text).
- Right-aligned meta: "LAST IMPORT 04:11:22Z · 99 cards · hash a9·b4·e2" (amber on the hash code).

**Main grid (3 cols: 320px / 1fr / 320px)** — vertical hairlines between columns.

##### Left rail — input controls

Each subsection has a panel-header band (`.tx-h`): label on left like "01 · X PARAM", optional right-aligned annotation like "cards to reveal".

1. **01 · X PARAM** (16px inner padding)
   - Giant 56px/700 X value (in `--tx-bright`), `/ N=99` suffix in dim text, % of library on the right at 10px in `--tx-mid`.
   - Range slider 1–20 step 1 — track is 4px tall `--tx-rule`; thumb is **12×18px rectangle** in amber (no border, no radius).
   - Below slider: row of tick numbers 1 / 5 / 10 / 15 / 20 at 9px dim.
   - Then 5 preset chips: `X=5 X=7 X=9 X=12 X=15` — 1px rule border, 4px×10px padding, 11px. Active: amber fill, bg text.

2. **02 · LIBRARY** (right header text: `N=99`)
   - Single 14px-tall stacked horizontal bar (`.tx-bar`) showing type proportions. Each segment colored per the type-color map, `flex: ${count}`.
   - Below: 4-column grid of `(dot · code · count · %)` rows for each non-zero type. Dot is 6×6 type-colored; code is 10px dim; count right-aligned in `--tx-text`; % in 10px dim.

3. **03 · TRIGGER RULE** (right header: `>=4 types`)
   - Two-line body: "If reveal contains ≥4 distinct types, all X cards go to hand." (11px `--tx-mid`, line-height 1.55, with `≥4 distinct types` in `--tx-amber`).
   - Subline: "Method: hypergeometric · Monte Carlo 3,000 trials · seed-stable." (10px dim).

##### Center column — hero readout, chart, sweep table

1. **Hero numerics** — 3-column grid, each cell 20px×24px padded, right-bordered with `--tx-rule`.
   - **P(FREE SPELL)** — label, then 56px/600 number in `--tx-green` with `%` glyph, sub-label "x=N".
   - **E[CARDS TO HAND]** — same dimensions, 56px in `--tx-amber`, sub "x · p(free)".
   - **EXPECTED LOSS** — same dimensions, value `¢{9 - E[cards]}M` in `--tx-red`, sub "9 mana · breakeven".
   - All values use tabular numerals.

2. **04 · KERNEL chart** (header right: legend symbols)
   - Use **Chart.js** (already in the codebase). Plot two series on a 280px-tall chart:
     - P(free) as a step **line + tiny square points**, `--tx-green`, 0.5px stroke (or thinnest Chart.js gives, ~1px).
     - E[cards] as **bars in `--tx-amber-dim` at 55% opacity**, behind the line.
   - X axis: integer X values 1..20. Y left axis (0–100, P%, dim ticks). Y right axis (0–20, amber ticks).
   - Background grid: 1px `--tx-rule` horizontal at 25/50/75/100%; 0.5px verticals at every integer X.
   - **Current-X cursor**: dashed amber vertical line at `x = current`, dash pattern `0.5 0.5`.
   - X-axis labels show every-other X (1, 3, 5, …).

3. **05 · X SWEEP table** (header right: `columns: P(FREE), E[CARDS], Δ vs prev`)
   - Columns: `x | p(free) | p bar | E[cards] | Δp | verdict`.
   - Header row: 9px/500 dim, 0.12em uppercase, 8px×14px padding, bottom hairline.
   - Rows X=3..15 (skip extreme values). Row 6px×14px padding.
   - `p bar` column: 240px wide cell containing an 8px-tall bar (panel-fill bg + amber inner fill, 1px rule border).
   - `Δp` column: `+{Δ}%` in `--tx-green` if Δ > 5%, else `--tx-dim`.
   - `verdict` column: text labels and colors:
     - `p < 0.4` → "WEAK" in `--tx-red`
     - `p < 0.7` → "FAIR" in `--tx-amber`
     - `p < 0.9` → "STRONG" in `--tx-green`
     - else → "CERTAIN" in `--tx-green`
   - Active row (`r.x === currentX`): row background `--tx-row-hi`, color `--tx-bright`, X cell in 700 weight with a leading `▸` amber marker.
   - Clicking any row sets X to that value.

##### Right rail — sample reveals + live tape

1. **06 · SAMPLE REVEAL · X={x}** (header right: `[ ↻ RESHUFFLE ]` clickable)
   - Reshuffle bumps a seed counter → re-runs 4 fresh sample reveals.
   - Each trial card (12px×16px padding, bottom hairline):
     - Top row: `TRIAL 001` (9px dim) · spacer · `DIST` (9px dim) · distinct-count (`--tx-green` if ≥4, else `--tx-red`) · `FREE ✓` or `FIZZ ✗` (9px, green or red, 0.10em letter-spacing).
     - Body rows: one per revealed card. 8×8 type-color square + 3-letter code in dim + card name in `--tx-text` (truncate with ellipsis if too long).

2. **07 · LIVE TAPE** (P-tick feed)
   - 14 rows, each a 4-column grid `40px 40px 1fr 60px`, 4px×16px padding, bottom hairline.
   - Row content: `·{ss}` timestamp (dim), `x={x}` (bright), thin 4px green progress bar, `{P}%` right-aligned green.
   - Generated by sampling X randomly around current X each render — gives the impression of a live data feed.

**Footer (26px)** — keyboard-shortcut hints in dim 9px uppercase:
- Left: `↑↓ SELECT X`   `R RESHUFFLE`   `F FETCH DECK`   `/ SEARCH CALC`
- Right: `BUILD 2.4.1 · {ISO date}`

#### Mobile layout (≤ 480px)

Single column, status bar shrinks to 24px, header to ~52px, calculator tabs become a horizontal-scrolling strip showing only 3-letter codes. Hero numerics reduce to a 2-up grid (P + E only, no LOSS). Chart height 180px. Sample reveals: just 2 trials, cards laid out as wrapped 1px-rule chips inside each trial. Live tape can be hidden behind a collapsible.

---

## Interactions & Behavior

| Trigger | Effect |
|---|---|
| Drag X slider | Updates X readout, hero numerics, chart cursor, sample reveals, tape — all in one render. |
| Click X preset chip (X=5/7/9/12/15) | Sets X to that value. |
| Click any row in 05 · X SWEEP | Sets X to that row's value. |
| Click `↻ RESHUFFLE` | Re-generates the 4 sample reveals and the 14 live-tape rows. |
| Click any calculator tab | Switches calc (existing behavior — no change needed). |
| `Fetch ↵` | Existing import flow (no change to logic). |
| Top-bar `NET OK` indicator | Animated opacity 1 ⇄ 0.45 over 1.4s, infinite. Decorative only. |
| UTC clock | Updates every 1s. Format `HH:MM:SS`. |

All transitions: keep snappy / no fancy easing. The Bloomberg vibe is **instant** — values pop, they don't animate in. The only loops are the `NET OK` flicker and the clock.

---

## State Management

Reuse the existing per-calculator state in `js/calculators/portent.js`. The only new piece is:

- `currentX` (integer 1..20) — already driven by the existing slider; just rewire the new `.tx-slider` element + chip clicks + sweep-row clicks to call the existing setter.
- `sampleSeed` (integer) — bump on reshuffle, pass into the existing `sampleSimulator` util to vary the displayed reveals.

No new data fetching. The chart is the same Chart.js instance, just restyled.

---

## New structural elements (additions to `index.html`)

The current Portent tab has: stats panel, combined chart, comparison table, sample reveals, big-spell-comparison. Add or restructure as:

1. **Three-card hero numerics row** above the chart — `P(FREE SPELL)`, `E[CARDS TO HAND]`, `EXPECTED LOSS`.
2. **Live tape feed** (right rail) — new element. Can fall back to the existing big-spell-comparison panel on smaller screens.
3. **Top status bar + bottom footer status strip** — global, shared across all calculator tabs.

Everything else is restyling existing panels.

---

## Files

- `Terminal Preview.html` — open this for a side-by-side rendering of the **desktop (1440)** and **mobile (412)** artboards. The most important file for visual reference.
- `canvas/terminal.jsx` — React component containing all layout/styles, inline. **Reference only.** Sub-components inside: `TerminalView` (desktop), `TerminalMobile` (mobile), `TxChart` (the kernel chart — note: SVG, not Chart.js; reimplement with Chart.js options), `TxDeckStrip` (library type bar), `Stat` (hero stat cell), `useClock` (utility).
- `canvas/portent-math.js` — Reference Monte Carlo implementation showing the math contract for P(free) and E[cards]. The real app has equivalent logic in `js/calculators/portent.js`; **do not replace it**. This file is here so the implementer can sanity-check expected output ranges.
- `Deck Oracle — Reimagined.html` + `canvas/design-canvas.jsx` + `canvas/grimoire.jsx` + `canvas/app.jsx` — the original side-by-side design exploration. Not needed for implementation; included for context. Ignore everything in the GRIMOIRE direction.

---

## Implementation checklist

- [ ] Add `JetBrains Mono` to the existing Google Fonts `<link>` import in `index.html` (alongside or replacing Cinzel + Crimson Text).
- [ ] Add a new `theme-terminal` body class OR replace existing theme blocks. New CSS variables go in `css/base.css`.
- [ ] Set `border-radius: 0` on every component-shaped element in `css/components.css`. Remove glassmorphism — replace `backdrop-filter`, `background: rgba(...)`, and shadow rules with the flat panel fills above.
- [ ] Restyle `.tab-group-btn` and `.sub-nav-pill` to match the ticker-tab pattern (3-letter code + name).
- [ ] Restyle `.panel`, `.panel-header`, `.collapsible-panel` to the hairline-ruled flat-panel pattern with the dim 10px uppercase header band.
- [ ] Rebuild the Portent results layout per §"Portent of Calamity — Results View".
- [ ] Apply the same chrome (status bar, header band, sub-bar, panel grammar) to **every** other calculator tab — only the inner panels per calc change.
- [ ] Restyle Chart.js for all charts: dark `--tx-bg` background, hairline `--tx-rule` gridlines, green/amber/red strokes, **no gradients, no glow, no shadows**, axis labels in 9px dim. Set `Chart.defaults` globally where possible.
- [ ] Replace emoji icons (`⚡🌊🌿🌀🌌🐻🏔️🃏`) with the 3-letter type codes / calc codes throughout. Emoji are off-vocab for the terminal aesthetic.
- [ ] Mobile (≤480px): single column, scrollable tab strip, condensed hero numerics (2-up).
- [ ] Add the live UTC clock + flickering NET OK indicator + footer keyboard-shortcut hints.
- [ ] Add the LIVE TAPE simulator on the Portent tab (and any other calc that wants a rail).

---

## Notes / open questions for the user

- The deck-input ticker-strip currently shows two text inputs side-by-side; the existing app has them stacked. Either layout works — the side-by-side fits the dense aesthetic better.
- The "EXPECTED LOSS" hero stat (`¢{9 - E}M`) is a flourish, not present in the original. Drop it if it's misleading vs. the existing comparison-table logic.
- The LIVE TAPE is decorative storytelling. If it adds maintenance cost or feels gimmicky in dev, cut it — the right rail can hold any other secondary read-out (big-spell-comparison etc.).
- All sample/mock data in the prototype (deck name "Aetherveil Control", seeds, hashes) is placeholder — replace with the actual imported decklist's name + a hash of its contents.
