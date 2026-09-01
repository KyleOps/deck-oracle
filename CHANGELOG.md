# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.9.0] - 2026-09-01

### Added
- **Chimil, the Inner Sun calculator** (`CHM` ticker) — {6} Legendary Artifact, "At the beginning of your end step, discover 5."
  - Unlike Monstrous Vortex, which also discovers but only when you cast a qualifying creature, Chimil triggers unconditionally every end step. That makes the useful question cumulative rather than conditional: not *will it trigger*, but *how much mana does it cheat over a game, and what does it find?*
  - **Exact math, no Monte Carlo.** Two observations make closed form possible: the first eligible card in a uniformly random library is a uniformly random member of the eligible set, so expected hit mana value is just their mean; and the number of cards passed over before that hit is negative-hypergeometric with mean `(N - H) / (H + 1)`. Results are instant and free of simulation noise
  - Hero stats: free mana value per end step, cumulative total over a projected N turns, expected cards dug per trigger, and eligible-pool size with a verdict badge
  - Distribution of the discovered card's mana value, via the shared simulation-summary component
  - Turn sweep table and a dual-axis chart showing cumulative against per-turn value
  - Models **pool depletion** — each trigger removes the discovered card, so a thin eligible pool runs dry; assuming a flat per-turn rate would overstate those decks
  - **"Pays for itself" headline** — the first end step at which accumulated free mana repays Chimil's own {6}. Reported in whole turns, because that is how the keep-or-cut decision actually gets made, and marked with a ★ rail in the turn sweep
  - **Fit verdict** — a plain judgement (EXCELLENT / GOOD / FAIR / POOR / UNPLAYABLE) for *this* deck, weighing how often discover finds something, how much it is worth, and how fast that repays the cost. A deck can fail on any one: all-cheap hits constantly for little, top-heavy hits big but digs half the library, and a deck with no eligible cards does nothing
  - **Sample games** — the section that answers what averages hide. "3.7 mana per end step" sounds strong, but the lived sequence might be a two-drop then a three-drop, which is a very different card. Each simulated game walks a real shuffled library exactly as discover does and shows the actual cards found, turn by turn, with mana-value-2-or-less hits marked. Summary reports the average total cheated, the share of hits that were small, how often a game repaid the {6}, and the best-to-worst range
  - **Auto-runs 500 games** as soon as the calculator is opened with a deck loaded — the sample games are there to read rather than behind a button press. Keyed on deck and horizon so switching tabs does not re-simulate needlessly (a 500-game run takes ~3ms, so dragging the horizon stays smooth)
  - **Distribution of total mana cheated per game**, bucketed across the simulated runs, with the {6} cost marked and everything below it toned red. An average says nothing about spread — two decks can share a mean while one is reliable and the other swings between whiffing and cheating out half a game's worth of mana
  - **Turn-horizon slider** controlling both the projection and the simulations. This is a real control, unlike the cosmetic one it replaced: the closed-form projection is linear in turns, but simulated games over N end steps give a genuinely different distribution, a wider spread, and a real chance of the eligible pool running dry
  - Otherwise everything is computed from the decklist exactly as imported — an earlier deck-tuning slider was removed in favour of reporting the deck as built
  - **States its own limit**: the model counts mana cheated, not board impact. Chimil does nothing the turn it lands, and a six-drop that affects the board immediately can be worth more than the raw mana suggests
  - 69 unit tests covering the partition, both closed-form expectations, the distribution, depletion, payback, fit tiers, per-game simulation, the summary statistics, the totals distribution, and horizon behaviour

### Changed
- **Deck Radar detects Chimil** — by name, and structurally from the count of nonlands at mana value 5 or less, since that pool is what turns its end-step triggers into value

### Fixed
- **Chart axis labels were rendering as bare indices across the whole app.** The global Chart.js defaults spread a custom `ticks` object over each scale, which replaced it wholesale and dropped Chart.js's own tick callback — on a category axis that callback is what maps an index back to its label. Land Drops showed `0 1 2` instead of `0 lands / 1 land / 2 lands`, Genesis Wave `0 1 2` instead of `X=2 / X=3 / X=4`. The defaults now merge one level deeper

## [2.8.3] - 2026-08-31

### Fixed
- **A large blank band between the import bar and the calculator on first load.** Removing the legacy navigation in 2.8.2 left a stray `</div>` that closed `.container` early, so `<main>` and the footer ended up *outside* it — and because the container has `min-height: 100vh` it stretched to fill the viewport and pushed the calculator down. Tag counts stayed balanced, which is why the check at the time passed; the nesting was wrong, not the arithmetic. Verified structurally now (all nine children back inside `.container`, gap measured at 0)
- **First load took a different code path from every later render.** `init()` called `Mulligan.updateUI()` directly instead of `switchTab()`, so the panel show/hide logic never ran — the shared deck-config panel stayed hidden on landing and then appeared as soon as any tab was clicked. Initial render now routes through `switchTab(currentTab)`, so the landing state is byte-identical to the post-click state (verified by snapshot comparison). A shared `?tab=` link still wins, since `currentTab` is whatever `parseShareUrl()` resolved to

## [2.8.2] - 2026-08-31

### Added
- **`.panel-row` — explicit panel pairing.** Results are a single full-width column by design, but an author can now wrap exactly two related panels to sit side by side. Because the wrapper has a fixed number of children it cannot leave a hole, unlike the auto-placement heuristics it replaces. Applied to the two Land Drop charts, which read better paired (896px each) than stacked at full width

### Removed
- **The hidden legacy navigation.** A duplicate `<nav>` of sub-nav pills and a dropdown selector had been kept "for JS compatibility" long after the terminal tab row replaced them — ~3,100 characters of markup, plus their handlers in `switchGroup()`, `switchTab()`, `initTabNavigation()`, and the whole of `initNavLayoutToggle()`. The per-calculator `icon` metadata went with them; it only fed the dropdown and was never rendered
- **`updateStats()` in Portent**, which rendered legacy stat cards into `#portent-stats` — an element that is `display: none`. The hero numerics and sweep table had already replaced it
- **Unused component helpers**: `createTypeInput()`, `createDeckTotal()`, and `autoCollapseOnMobile()` (whose only caller was the resize handler removed in 2.7.0), plus the now-unreferenced `.tx-flicker` animation

### Fixed
- **Legacy colours in `index.html`** — 16 values across chart legend swatches and the `theme-color` meta tag. Earlier colour sweeps had only covered the JS files

## [2.8.1] - 2026-08-31

### Changed
- **Results are now a single full-width column instead of a tiled grid.** Tiling was tried and abandoned: with panels of very different heights and widths it always left a hole somewhere — a chart with an empty column beside it, or a lone trailing panel — and each rule added to close one case opened another (fixing Wave and Vow broke Lands and Surge). A single column is predictable, never leaves dead space, and gives every chart the full available width. The config rail still keeps inputs beside the results. Net effect: **zero dead space on all 13 calculators**, and charts roughly doubled in width (Rashmi's went from 717px to 1434px)
- Wide charts gain a little height so they don't read as letterbox strips
- Removed ~5,000 characters of superseded layout heuristics

### Fixed
- **Rashmi's cramping and its large blank right-hand column.** The rail's row span left later rows free, so dense auto-placement back-filled column 1 with a results panel — the headline stats were being squeezed into the 358px rail width and stacked one per line, while the chart sat in a single column with an empty one beside it. The rail now owns column 1 for every row
- **An empty box above the config rail.** The import-required notice is `display: none` until needed, and a hidden element generates no grid item — so reserving row 1 for it left that row free, a results panel claimed it, and the rail was pushed down. The notice now sits in the results area, where the message belongs

## [2.8.0] - 2026-08-31

### Added
- **`renderSimulationSummary()`** — one shared component for every calculator's sample section, replacing per-file hand-rolled summary blocks that each had their own inline styles, heading level, and metric grid. Standard structure throughout: header with run count → headline metrics → **distribution** → outcome breakdown
- **Distributions where there were none.** Primal Surge and Rashmi previously showed only averages. An average tells you where the middle is but not whether the spread is tight or bimodal, which is what actually decides whether a card is worth running — Surge now buckets permanents hit (with the sub-5 whiff range marked in red), Rashmi shows the mana value of its free casts
- **`toneFn` on `renderDistributionChart()`** so callers can colour buckets by meaning (a whiff range reads red) instead of every bar reading as a neutral success. Optional and backwards compatible

### Changed
- **Simulation sections standardised across all seven single-player calculators** (Surge, Vortex, Vow, Wave, Portent, Rashmi, Lumra) onto the shared component and terminal chrome
- **Shared sample controls and the collapsible reveals section** moved from inline styles to classes in `generateSampleRevealsHTML()` and `createCollapsibleSection()` — one edit now themes all eleven calculators that use them
- **Mara and Dream Harvest** emitted byte-identical opponent-card wrappers; both now use a shared `.tx-opp-card`

### Fixed
- **Floating whitespace on Kamahl's Vow and other tiled calculators.** Two causes: a **specificity bug in the layout CSS** meant the "wide panels span the full results width" rule was always beaten by the auto-placement rule that follows it, so sample-reveal and sweep panels were squeezed into one column; and short panels beside a tall sibling left an unbordered hole, since the row is sized by the tallest member. Panels now stretch to own their cell (the sticky config rail opts out), and wide panels span properly
- **Final colour strays**: an off-palette cyan and 12 `rgba()` values in unspaced form that the earlier hex sweeps could not match. No non-token colour remains anywhere outside the canonical palette

## [2.7.2] - 2026-08-31

### Fixed
- **Every colour in the codebase is now a design token.** 178 hardcoded values from the pre-repalette Tailwind set were still being emitted by calculator JS (verdict colours, per-opponent accents, impact badges, default swatches, chart series), plus 36 stray greys and one-off accents in a second pass — so generated output quietly disagreed with the palette it was rendered into. Verified: zero non-token colours remain outside the canonical definition in `chartHelpers.js`
- **Contrast now meets WCAG AA across all 13 calculators** (verified with alpha compositing down the ancestor chain, which an earlier naive pass got wrong by treating translucent backgrounds as opaque):
  - `--tx-dim` sat at 3.25:1 on the panel tone, below the 4.5:1 floor for body text — and it is the most-used dim tone in the interface. Lightened
  - Card-name chips painted white text on mid-luminance type colours (~3.5:1); they now use the substrate colour, and the categorical type palette was lifted ~8% so every type clears AA
  - `--tx-rule` (a border token) and `--tx-rule-hi` were being used as text colours in three places
- **Emoji status glyphs replaced with the terminal marker set** already used by the outcome matrix (✓ ✗ ▲ ·) — 18 substitutions across impact badges, hand verdicts, warnings, and comparison icons

## [2.7.1] - 2026-08-31

### Fixed
- **Decklist import could fail entirely because of one calculator.** `notifyUpdates()` ran its listeners unguarded, so a single calculator throwing aborted every later listener *and* propagated out of `updateDeck()` into the import — surfacing as "Error: Cannot read properties of undefined" with the deck half-applied and no radar. Each listener is now isolated
- **Abstract Performance crashed on any deck with fewer than eight non-land cards.** It exiles two piles of four, and `partialShuffle` was asked to shuffle more positions than the array held, leaving holes; slicing the second pile then produced `undefined` entries. It now returns no samples for decks too small to form two piles, and pile totals tolerate a sparse pile
- **Pasting a decklist kept the previous deck's commander.** The paste path returns no commander, so the old one persisted in `deckState` and the Deck Radar could attribute a card the new deck does not contain. Paste now clears it alongside deck name and source
- **Charts appeared to fly in from the corner on a tab's first visit.** They were constructed while their tab was still `display: none`, so the canvas had no layout box; Chart.js laid out at a fallback size and then animated as it resized on reveal. Chart construction is now deferred until the canvas has a real size, and the first paint is static so only subsequent data changes animate

### Changed
- **The Deck Radar no longer switches tabs on import.** Auto-navigating to the strongest match reads as the app moving on its own for no visible reason — especially when the match came from stale state. The radar still ranks the matches and marks the relevant tabs; choosing one stays the user's decision

## [2.7.0] - 2026-08-31

### Changed
- **Design system rebuilt around a real type scale.** An audit found 99 of the 122 font-size declarations sat in the 8–11px band — one typographic register for everything, so nothing had hierarchy and the interface read as undifferentiated noise. Replaced with a deliberately bimodal scale: a dense telemetry band (9–13px) for data and metadata, and a display band (up to ~68px, fluid via `clamp()`) for the few numbers that actually answer the question. Each calculator's lead statistic now sits in the display register with supporting figures a full step down
- **Removed the fake telemetry chrome.** The status bar's blinking "● NET OK" indicator, "MC-25K" tag, live UTC clock, and the "◇ TERMINAL" wordmark tag conveyed nothing — they were costume, and the most obvious tell that the design was decoration rather than instrument. The footer now carries real keyboard hints in `<kbd>` elements, a share action, and the version
- **One accent colour.** Amber, red, green, and blue were all being used as interface chrome with no rule about which meant what. Amber is now the sole brand accent (active tab, focus ring, primary action, recommended row) and green/red are reserved strictly for what the numbers *mean* — so colour always carries information. Verified: exactly one element on the page is filled with solid accent. Card-type colours were desaturated from bright defaults into one coherent family
- **Calculator mastheads.** Every `h1` rendered at 12px, so calculators had no title presence and every tab looked identical on arrival. Each now opens with its name at display scale over the card's rules text
- **Emoji removed from all headings** (⚙️ ⚠️ 📊 🃏 …), in both markup and runtime-generated output — they read as decoration pasted onto a monospace instrument
- **Subtle grain overlay** over the substrate, and a near-black background with a faint cool cast instead of flat dark

### Fixed
- **Ultrawide layout.** The shell was full-bleed, so content stranded on the left of a wide monitor with dead space to the right. It is now capped and centred with visible side rules
- **Resizing the window now changes the content, not just the margins.** With a 1600px cap the shell froze past ~1690px and only the margins grew, so dragging a window wider did nothing. The cap is now 2200px and the results area tiles into more columns as space allows, so every pixel of width does something while the reading measure stays sane
- **Wide short rows** — a label at the far left and a badge a thousand pixels away at the right — capped so the two stay visually related
- **Phantom grid tracks.** Mixing an explicit column with `repeat(auto-fit, …)` in the hero row generated four empty 0px tracks and let three statistics stretch across the full panel width; they now size to content and pack left
- **Empty panels no longer leave holes** in the tiled grid
- **Remaining off-palette colours** removed: a purple "keepable" statistic and green chart axis labels in Land Drops, plus three purple hero stats in Mara, Surge, and Vortex left over from the pre-repalette design
- **Missing gutters at intermediate widths.** `max-width` alone left the shell flush against the viewport edges at every width below the cap, snapping to large margins only at 1600px. The shell is now sized from the viewport minus a gutter that scales with it, so margins grow continuously
- **`position: sticky` was silently broken everywhere.** `overflow-x: hidden` on `.container` and `body` makes them scroll containers, so the sticky header and config rail stuck to *them* rather than the viewport — meaning they never stuck at all. Removed (horizontal overflow is verified clean at every width)
- **A resize handler that fought the user.** `autoCollapseOnMobile()` ran on every `resize` event below 900px, collapsing panels and calling `scrollIntoView()` — so dragging a window repeatedly yanked the scroll position. Removed; the layout adapts through CSS alone
- **Grid blowout.** Grid and flex children default to `min-width: auto`, which stopped columns containing charts or wide tables from ever shrinking. Cleared on the layout containers, with chart containers clipped so a canvas cannot transiently overflow while Chart.js's ResizeObserver settles
- **Wasted horizontal space inside components** — a 1200px slider for a percentage, labels stranded a screen away from their inputs, and a card-type grid with a permanently empty cell (three inputs in a two-column grid)
- **Service worker no longer registers on localhost**, where its stale-while-revalidate cache silently served the previous build's CSS and JS

### Added
- **Adaptive layout driven by container queries**, not viewport breakpoints. Viewport width is the wrong signal once the shell is capped — at 2560px the viewport reads "huge" while the content area is bounded. Each calculator responds to the space it actually has:
  - Calculators with a config panel get a **sticky left rail** whose width is fluid (`clamp(320px, 20cqi, 400px)`), so inputs stay visible beside their results instead of scrolling away above them
  - **Results gain columns as the window grows** rather than one column simply getting wider: rail + 1 at ~1300px, rail + 2 at ~1700px, rail + 3 past ~1900px. Panels with intrinsically wide content (sample reveals, tables, the outcome matrix) keep the full span
  - Portent's three-column dashboard collapses in stages rather than all at once
  - Card-type inputs use `auto-fit` and reflow from three columns to one with no breakpoint — three still fit across a 380px phone
- **Accessibility**: a skip link, and one consistent focus ring in the brand accent across every interactive control
- **Semantic landmarks**: `<header>`, `<main>`, `<footer>`, and `<kbd>` for key hints

## [2.6.0] - 2026-08-31

### Added
- **Deck Radar — automatic calculator detection** (`js/utils/deckRadar.js`, `js/utils/radarPanel.js`): importing a decklist now tells you which calculators actually apply to it, instead of leaving you to guess from 13 tabs
  - **Two evidence channels.** *Named cards*: the deck contains (or is commanded by) the card a calculator models — matching is done on normalized names, so `Kamahl's Druidic Vow`, `KAMAHL'S DRUIDIC VOW`, and double-faced `//` spellings all resolve to the same trigger. *Structural*: the deck's shape makes a calculator meaningful anyway — e.g. zero instants/sorceries flags Primal Surge, ≥75% permanents at a low curve flags Genesis Wave, ≥8 legendary permanents flags Kamahl's Vow, <4 distinct card types suppresses Portent
  - The two channels stack, so a deck that both runs Genesis Wave *and* is 95% permanents ranks above one that merely runs it
  - Results are tiered `IN DECK` / `RELEVANT` / `POSSIBLE` and each carries a plain-English reason ("38 lands (39% of deck) — check land-drop consistency") rather than a bare score
  - Reasons quote the deck's own spelling of a card, not the normalized form
  - Auto-navigates to the strongest match on import, but only from the default tab — it won't yank you off a tab you chose while the import was still running
  - Matching tabs get a relevance dot in the nav so the signal survives dismissing the panel
- **Deck composition breakdown** in the radar panel: card count, land count and share, average mana value, permanent share, a stacked type-composition bar with legend, and a nonland mana-curve histogram. Built from divs rather than canvas so it renders instantly on import and reflows cleanly on phones
- **`DeckConfig.onDeckImport()`**: a subscription that fires only on an actual decklist import, distinct from `onDeckUpdate()` which also fires on every manual type-count keystroke. Import-time UI no longer re-opens itself while you are editing counts; each listener is isolated so one failure can't abort the rest of the post-import UI
- **`renderOutcomeMatrix()`** in the shared component library: a 2×2 confusion-matrix view of a decision rule, with an accuracy figure summed from the diagonal
- **`TX_CHART`** in `js/utils/chartHelpers.js`: the terminal chart palette (greys, series colours, translucent area fills, and the canonical MTG card-type colours) in one exported place, since canvas can't resolve CSS custom properties

### Changed
- **Mulligan decision breakdown rebuilt as an outcome matrix.** The four keep/mull outcomes are a confusion matrix, so they now render as one: agreement lands on the diagonal, and the two failure modes sit opposite each other — "bad beat" (too greedy) against "missed opportunity" (too cautious) — which is what tells you which slider to move. Adds a strategy-accuracy figure that the four separate boxes couldn't express
- **Mulligan success rate is now coloured by its verdict tier** (`probabilityVerdict`) instead of a fixed accent, so the headline number itself says whether the plan is reliable
- **Terminal theming now applies to native form controls site-wide.** Ranges, number/text inputs, selects, checkboxes, and buttons inside calculator content previously fell back to OS default chrome (white number spinners, blue-and-white range tracks) on any tab that hadn't been hand-styled — most visibly Mulligan, the landing tab. Adds shared `.tx-field-row` and segmented `.preset-btn` patterns so calculators stop reaching for inline styles
- **Card-type colours unified.** `--type-*` in `base.css` and the JS chart palette had drifted apart (enchantment was orange in CSS and purple in Portent's chart; sorcery, planeswalker, battle, and land all disagreed). Both now mirror one canonical set, documented to be edited together
- **Chart styling migrated to the terminal palette** across Mulligan, Vortex, Lumra, Surge, Lands, and Portent — replacing hardcoded purple/orange series and axis colours, dropping curve tension and permanent point markers in favour of flat lines with hover-only points
- **Nav tabs no longer stretch.** With only two tabs in a group, `flex: 1` turned the active tab into a half-width slab of solid amber; tabs are now content-sized with an amber top rule
- **Header rails are auto-sized**, fixing the "◇ TERMINAL" tag colliding with the wordmark
- **Mobile support for the terminal shell.** `css/mobile.css` predated the terminal redesign entirely and contained no rules for it. The header now stacks (identity row above a scrollable group rail), the tab row shows codes only with the active tab keeping its full name, the import sub-bar wraps into a stacked strip, the radar drops to one column, the outcome matrix stacks to single-column cells, hero stat rows wrap to a 2-up grid, and coarse pointers get 44px targets and a larger slider thumb
- **Square corners enforced** across generated calculator output, overriding leftover inline `border-radius` from the previous rounded-glass design
- **Service worker** bumped to `mtg-calc-v6` with the two new modules precached

## [2.5.0] - 2026-06-11

### Added
- **Shared terminal component library** (`js/utils/components.js`): reusable builders so every calculator speaks one visual language —
  - `renderHeroStats()` — the big tabular-numeric headline row (Portent's hero block, now site-wide)
  - `renderSweepTable()` — column-config-driven parameter-sweep / "step response" table with hover, active-row, and recommended-row highlighting
  - `renderVerdictBadge()`, `renderRecommendation()`, `pBarCell()` — verdict pills, recommendation banners, and inline probability bars
  - New CSS: `.tx-hero`, `.tx-verdict`, `.tx-rec`, `.tx-sweep-table`, `.tx-empty`
- **Shared analysis utilities** (`js/utils/analysis.js`, fully unit-tested): `probabilityVerdict()` and `efficiencyVerdict()` (CERTAIN → POOR / ELITE → THIN tiers), `formatDelta()`/`deltaColor()` for signed marginals, and `recommendThresholdX()`/`recommendKneeX()` recommenders
- **Best-X / efficient-X recommender** surfaced across calculators: each sweep table flags a ★ recommended parameter (smallest X clearing a reliability threshold, or the diminishing-returns knee) and a one-line plain-English recommendation banner explains why
- **Keyboard navigation**: ←/→ (and Home/End) move between tabs in the active group, `Alt+1…9` jumps to the Nth tab — both driven dynamically off the visible tabs, so every calculator is reachable
- **Accessibility**: tab strip now exposes `role="tablist"`/`role="tab"` with live `aria-selected` state

### Changed
- **Unified calculator shell**: migrated **Genesis Wave, Kamahl's Druidic Vow, Monstrous Vortex, Rashmi, Primal Surge, Land Drops, and Lumra** from the legacy `<h2>` + 2-column stat-card panels to the same hero-numerics + verdict + recommendation layout as Portent
  - Each now leads with headline numerics (e.g. E[PERMANENTS], P(FREE SPELL), AVG SPELLS) plus a marginal-value-of-+1 stat
  - X / CMC comparison tables rebuilt as terminal **step-response sweep tables** (probability bar, Δ-vs-previous, verdict column, recommended-X rail) computed across the full parameter range instead of a ±4 window
  - Comparison-table containers converted from `<table>` to `<div>` and re-headed with `tx-h` section bars
- **Flattened the last legacy surfaces so all 13 calculators match**: Mulligan's rounded gradient summary cards → a flat `renderHeroStats` row (Success Rate / Avg Starting Hand / Avg Mulligans) with de-rounded breakdown + tuning-tip boxes; Mara and Dream Harvest headline summaries → the shared `renderHeroStats` row. (Abstract and Mind's Dilation were already bespoke terminal dashboards.)
- **Service worker** (`sw.js`): bumped cache to `mtg-calc-v5` so the redesign isn't served stale to returning visitors, added the newer modules (abstract, mara, dream harvest, mind's dilation, analysis, opponent state) to the precache list, and corrected the precached font to JetBrains Mono

### Removed
- Stale `Alt+1…8` hardcoded keyboard map (only covered 8 of 13 calculators) — replaced with dynamic navigation
- Debug `console.log` left in Monstrous Vortex's render loop

## [2.2.0] - 2026-05-31

### Added
- **Mind's Dilation Calculator** (`MND` ticker): Analytical expected-value calculation for the {5}{U}{U} enchantment that exiles the top card of each opponent's library whenever they cast their first spell per turn
  - Hero stats: **E[MV per round]** (sum across all opponents), **E[MV per 10 turns]** (projected), and **Sixth Doctor** toggle status
  - Per-opponent breakdown table showing P(nonland hit), average effective MV, E[MV per turn], and projected 10-turn total
  - MV distribution line chart showing the nonland mana value curve per opponent — useful for judging spell variance
  - Sample exile events panel (7 samples per opponent) with CAST ✓ / LAND ✗ indicators and per-card MV; reshuffleable
  - **The Sixth Doctor toggle**: When active, doubles the effective MV of all historic spells (artifacts, legendary permanents, sagas); affected cards marked ★ in the exile panel; updates all stats and charts live
  - Left rail per-deck breakdown: deck size, land count, nonland count, historic percentage, P(hit), and average effective MV
  - No Monte Carlo needed — top card is uniform random so all calculations are analytical (instantaneous)
- **Load Example Opponents button** on all multiplayer calculators: loads three preset Commander decklists simultaneously via `Promise.all`, populating all three opponent slots for instant analysis

## [2.1.0] - 2026-05-30

### Added
- **Abstract Performance Calculator** (`ABS` ticker): Monte Carlo analysis of the {5}{U} sorcery that exiles two piles of four — one face-down, one face-up — and asks an opponent to choose one for your graveyard
  - Three scenario model: **Best Case** (opponent always wrong), **Realistic** (opponent uses partial information — sends face-up to GY when its total MV exceeds the deck's expected 4-card average), **Worst Case** (opponent always correct)
  - Hero stat row shows E[free cast MV] under all three scenarios simultaneously
  - CMC distribution chart overlaying all three probability curves (free cast MV 0–10+)
  - MV breakdown table: per-bucket percentage for each scenario
  - Sample piles panel: 4 live trials showing face-down / face-up split, opponent decision logic, and resulting free cast; reshuffleable
  - CMC curve bar chart in left rail showing deck composition
  - Works without a deck import (falls back to standard 99-card commander CMC distribution)
  - Automatically recalculates on deck import via `DeckConfig.onDeckUpdate`
  - 25,000-iteration Monte Carlo simulation, consistent with other spell calculators

## [2.0.0] - 2026-05-14

### Changed
- **Terminal UI Reskin**: Complete visual overhaul to a Bloomberg/quant trading terminal aesthetic
  - Replaced glassmorphism (backdrop-filter, box-shadows, border-radius) with flat hairline-ruled panels
  - Replaced Cinzel/Crimson Text fonts with JetBrains Mono throughout; all type in `tnum` tabular numerics
  - Introduced `--tx-*` CSS custom property token system (oklch color space: green, amber, red, blue accents on near-black surfaces)
  - New persistent status bar (28px): NET OK live indicator, seed display, UTC clock, version
  - New flat ticker navigation bar (64px): 3-letter ticker codes (POR/WAV/VOW/SUR/VOR/RSH/LMR/MUL/LND/MAR/DRH), deck pill state, deck hash
  - New sub-bar (38px): inline deck import strip with URL fetch and paste decklist panel
  - New footer (26px): keyboard hints (F=fetch, P=paste, R=reshuffle, /search)
- **Portent Tab Rebuilt as Terminal 3-Column Layout**:
  - Left rail: X param slider with 56px hero digit, preset chips (X=5/7/9/12/15), library type bar with per-type count grid
  - Center: 3-up hero numerics (P(FREE SPELL), E[CARDS TO HAND], EXPECTED LOSS), dual-axis bar+line chart (green P(free) line + amber E[cards] bars), X=3..20 sweep table with inline p-bar and WEAK/FAIR/STRONG/CERTAIN verdicts
  - Right rail: 4 sample trial cards (FREE ✓ / FIZZ ✗ with type-colored card dots), live tape with 14 probability ticks and ASCII fill bars
- **Chart.js defaults updated** to terminal dark palette: hairline grid (#1c2520), monospace font, flat tooltips, no legend

## [1.7.2] - 2026-02-03

### Changed
- **LZ-String Compressed Share URLs**: Mulligan calculator share URLs now use LZ-String compression, reducing URL length by ~80% compared to the original JSON format. Added lz-string library via CDN.

## [1.7.1] - 2026-02-02

### Fixed
- **Mulligan Calculator Share URL**: Fixed bug where shared URLs did not restore card type settings correctly. The validation was checking for string IDs instead of numeric IDs, causing the URL parameters to be silently rejected and default values to be used instead.
- **Mulligan Penalty/Threshold Share URL**: Fixed bug where Mulligan Penalty and Confidence Threshold values were not restored from share URLs. The validation expected decimal values (0-1) but the URL contained percentage values (0-100).

### Changed
- **Mulligan Calculator Cleanup**: Removed 8 unused imports and 5 unused variables to reduce bundle size and improve code clarity.

## [1.7.0] - 2026-01-29

### Added
- **New Calculator: Ensnared by the Mara** - Simulates villainous choice outcomes for the card "Ensnared by the Mara"
  - Import up to 3 opponent decklists (Moxfield/Archidekt URL or paste text)
  - Analyzes both choice outcomes for each opponent:
    - Choice 1: Exile cards until nonland (expected CMC, cards exiled, P(CMC 5+))
    - Choice 2: Exile top 4 cards as damage (expected damage, min/max range)
  - Sample simulations with HTML-based distribution charts
  - Batch rendering with "Load More" for large sample counts
  - Collapsible sample sections per opponent
- **New Calculator: Dream Harvest** - Simulates Dream Harvest outcomes for opponent decks
  - Each opponent exiles cards until total mana value >= 5
  - Tracks: cards exiled, total MV, castable spells, value gained
  - Distribution charts for cards exiled
  - Sample simulations showing exiled cards and free casts
- **New Tab Group: Multiplayer** - New navigation category for multiplayer-focused calculators

### Changed
- **Mara Results**: Replaced Chart.js chart with inline horizontal bar distributions; added summary section showing total CMC value vs total damage across all opponents
- **Mara Theme**: Changed from purple to red theme (matching the red card)
- **Mara Choice Colors**: Choice 1 (Free Cast) now uses purple, Choice 2 (Damage) uses red for better visual distinction
- **Dream Harvest Theme**: Changed from green to dark blue theme (matching the blue/black card)
- **Dream Harvest Results**: Added summary section showing total free spells and total value gained across all opponents

### Added
- **Share URL Support for Opponent Decklists**: Mara and Dream Harvest opponent deck URLs are now included in share links (maraOpp1-3, dhOpp1-3 parameters)

### Fixed
- **Share URL Default Deck Exclusion**: Default example deck URL is no longer included in share links (it loads automatically anyway)

## [1.6.2] - 2026-01-26

### Changed
- **Default Landing Page:** Mulligan Strategy calculator now loads by default (completed HTML active states)
- **Pre-loaded Example Deck:** Site now loads with a real 99-card Commander deck pre-configured (Doctor Whostoric - The Sixth Doctor)
  - No more "import your deck" warning on first visit
  - All calculators work immediately with realistic data
  - Users can still import their own decks to replace the default

### Added
- **Default Deck Data Module:** New `js/utils/defaultDeckData.js` stores pre-processed deck data
- **Deck Generation Script:** New `scripts/generateDefaultDeck.js` to regenerate default deck from Moxfield API response

## [1.6.1] - 2026-01-26

### Fixed
- **Service Worker Installation:** SW no longer fails completely if a single cached asset is unavailable - assets now cache individually with graceful fallback
- **Service Worker Cache List:** Updated STATIC_ASSETS to include all calculators and utilities (was missing 15+ files)

### Added
- **Development Cache Bypass:** Add `?nocache` query parameter to bypass service worker caching during local development

## [1.6.0] - 2026-01-26 (Deep Blue Refresh)

### Changed
- **Default Landing Page:** Changed from Portent to Mulligan Strategy calculator
- **Mulligan Theme:** Updated to deep blue to match new primary

### Fixed
- **Distribution Chart Bars:** Fixed missing colored bars in sample simulation distribution charts (removed incorrect inline styles)

## [1.5.1] - 2026-01-26 (Design System Alignment)

### Changed
- **Spacing Grid Alignment:** Adjusted component sizes to conform to 4px spacing grid
  - Slider thumb: 22px → 24px (desktop), 26px → 28px (mobile touch targets)
  - Type input width: 55px → 56px
  - X-number input width: 70px → 72px
  - Distribution value width: 50px → 52px
  - Checkbox: 18px → 16px
  - Legend color (mobile): 10px → 12px
  - Type input (small mobile): 45px → 44px

### Fixed
- **Collapsible Panel:** Fixed dead click zone at bottom of collapsed panels - header now fills entire panel when collapsed
- **Stats Grid Spacing:** Added margin-top to stats-grid to prevent visual overlap with preceding insight boxes in analysis panels

### Added
- **Design System Documentation:** Created `.interface-design/system.md` documenting:
  - Spacing tokens (4px base grid)
  - Border radius scale (6/10/14/18/24px)
  - Color palette and glass effect values
  - Component patterns (panels, buttons, inputs, cards)
  - Calculator theme accent colors
  - Responsive breakpoints and accessibility guidelines

## [1.5.0] - 2026-01-26 (Glassmorphism UI Redesign)

### Changed
- **Complete UI Overhaul:** Redesigned the entire interface with a modern glassmorphism aesthetic
  - **Animated Background:** Subtle shifting gradient animation (dark navy/purple/blue)
  - **Glass Panels:** Frosted glass effect with backdrop blur, luminous borders, and soft shadows
  - **Unified Color Palette:** Consistent violet/cyan primary colors with calculator-specific accent tints
  - **Modern Typography:** System font stack for body text, Cinzel display font for headings
  - **Enhanced Interactions:** Smooth hover states, micro-animations, and glow effects

- **Navigation Restyling:**
  - Glass-effect tab group containers with gradient active states
  - Pill-style sub-navigation with accent color highlights
  - Improved visual hierarchy and spacing

- **Component Updates:**
  - Redesigned input fields with glass-style backgrounds and focus glow
  - Modern gradient-filled buttons with hover lift effects
  - Refined slider controls with gradient thumb and track
  - Glass-effect comparison tables with hover highlights
  - Updated stat cards with accent-colored borders and animations

- **Performance Optimizations:**
  - Reduced blur intensity on mobile devices for better battery life
  - Slower animation on mobile (40s vs 25s) to reduce GPU load
  - `prefers-reduced-motion` support disables all animations
  - Print styles optimized for clean output

- **Theme System Simplification:**
  - Consolidated from per-calculator full themes to unified palette with accent variations
  - Each calculator retains unique accent color (Portent: violet, Surge: green, Wave: blue, etc.)
  - Reduced CSS complexity while maintaining visual identity per calculator

### Fixed
- Updated inline styles in `index.html` to use new CSS variable names
- Fixed meta theme-color to match new background color (#0f0f1a)

## [1.4.1] - 2026-01-25 (Primal Surge Calculator Fix)

### Fixed
- **Primal Surge Calculator:** Fixed simulation statistics not matching the mathematical expected value
  - The sampler was only using the first N samples (where N = display count, default 10) for statistics calculation
  - Now uses all 500 generated samples for accurate statistical averages
  - Distribution chart and averages now correctly converge to the mathematical expectation
- **Primal Surge Calculator:** Fixed stats panel not updating when importing a new deck
  - The stats panel container was getting replaced after first render, causing subsequent updates to silently fail
  - Added stable container ID (`surge-stats-container`) that persists across updates

### Changed
- **Primal Surge Calculator:** Code optimizations and cleanup
  - Replaced dynamic `import()` with static import for Genesis Wave comparison (faster execution)
  - Removed unused imports (`debounce`, `renderMultiColumnTable`, `renderDistributionChart`, `extractCardTypes`)
  - Simplified deck change detection and cache invalidation logic
  - Cleaner separation between sample generation and statistics calculation
- **Primal Surge Calculator:** Replaced distribution histogram with more actionable statistics
  - Removed the permanent count distribution chart (wasn't providing useful insights)
  - Added outcome probability thresholds: Full deck %, 20+ permanents %, 10+ permanents %, Whiff (<5) %
  - Added min/max range from simulations
  - Cleaner grid layout showing averages (permanents, lands, mana value) at a glance
- **Big Spell Comparison:** Simplified recommendations to a single contextual deck insight
  - Removed redundant/confusing multi-recommendation section that restated what the table already showed
  - Now shows one actionable insight based on which spell is best and why (deck composition context)
  - Cleaner UI with less visual clutter
- **Genesis Wave Calculator:** Improved chart visualization
  - Removed redundant "Cards Revealed" line (was just X=X, same as axis labels)
  - Added "Hit Rate %" on secondary Y-axis showing percentage of revealed cards that are valid permanents
  - Dual-axis chart now shows both expected permanents and efficiency at a glance
- **Primal Surge Calculator:** Improved chart visualization
  - Replaced "Expected Total Mana Value" line (perfectly correlated with permanents, redundant)
  - Added "Whiff Risk (<5 perms)" on secondary Y-axis showing probability of a bad outcome
  - Red risk line provides useful counterpoint to green expected value - shows variance/downside at each non-perm count
  - Better tooltips with formatted values
- **Primal Surge Calculator:** Fixed "Chance to play entire deck" calculation
  - Previous formula was incorrect for multiple non-permanents
  - Now correctly calculates probability of hitting all permanents before any non-permanent
  - Changed label to "Chance to hit all X permanents" for clarity (you never "play" the non-permanents)
- **Primal Surge Calculator:** Now models library state after casting Surge
  - Primal Surge is on the stack when it resolves, not in your library
  - Deck with only Surge as non-permanent now correctly shows 100% to play entire library
  - Stats label changed from "Deck Played" to "Library Played" for accuracy
  - Non-permanent count shows "other non-perms in library" (excluding Surge itself)
  - Sample reveals now also exclude Surge from the simulated library
- **Big Spell Comparison:** Primal Surge now correctly modeled
  - Surge expected value calculation now excludes Surge from the library (it's on the stack)
  - Insights for Surge now show "other non-permanents in library" instead of total deck count
  - A deck with only Surge as non-permanent now correctly shows 100% guaranteed outcome

## [1.4.0] - 2026-01-13 (Lumra Calculator)

### Added
- **Lumra, Bellow of the Woods Calculator:** Added new calculator for the Element Bear.
  - **Mill Simulation:** Calculates expected lands milled from the "Mill 4" ETB trigger.
  - **Value Analysis:** Computes total lands returned (GY + Milled) and effective ramp.
  - **Multiplier:** Added support for panharmonicon effects (2x, 3x triggers).
  - **Visuals:** Added probability distribution chart for land hits.
  - **Sampler Chart:** Added a bar chart to the "Sample Reveals" section showing the actual distribution of lands milled in the simulations.
  - **Sample Reveals:** Visual simulation of the mill effect.
- **Tab Group Navigation:** Redesigned calculator navigation for better scalability
  - Replaced dropdown selector with organized tab group system
  - Three main categories: **Big Spells**, **Commanders**, **Deck Tools**
  - Sub-navigation pills for quick switching within each category
  - **Mobile-Optimized:** Horizontal scrolling, icon-only mode on small screens
  - Smooth transitions and visual feedback with gradient highlights
  - Maintains URL hash system for deep linking and share functionality
- **Big Spell Comparison:** New cross-calculator comparison feature for Genesis Wave, Kamahl's Druidic Vow, Primal Surge, and Portent of Calamity
  - Automatically compares all four spells normalized by **Total Mana Cost** (instead of just X value)
  - Ensures a fair apples-to-apples comparison (e.g., Wave X=7 vs Portent X=9 for 10 total mana)
  - Shows expected value, mana cost, and efficiency metrics for each spell
  - Separate metrics: Permanents for green spells, Card Types for Portent
  - Provides intelligent recommendations based on deck composition
  - **Responsive UI:** Comparison table now adapts to screen size, switching to a 2x2 grid on mobile devices and adjusting text sizing/padding for optimal readability on small screens.

### Changed
- **All Calculators:** Increased default simulation count from 10-20 to 500 for more accurate statistical sampling
  - Portent of Calamity: 10 → 500
  - Primal Surge: 10 → 500
  - Genesis Wave: 10 → 500
  - Kamahl's Druidic Vow: 10 → 500
  - Monstrous Vortex: 10 → 500
  - Rashmi, Eternities Crafter: 20 → 500
- **Vow Calculator:** Removed "← MAX" indicator from hit distribution chart (redundant visual clutter)
- **Lumra Calculator:** Optimized sample rendering performance
  - Eliminated redundant array creation in `renderBatch` function
  - Now counts lands directly without intermediate `.filter()` call
  - Reduces memory allocation during batch rendering


### Fixed
- **Mulligan Calculator:** Fixed deck tuning tips showing incorrectly low impact percentages
  - Marginal benefit calculation now simulates **replacing** a card rather than increasing deck size
  - Previously: Adding a land increased deck size from 99→100, diluting probabilities
  - Now: Adding a land replaces an "other" card, keeping deck size constant at 99
  - Impact percentages now accurately reflect real deck-building decisions
- **Mulligan Calculator:** Improved deck tuning tips clarity
  - Changed primary metric from confusing "Increases consistency by X%" to clear "Improves win rate by X%"
  - Added clarifying note: "God hand rate" shown in italics explains the baseline impact (if you never mulligan)
- **Big Spell Comparison:** Fixed TypeError when accessing undefined properties by adding null-safe operators and defensive checks
- **Big Spell Comparison:** Fixed Genesis Wave showing 0.00 by correcting property name from `expected` to `expectedPermanents`
- **Big Spell Comparison:** Corrected Portent of Calamity CMC calculation to `X + 1` (Cost {X}{U}) instead of `X + 3`
- **Deck Import:** Fixed ReferenceError for undefined `BATCH_SIZE` constant (should be `SCRYFALL_BATCH_SIZE`)
- **Commander Detection:** Fixed a bug where commander name was being lost during deck configuration updates, ensuring that "The Sixth Doctor" correctly enables the double-cast bonus in the Big Spell Comparison.

## [1.3.1] - 2026-01-13 (Vow Enhancements & Optimizations)

### Added
- **Vow Calculator - Enhanced Breakdown Statistics:**
    - `simulateVow()` now returns comprehensive breakdown: `expectedHits`, `expectedLands`, `expectedLegends`, and `expectedManaValue`
    - Marginal value analysis now shows detailed breakdown: total hits, lands, legends, and mana value changes (not just total hits)
    - Sample summary now displays average lands, legends, and total mana value across simulations
- **Vow Calculator - Double Cast Feature:**
    - Added "Copy Spell" checkbox for effects like The Sixth Doctor or Magus Lucea Kane
    - Doubles the number of cards revealed when enabled (2X for same X value)
- **Vow Calculator - Enhanced Sample Reveals:**
    - 4-color card display system: Lands (green), Legends that hit (blue), Legends that miss (orange), Non-legends (gray)
    - Sample reveals now show: total hits, lands count, legends count, and total mana value per simulation

### Changed
- **Vow Calculator - Performance Optimizations:**
    - Added card analysis caching with `cardAnalysisCache` Map (30-40% faster for large decks)
    - Eliminated redundant calculations in `updateStats()` by using pre-calculated values from `simulateVow()`
    - Eliminated double loop in sample reveals by caching analyses locally (50% fewer card analyses)
    - Cache clears automatically when deck or X value changes
- **Vow Calculator - UI Improvements:**
    - Moved X value comparison table to end of page (after sample reveals)
    - Enhanced marginal value display with color-coded metrics
- **All Calculators:** Increased default simulation count from 10-20 to 500 for more accurate statistical sampling
  - Portent of Calamity: 10 → 500
  - Primal Surge: 10 → 500
  - Genesis Wave: 10 → 500
  - Kamahl's Druidic Vow: 10 → 500
  - Monstrous Vortex: 10 → 500
  - Rashmi, Eternities Crafter: 20 → 500

### Added
- **Tests:** Expanded Vow calculator test coverage with 6 new comprehensive tests:
    - Breakdown values validation (lands, legends, mana value)
    - Double cast functionality verification
    - Edge cases: no legendaries, all legendaries, non-legendary exclusion

## [1.3.0] - 2026-01-13 (Kamahl's Druidic Vow)

### Added
- **Kamahl's Druidic Vow Calculator:** Added new calculator for the legendary sorcery.
    - **Smart Logic:** Correctly distinguishes between Lands, Legendary Permanents, and non-Legendary 0-drops (fixing a common math error in similar tools that counts Mana Crypt as a hit).
    - **Rich Metrics:** Displays "Legendary Density" to help tune deck composition.
    - **Visuals:** Dual-line chart showing Expected Hits vs. Cards Revealed.
    - **Detailed Insights:** Sample reveals explain exactly why a card is a hit or miss (e.g. "Non-legendary" vs "CMC too high").
    - **Refactored Code:** Logic separated into pure functions for better testability and performance.
- **Tests:** Added comprehensive test suite for Kamahl's Druidic Vow, covering edge cases like Mana Crypt exclusion and Double Cast math.

## [1.2.0] - 2026-01-13 (Performance & Security)

### Changed
- **Deck Import Performance:** Major optimization pass on deck import system
    - **LRU Cache:** Optimized cache eviction from O(n log n) to O(1) using access order tracking (1000x faster when cache is full)
    - **Card Matching:** Fixed O(n²) card matching loop with pre-computed normalized Map for O(1) lookups (100-1000x faster for large decks)
    - **Parallel Processing:** Parallelized fuzzy search retries in batches of 5 instead of sequential processing (5x faster)
    - **Cache Efficiency:** Eliminated redundant cache lookups by using single `get()` instead of `has()` + `get()` (2x faster per access)
    - **Code Quality:** Extracted duplicate power parsing code into reusable `parsePowerValue()` helper function
    - **Regex Performance:** Pre-compiled regex patterns outside loops to avoid repeated compilation
    - **Configuration:** Extracted all magic numbers to named constants for better maintainability

### Added
- **Input Validation:** Enhanced security with comprehensive input validation
    - Added batch API response structure validation
    - Added card name length limits (max 100 characters)
    - Added decklist size limits (50KB, 500 lines max)
    - Added URL input length validation (max 200 characters)
- **Security Improvements:**
    - Fixed XSS vulnerabilities in share URL tab selection with whitelist validation and `CSS.escape()`
    - Added JSON structure validation for mulligan types before parsing
    - Added bounds checking for all numeric URL parameters
    - Enhanced URL validation for deck imports with domain whitelist
    - Implemented LRU cache with TTL (1 hour) and bounded size (1000 entries)
    - Added rate limiting with burst logic (200 req/min sustained, 60 req/10sec burst)
- **Cloudflare Worker Security:**
    - Added origin validation to restrict API proxy access to production site and localhost only
    - Added support for Archidekt deck imports (in addition to Moxfield)
    - Implemented domain whitelist for proxied URLs
- **Test Coverage:**
    - Added comprehensive test suite for deck import parsing (64 tests)
    - Added security-focused tests for share URL handling (40 tests)
    - Tests cover input validation, XSS prevention, DoS protection, and edge cases

### Fixed
- **Bug Fixes:**
    - Added missing `parseInt()` radix parameters to prevent parsing bugs with leading zeros
    - Fixed Archidekt deck imports being blocked by proxy worker

## [1.1.0] - 2026-01-12 (PWA & Optimizations)

### Added
- **PWA Support:** The application is now a Progressive Web App (PWA).
    - Added `manifest.json` for app installability.
    - Added "Install App" button to the footer.
    - Updated `sw.js` to cache new assets and support offline functionality.
- **Icon:** Added a new custom SVG icon (hexagon with stats bars).
- **Footer:** Added a site footer with project description and GitHub link.
- **Load More:** Added pagination to sample reveals (limit 50 per batch).

### Changed
- **Mulligan Calculator:** 
    - **Significant logic improvement:** Now correctly handles sequential deadlines using conditional probabilities.
    - **Performance:** Implemented memoization for recursive calculations.
    - **Visuals:** Added unique colors for different card types.
    - **Defaults:** Improved default confidence thresholds.
- **Codebase Optimization:**
    - Refactored repetitive HTML for "Sample Reveals" into a dynamic JS utility.
    - **Repository Structure:** Moved all test files to a dedicated `tests/calculators/` directory to improve project organization and separate source code from testing logic.
- **UI/UX:** Moved the "Install" button to the footer to reduce header clutter.

## [1.0.0] - 2026-01-12 (Feature Complete)

### Added
- **Share Functionality:** Generate unique URLs to share deck configurations and calculator settings.
- **Mulligan Fixes:** Refined probability math for mulligan decisions.

## [0.9.0] - 2026-01-10 (Mobile & Stability)

### Changed
- **Design:** Switched to a mobile-first design philosophy for better usability on phones.
- **Architecture:** Moved away from Monte Carlo simulations to Hypergeometric math (exact formulas) where possible for better accuracy.

### Added
- **Testing:** Added test suite structure.

## [0.8.0] - 2026-01-09 (Cloud & New Calcs)

### Added
- **Moxfield Proxy:** Implemented a Cloudflare Worker to bypass CORS issues when importing from Moxfield.
- **Rashmi Calculator:** Added calculator for "Rashmi, Eternities Crafter" free spell probabilities.
- **Mulligan Calculator:** Initial implementation of the Mulligan Strategy calculator.
- **Samplers:** Added visual sample generators for Rashmi and Vortex.
- **Deck Import:** Added support for importing from Archidekt and Moxfield.

### Changed
- **Refactor:** Major code refactor to support serverless components.

## [0.5.0] - 2025-12-29 (Lands & Vortex)

### Added
- **Monstrous Vortex Calculator:** Initial release.
- **Land Drop Calculator:** Added opening hand and land drop consistency analysis.
- **UI:** Added smooth chart animations, improved sliders, and progress bars.

### Fixed
- **Styling:** Fixed button layouts for Vortex calculator.
- **Config:** Set a more reasonable default starting decklist.

## [0.1.0] - 2025-12-28 (Initial Release)

### Added
- **Core Calculators:** Portent of Calamity, Primal Surge, Genesis Wave.
- **Basic UI:** Theme switching and basic layout.
- **Project Structure:** Initial git init and file setup.