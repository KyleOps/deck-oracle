# Project-Specific Instructions for Codex

## Project Overview

**Deck Oracle** — a single-page app of Magic: The Gathering probability tools.
Vanilla ES modules, no build step. Import a deck (Moxfield, Archidekt, pasted
list, or bare type counts) and every page answers one question about it in plain
words, then shows the evidence. Works for Commander (one commander, partners,
a Doctor and companion, a commander and background), 60-card and 40-card decks.

**Tech Stack**: Vanilla JavaScript (ES modules, lazy-loaded per page), Chart.js
(loaded on demand, pinned), CSS custom properties (light + dark themes), PWA
with a service worker.

---

## Directory Structure

```
mtgcalcs/
├── index.html              # App shell only: sidebar, top bar, dialogs, drawer (no calculator markup)
├── manifest.json, sw.js    # PWA (sw.js asset list is GENERATED — npm run sw:manifest)
├── docs/calculator-anatomy.md  # How a calculator page is built — read before adding one
│
├── js/
│   ├── main.js             # Bootstrap: shell, deck state, shortcuts, share links, service worker
│   ├── shell/              # App chrome
│   │   ├── router.js       # ?tab= routing, history, lazy mount, preloads, render stamps
│   │   ├── sidebar.js      # Navigation, breadcrumbs, deck switcher, mobile drawer
│   │   ├── pageHeader.js   # Shared page header + "How it works" guide drawer
│   │   ├── palette.js      # Ctrl/Cmd+K command palette (calculators, cards, actions)
│   │   ├── deckDialog.js   # Import / saved decks / manual counts dialog (+ the #deck-* inputs)
│   │   ├── opponentBar.js  # Opponent decklists bar (loaded only on multiplayer pages)
│   │   ├── overlays.js     # Tooltips, glossary terms, card previews, toasts
│   │   ├── theme.js        # Light/dark theme
│   │   └── vendor.js       # On-demand third-party scripts (Chart.js, LZ-String)
│   ├── calculators/<key>.js  # Page glue: readInputs() → model → render; init(), updateUI(), calculate()
│   ├── views/<key>.js        # Page markup (template), scoped CSS (styles), guide
│   ├── data/
│   │   ├── cards.js        # Static card metadata for page headers (Scryfall snapshot)
│   │   └── glossary.js     # Plain-language terms; term(), cardRef(), escapeHtml()
│   └── utils/
│       ├── models/<key>.js     # Each page's pure maths (no DOM, no deck state); cardList.js, opponentLibrary.js
│       ├── calculatorRegistry.js  # THE catalog: every page's name, group, question, loaders
│       ├── deckConfig.js       # Deck state (single source of truth), commanders, format, saved decks
│       ├── commanders.js       # Command zone: names, labels ("A + B"), deck size (98 + 2 = 100)
│       ├── library.js          # The library (commanders never in it), card typing, name keys
│       ├── deckLibrary.js      # Saved decks in localStorage
│       ├── decklistImport.js   # Import pipeline (loaded on first import via importLoader.js)
│       ├── decklistParse.js / scryfall.js / deckSites.js / fetchJson.js  # Parse, Scryfall, Moxfield/Archidekt, timeouts
│       ├── format.js           # Commander / 60 / 40 rules (draws, free mulligan)
│       ├── mana.js             # Mana costs, pips, land colours, colour identity
│       ├── ramp.js             # THE ramp rule, read from rules text (every page counts ramp here)
│       ├── cardTags.js         # Draw / removal / … roles from rules text (ramp via ramp.js)
│       ├── deckStats.js        # Curve, colour sources, land odds, health checks
│       ├── deckRadar.js        # Which card calculators apply to a deck
│       ├── manaDevelopment.js  # Goldfish engine behind Mana Development
│       ├── hypergeometric.js   # Exact draw maths
│       ├── random.js / stats.js / text.js  # Seeded RNG + shuffle, one percentile rule, pct()/plural()
│       ├── simulation.js       # Caching, debounce
│       ├── components.js       # renderBottomLine, renderHeroStats, tones, sweep tables
│       ├── viz.js              # HTML charts: dot plots, heat strips, bullets, dumbbells
│       ├── chartHelpers.js     # createOrUpdateChart (built after the answer paints), withAlpha, chart palette
│       ├── turnOrder.js        # The shared play/draw control
│       ├── bigSpells.js        # Big-spell page kit (X input, samples, sweep, shared CSS)
│       ├── opponentPages.js    # createOpponentPage() for the multiplayer pages
│       ├── opponentState.js    # Opponent decks: state and imports
│       ├── share.js            # Share links (pages declare shareInputs / share hooks)
│       └── …                   # discover.js, payback.js, castability.js, drawOdds.js, handLab.js, …
│
├── css/
│   ├── tokens.css          # ALL colours, type, radii, shadows, spacing — dark + light themes
│   ├── base.css            # Reset, typography, type primitives (.tx-eyebrow, .tx-caption, …)
│   ├── components.css      # Shared calculator primitives only (page-only CSS lives in view styles)
│   ├── shell.css           # Shell, page header, dialogs, palette, drawer, overview
│   └── mobile.css          # Viewport-level responsive + print
│
├── scripts/update-sw-manifest.mjs  # Regenerates sw.js assets, index.html modulepreloads + page map
├── .github/                # CI/deploy, CodeQL, "Update visual baselines" workflows; Dependabot
└── tests/
    ├── node-test-helper.js # DOM mocks for headless tests
    ├── helpers/            # timing.js (medianMs, budget), assert.js
    ├── models/             # Pure maths of each page (no DOM mocks)
    ├── calculators/        # Page glue
    ├── utils/ performance/ # *.node.test.js (node:test)
    ├── fixtures/           # API-shaped deck-site responses, reference engines
    ├── e2e/                # Playwright: app, cast, import, manadev, router, serviceWorker, share, performance (budgets)
    └── visual/             # Playwright screenshot comparisons (Linux baselines made by CI)
```

---

## Architecture

### Data flow
```
import (lazy) ─▶ deckConfig (state + commanders + format) ─▶ library.js ─▶ models ─▶ calculators (visible page)
                                                          ─▶ shell (deck switcher, nav marks, header badge)
                                                          ─▶ share.js (links)
```

### The library
Commanders are never in the library: `libraryOf()` removes every command-zone
name in Commander, whether or not the list includes them. A page that casts a
specific card also removes that copy (`exclude`). Build every library through
`library.js`; never hand-roll one.

### Pages are lazy
The router renders the shared header, injects `views/<key>.js` → `template`
into `#<key>-tab .calc-body`, injects `styles`, then calls the module's
`init()` once and `updateUI()` on a visit when something the page shows has
changed (deck, theme, opponents, or a render it missed while hidden). A page
whose output depends on other state must call `owesRender()` or be listed in
`RENDER_EVERY_VISIT` in `router.js`. A calculator's DOM does not exist until
its page has been opened — **never read another calculator's DOM** (use the
page's model, a pure function with explicit inputs).

### Design system
Tokens in `css/tokens.css`; charts read the same tokens at runtime
(`applyChartTheme`). One accent (`--tx-accent`) marks the active / primary /
recommended thing; `--tx-good` / `--tx-warn` / `--tx-bad` carry meaning about
results only. Sans (Geist) for reading, mono (Geist Mono) for numbers, serif
(Crimson Pro) only for card rules text. No hex colours outside tokens.css and
chartHelpers.js. Inputs and selects use `.field` / `.field-sm`; calculator
layout responds only through `@container shell (…)`. CSS shared by several
pages is scoped to a root class and injected once.

---

## Testing Requirements

When making code changes to this project:

1. **Always check for tests** - Before and after making changes:
   - Look for test files in the `tests/` directory
   - Test files follow the pattern `tests/**/*.node.test.js`
   - Run tests with: `npm test`
   - Run correctness checks with: `npm run lint`

2. **Update tests when needed**:
   - If you modify function signatures or behavior, update corresponding tests
   - If you add new functionality, add test coverage
   - Ensure all tests pass before completing a task

3. **Run relevant tests**:
   - For a page's maths: `node --test tests/models/[name].node.test.js`
   - For a page's glue: `node --test tests/calculators/[name].node.test.js`
   - For full test suite: `npm test`
   - For app-shell, navigation, sharing, or deck-input changes: `npm run test:e2e`
   - For the complete CI-equivalent check: `npm run check`

4. **CI gates** (a pull request can't merge until they pass):
   - **Coverage**: `npm run test:coverage` fails if line / branch / function
     coverage of `js/utils/**` (models included) and `js/data/**` drops below
     84 / 84 / 83%. Every module there must load in plain Node
     (`tests/utils/moduleLoad.node.test.js`), so a new untested module lowers
     the numbers instead of hiding.
   - **Performance budgets**: `tests/e2e/performance.spec.js` (run by
     `npm run test:e2e`, after the functional tests). If a change really needs
     more, re-measure as its header explains (`--workers=1`) and raise the
     budget in the same PR with a reason; lower budgets when you make things
     faster. Time limits in unit tests use `medianMs()` and `budget()` from
     `tests/helpers/timing.js`: never a single timed run, and coverage
     instrumentation (about 5× slower) scales the limit.
   - **Screenshots**: CI compares key pages against
     `tests/visual/__screenshots__/linux/` (300 px allowed for Chromium's
     glyph noise). After a visual change, run the "Update visual baselines"
     workflow on your branch and commit its artifact. Never commit baselines
     made on Windows or macOS.

## Documentation Requirements

When making code changes:

1. **Always check for CHANGELOG.md**:
   - This project maintains a CHANGELOG.md file
   - Follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format

2. **Update CHANGELOG.md when making changes**:
   - Add entries under the appropriate version section (or create a new version)
   - Use semantic versioning guidelines:
     - PATCH (x.x.1): Bug fixes, performance improvements
     - MINOR (x.1.0): New features, enhancements (backwards compatible)
     - MAJOR (1.0.0): Breaking changes
   - Categorize changes appropriately:
     - **Added**: New features
     - **Changed**: Changes to existing functionality
     - **Fixed**: Bug fixes
     - **Removed**: Removed features

3. **CHANGELOG Entry Quality**:
   - Be specific and descriptive
   - Focus on user-visible changes
   - Include performance improvements with estimated impact when applicable
   - Reference specific function names or files when helpful

## Adding New Calculators

Complete ALL of these (see docs/calculator-anatomy.md for the details):

1. **Registry entry** in `js/utils/calculatorRegistry.js`: name, 2–3 letter
   `short`, `group`, `card` (add the card to `js/data/cards.js` if new),
   `question` (ends in "?"), `summary`, `method`, `keywords`, `charts: false`
   if it draws none, and the `load` / `view` dynamic imports. Navigation,
   search, the header and the overview pick it up automatically — do NOT add
   markup to `index.html`.
2. **Model**: the maths in `js/utils/models/<key>.js` — pure, takes a Library
   and plain inputs, caches on the library's identity.
3. **Logic**: `js/calculators/<key>.js` with `readInputs()` (DOM + deck →
   plain object) and `init()` / `updateUI()` / `calculate()`; use
   `registerCalculator()` / `isCalculatorActive()`. Lead results with
   `renderBottomLine()` built by a pure, tested function.
4. **View**: `js/views/<key>.js` exporting `template`, `styles` (scoped to
   `#<key>-tab`, tokens only) and `guide` (intro, howToRead, method,
   assumptions, tips, terms).
5. **Deck radar**: if it is about a specific card, add its signals to
   `STRUCTURAL_SIGNALS` in `js/utils/deckRadar.js` and set `cardInDeck: true`
   (trigger cards come from the registry's `card`).
6. **Share links**: export `shareInputs` (or `getShareParams()` /
   `applyShareParams(params)` — validate and clamp) from the module, and add
   each param to `tests/utils/shareUrl.node.test.js`.
7. **Tests**: `tests/models/<key>.node.test.js` for the maths,
   `tests/calculators/<key>.node.test.js` for the glue; the registry test
   checks the files and metadata exist.
8. **Regenerate** `npm run sw:manifest` (offline asset list, preloads, page map).
9. **CHANGELOG.md** entry.

**CRITICAL**: Do NOT skip the registry, tests, sw manifest or changelog steps —
the test suite fails if the registry, files or manifest disagree.

## Testing Framework

This project uses Node.js native test runner (not Jest/Mocha):

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
```

**Test Files:**
- Page maths: `tests/models/[name].node.test.js`
- Page glue: `tests/calculators/[name].node.test.js`
- Utility tests: `tests/utils/[name].node.test.js`
- Performance: `tests/performance/benchmarks.node.test.js`
- Helper: `tests/node-test-helper.js` (DOM mocks for headless testing)
- Timing: `tests/helpers/timing.js` (`medianMs`, `budget`) for any wall-clock assertion

**Commands:**
- `npm test` - Run full test suite
- `npm run test:coverage` - Unit tests with the coverage floor (what CI runs)
- `npm run lint` - Run ESLint correctness checks
- `npm run test:e2e` - Playwright browser tests, then the performance budgets (`PW_PORT=4201` picks another server port)
- `npm run test:visual` / `npm run test:visual:update` - Screenshot comparisons against this OS's baselines
- `npm run test:perf` - Node micro-benchmarks for the analysis modules
- `npm run check` - Lint, coverage and browser suites: everything CI runs except screenshots
- `npm run test:watch` - Watch mode
- `npm run sw:manifest` - Regenerate sw.js assets, index.html modulepreloads and the page map
- `npm run dev` - Local dev server

## Code Quality Standards

- Maintain helper functions and DRY principles: percentages through `text.js`
  `pct()`, randomness through `random.js`, percentiles through `stats.js`
- Use caching appropriately for performance
- Clear cache on relevant state changes
- Add JSDoc comments for complex functions
- Follow existing code style and patterns
- **Always add defensive null checks** when accessing nested properties (use optional chaining `?.` and nullish coalescing `??`)
- Use `.toFixed()` only after confirming value is a number

---

## External Dependencies

**CDN:**
- Chart.js 4.6.1 (pinned, loaded on demand by js/shell/vendor.js)
- Google Fonts (Geist, Geist Mono, Crimson Pro)
- LZ-String (share-link compression, loaded on demand by js/shell/vendor.js)
- The `chart.js` and `lz-string` devDependencies are local copies of exactly
  these CDN versions (browser tests serve them instead of the CDN). Bump the
  CDN URL and the devDependency together; `tests/utils/cdnPins.node.test.js`
  fails if they differ, and Dependabot skips both.

**APIs:**
- Scryfall API - Card data lookups
- Moxfield API - Deck imports
- Archidekt API - Deck imports

---

## Key Utilities Reference

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `deckConfig.js` | Global deck state | Always access deck counts and `getCommanders()` through this |
| `library.js` | The library, card typing, name keys | Every page that deals, reveals or counts cards |
| `models/<key>.js` | A page's pure maths | Cross-page answers (e.g. "How it compares") |
| `ramp.js` | The one ramp rule | Anything that counts or labels ramp |
| `random.js` / `stats.js` / `text.js` | Seeded RNG and shuffle, percentiles, `pct()` / `plural()` | Monte Carlo, distributions, every percentage shown |
| `hypergeometric.js` | Math functions | Probability calculations |
| `share.js` | Share links | Pages declare `shareInputs` or share hooks |
| `components.js` | UI builders | renderBottomLine, renderHeroStats, `toneFor` / `toneColor`, sweep tables |
| `chartHelpers.js` | Chart.js wrapper | Creating/updating charts, `withAlpha` |
| `turnOrder.js` | Play/draw control | Any page that depends on who goes first |
| `opponentPages.js` / `bigSpells.js` | Page-family kits | Multiplayer pages / big X-spell pages |
| `calculatorRegistry.js` | Page catalog + lazy loaders | Every page needs one entry |
| `deckStats.js` / `mana.js` / `cardTags.js` | Exact deck analysis | Curve, colours, castability, roles — any deck |
| `format.js` | Format rules | Cards seen by turn, free mulligan, play/draw |
| `glossary.js` | Plain-language terms | `term()` tooltips and `cardRef()` previews in output |
