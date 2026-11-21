# Project-Specific Instructions for Codex

## Project Overview

**Deck Oracle** — a single-page app of Magic: The Gathering probability tools.
Vanilla ES modules, no build step. Import a deck (Moxfield, Archidekt, pasted
list, or bare type counts) and every page answers one question about it in plain
words, then shows the evidence. Works for Commander, 60-card and 40-card decks.

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
│   ├── main.js             # Bootstrap: wires shell, deck state, shortcuts, share links
│   ├── shell/              # App chrome
│   │   ├── router.js       # ?tab= routing, history, lazy mount (module + view + Chart.js)
│   │   ├── sidebar.js      # Navigation, breadcrumbs, deck switcher, mobile drawer
│   │   ├── pageHeader.js   # Shared page header + "How it works" guide drawer
│   │   ├── palette.js      # Ctrl/Cmd+K command palette (calculators, cards, actions)
│   │   ├── deckDialog.js   # Import / saved decks / manual counts dialog
│   │   ├── overlays.js     # Tooltips, glossary terms, card previews, toasts
│   │   ├── theme.js        # Light/dark theme
│   │   └── vendor.js       # On-demand third-party scripts (Chart.js)
│   ├── calculators/<key>.js  # Page logic: init(), updateUI(), calculate()
│   ├── views/<key>.js        # Page markup (template), scoped CSS (styles), guide
│   ├── data/
│   │   ├── cards.js        # Static card metadata for page headers (Scryfall snapshot)
│   │   └── glossary.js     # Plain-language terms; term(), cardRef(), escapeHtml()
│   └── utils/
│       ├── calculatorRegistry.js  # THE catalog: every page's name, group, question, loaders
│       ├── deckConfig.js       # Deck state (single source of truth), imports, format, library
│       ├── deckLibrary.js      # Saved decks in localStorage
│       ├── decklistImport.js   # Scryfall / Moxfield / Archidekt import + text parsing
│       ├── format.js           # Commander / 60 / 40 rules (draws, free mulligan)
│       ├── mana.js             # Mana costs, pips, land colours, colour identity
│       ├── cardTags.js         # Ramp / draw / removal / … detection from rules text
│       ├── deckStats.js        # Curve, colour sources, castability, land odds, health checks
│       ├── deckRadar.js        # Which card calculators apply to a deck
│       ├── hypergeometric.js   # Exact draw maths
│       ├── simulation.js       # Shuffling, caching, debounce
│       ├── components.js       # renderBottomLine, renderHeroStats, sweep tables, sim summaries
│       ├── chartHelpers.js     # createOrUpdateChart, TX_CHART (theme-synced chart palette)
│       ├── share.js            # Share links (applyShareUrl / getShareUrl)
│       └── …                   # discover.js, payback.js, opponentState.js, bigSpellComparison.js, …
│
├── css/
│   ├── tokens.css          # ALL colours, type, radii, shadows — dark + light themes
│   ├── base.css            # Reset, typography, layout primitives
│   ├── components.css      # Calculator internals (panels, tables, sliders, charts)
│   ├── shell.css           # Shell, page header, dialogs, palette, drawer, overview
│   ├── mobile.css          # Viewport-level responsive + print
│   └── ux-enhancements.css # Collapsibles, skeletons, small animations
│
├── scripts/update-sw-manifest.mjs  # Regenerates sw.js assets + index.html modulepreloads
├── .github/                # CI/deploy, CodeQL, "Update visual baselines" workflows; Dependabot
└── tests/
    ├── node-test-helper.js # DOM mocks for headless tests
    ├── calculators/ utils/ performance/   # *.node.test.js (node:test)
    ├── e2e/                # Playwright: app.spec.js, performance.spec.js (budgets), helpers/network.js
    └── visual/             # Playwright screenshot comparisons (Linux baselines made by CI)
```

---

## Architecture

### Data flow
```
decklistImport ─▶ deckConfig (state + format + library) ─▶ calculators (on the visible page)
                                                        ─▶ shell (deck switcher, nav marks, header badge)
                                                        ─▶ share.js (links)
```

### Pages are lazy
The router renders the shared header, injects `views/<key>.js` → `template`
into `#<key>-tab .calc-body`, injects `styles`, then calls the module's
`init()` once and `updateUI()` on every visit. A calculator's DOM does not
exist until its page has been opened — **never read another calculator's DOM**
(give it a pure function that takes explicit inputs instead).

### Design system
Tokens in `css/tokens.css`; charts read the same tokens at runtime
(`applyChartTheme`). One accent (`--tx-accent`) marks the active / primary /
recommended thing; `--tx-good` / `--tx-warn` / `--tx-bad` carry meaning about
results only. Sans (Geist) for reading, mono (Geist Mono) for numbers, serif
(Crimson Pro) only for card rules text. No hex colours outside tokens.css and
chartHelpers.js.

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
   - For calculator changes: `node --test tests/calculators/[calculator-name].node.test.js`
   - For full test suite: `npm test`
   - For app-shell, navigation, sharing, or deck-input changes: `npm run test:e2e`
   - For the complete CI-equivalent check: `npm run check`

4. **CI gates** (a pull request can't merge until they pass):
   - **Coverage**: `npm run test:coverage` fails if line / branch / function
     coverage of `js/utils/**` and `js/data/**` drops below 84 / 84 / 83%.
     Every module there must load in plain Node (`tests/utils/moduleLoad.node.test.js`),
     so a new untested module lowers the numbers instead of hiding.
   - **Performance budgets**: `tests/e2e/performance.spec.js` (run by
     `npm run test:e2e`, after the functional tests). If a change really needs
     more, re-measure as its header explains and raise the budget in the same
     PR with a reason; lower budgets when you make things faster.
   - **Screenshots**: once `tests/visual/__screenshots__/linux/` exists, CI
     compares key pages against it. After a visual change, run the
     "Update visual baselines" workflow on your branch and commit its artifact.
     Never commit baselines made on Windows or macOS.

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
   `question` (ends in "?"), `summary`, `method`, `keywords`, and the
   `load` / `view` dynamic imports. Navigation, search, the header and the
   overview pick it up automatically — do NOT add markup to `index.html`.
2. **Logic**: `js/calculators/<key>.js` exporting `init()`, `updateUI()` and
   `calculate()`; use `registerCalculator()` / `isCalculatorActive()`.
   Lead results with `renderBottomLine()` built by a pure, tested function.
3. **View**: `js/views/<key>.js` exporting `template`, `styles` (scoped to
   `#<key>-tab`, tokens only) and `guide` (intro, howToRead, method,
   assumptions, tips, terms).
4. **Deck radar**: if it is about a specific card, add it to `TRIGGER_CARDS`
   and `STRUCTURAL_SIGNALS` in `js/utils/deckRadar.js` and set
   `cardInDeck: true`.
5. **Share links**: export `getShareParams()` / `applyShareParams(params)`
   from the module (validate and clamp). Only legacy inputs live in
   `SLIDERS` in `js/utils/share.js`.
6. **Tests**: `tests/calculators/<key>.node.test.js`; the registry test
   checks the files and metadata exist.
7. **Regenerate** `npm run sw:manifest` (offline asset list + preloads).
8. **CHANGELOG.md** entry.

**CRITICAL**: Do NOT skip the registry, tests, sw manifest or changelog steps —
the test suite fails if the registry, files or manifest disagree.

## Testing Framework

This project uses Node.js native test runner (not Jest/Mocha):

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
```

**Test Files:**
- Calculator tests: `tests/calculators/[name].node.test.js`
- Utility tests: `tests/utils/[name].node.test.js`
- Performance: `tests/performance/benchmarks.node.test.js`
- Helper: `tests/node-test-helper.js` (DOM mocks for headless testing)

**Commands:**
- `npm test` - Run full test suite
- `npm run test:coverage` - Unit tests with the coverage floor (what CI runs)
- `npm run lint` - Run ESLint correctness checks
- `npm run test:e2e` - Playwright browser tests, then the performance budgets (`PW_PORT=4201` picks another server port)
- `npm run test:visual` / `npm run test:visual:update` - Screenshot comparisons against this OS's baselines
- `npm run test:perf` - Node micro-benchmarks for the analysis modules
- `npm run check` - Lint, coverage and browser suites: everything CI runs except screenshots
- `npm run test:watch` - Watch mode
- `npm run sw:manifest` - Regenerate sw.js assets and index.html modulepreloads
- `npm run dev` - Local dev server

## Code Quality Standards

- Maintain helper functions and DRY principles
- Use caching appropriately for performance
- Clear cache on relevant state changes
- Add JSDoc comments for complex functions
- Follow existing code style and patterns
- **Always add defensive null checks** when accessing nested properties (use optional chaining `?.` and nullish coalescing `??`)
- Use `.toFixed()` only after confirming value is a number

## Known Testing Gaps

- `tests/utils/bigSpellComparison.node.test.js` - Partial test coverage (requires DeckConfig mocking)
  - Basic tests exist but full integration tests need DeckConfig mocking strategy

---

## External Dependencies

**CDN:**
- Chart.js 4.6.1 (pinned, loaded on demand by js/shell/vendor.js)
- Google Fonts (Geist, Geist Mono, Crimson Pro)
- LZ-String (share-link compression)
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
| `deckConfig.js` | Global deck state | Always access deck counts through this |
| `simulation.js` | Shuffling, caching, debounce | Monte Carlo simulations |
| `hypergeometric.js` | Math functions | Probability calculations |
| `share.js` | Share links | Prefer module `getShareParams`/`applyShareParams` hooks |
| `components.js` | UI builders | renderBottomLine, renderHeroStats, sweep tables, simulation summaries |
| `chartHelpers.js` | Chart.js wrapper | Creating/updating charts |
| `calculatorRegistry.js` | Page catalog + lazy loaders | Every page needs one entry |
| `deckStats.js` / `mana.js` / `cardTags.js` | Exact deck analysis | Curve, colours, castability, roles — any deck |
| `format.js` | Format rules | Cards seen by turn, free mulligan, play/draw |
| `glossary.js` | Plain-language terms | `term()` tooltips and `cardRef()` previews in output |
