# Project-Specific Instructions for Codex

## Project Overview

**MTG Deck Oracle** - A single-page application for Magic: The Gathering probability calculations. Built with vanilla ES6+ modules (no build step), featuring 14 specialized calculators for analyzing deck performance and card interactions.

**Tech Stack**: Vanilla JavaScript (ES6 modules), Chart.js, CSS custom properties, PWA with Service Worker

---

## Directory Structure

```
mtgcalcs/
├── index.html              # SPA entry point (all calculator tabs)
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker for offline support
├── package.json            # npm scripts & config
├── CHANGELOG.md            # Version history
│
├── js/
│   ├── main.js             # App initialization, tab switching, event delegation
│   ├── calculators/        # 14 calculator modules
│   │   ├── lands.js        # Land drop consistency analysis
│   │   ├── lumra.js        # Mill 4 ETB trigger simulation
│   │   ├── mulligan.js     # Optimal mulligan decisions (hypergeometric)
│   │   ├── portent.js      # Card type reveal probability
│   │   ├── rashmi.js       # Free cast probability based on curve
│   │   ├── surge.js        # Primal Surge permanents simulation
│   │   ├── vortex.js       # Discover chain calculations
│   │   ├── vow.js          # Kamahl's Vow hits (lands + legendaries)
│   │   └── wave.js         # Genesis Wave expected permanents
│   │
│   └── utils/              # Shared utility modules
│       ├── deckConfig.js       # Global deck state management (single source of truth)
│       ├── decklistImport.js   # Scryfall/Moxfield/Archidekt import
│       ├── simulation.js       # Monte Carlo utilities, caching, debouncing
│       ├── hypergeometric.js   # Factorial, combinations, probability math
│       ├── sampleSimulator.js  # Sample simulation, card color mapping
│       ├── chartHelpers.js     # Chart.js wrapper for standardized charts
│       ├── components.js       # Reusable UI components (stat cards, grids)
│       ├── tableUtils.js       # Multi-column comparison tables
│       ├── calculatorBase.js   # Base infrastructure for calculators
│       ├── ui.js               # Collapsible sections, animations, validation
│       ├── share.js            # URL deep linking, deck encoding
│       └── bigSpellComparison.js  # Cross-calculator comparison
│
├── css/
│   ├── base.css            # Core styles, CSS variables, calculator themes
│   ├── components.css      # Panels, buttons, navigation, tabs
│   ├── mobile.css          # Responsive breakpoints, touch optimization
│   └── ux-enhancements.css # Animations, transitions, accessibility
│
├── tests/
│   ├── node-test-helper.js     # Mock DOM/window for Node.js testing
│   ├── calculators/            # Calculator test files (*.node.test.js)
│   ├── utils/                  # Utility test files
│   └── performance/            # Benchmark tests
│
├── serverless/
│   └── worker.js           # Cloudflare Worker (serverless functions)
│
└── .github/workflows/
    └── deploy.yml          # CI/CD: tests → GitHub Pages deploy
```

---

## Architecture

### Data Flow
```
DeckListImport → DeckConfig (global state) → Each Calculator
                                           → Share.js (URL encoding)
                                           → BigSpellComparison
```

### Calculator Module Pattern
Each calculator exports three functions:
- `init()` - Initialize inputs and event listeners
- `calculate()` - Run probability calculations (cached by deck hash)
- `updateUI()` - Render results with Chart.js

### Theme System
Each calculator has CSS variables in `base.css`:
- `--[name]-primary`, `--[name]-secondary`, `--[name]-accent`
- `--[name]-bg-start`, `--[name]-bg-end` (gradient)
- `--[name]-border`

---

## Testing Requirements

When making code changes to this project:

1. **Always check for tests** - Before and after making changes:
   - Look for test files in the `tests/` directory
   - Test files follow the pattern `tests/**/*.node.test.js`
   - Run tests with: `npm test`

2. **Update tests when needed**:
   - If you modify function signatures or behavior, update corresponding tests
   - If you add new functionality, add test coverage
   - Ensure all tests pass before completing a task

3. **Run relevant tests**:
   - For calculator changes: `npm test -- tests/calculators/[calculator-name].node.test.js`
   - For full test suite: `npm test`

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

When adding a new calculator to this project, you MUST complete ALL of the following steps:

1. **Create Calculator File**: `js/calculators/[name].js`
   - Implement core calculation logic
   - Export `init()`, `calculate()`, and `updateUI()` functions
   - Follow existing calculator patterns (see `lumra.js` or `wave.js`)

2. **Add HTML Section**: Update `index.html`
   - Add calculator tab content with unique ID
   - Add a `.tx-tab` button to the terminal tab row with a 3-letter code and `data-group`
   - (The legacy sub-nav pills and dropdown selector were removed in v2.8.2 — the
     terminal tab row is the only navigation. Do not re-add them.)

3. **Register in Main App**: Update `js/main.js`
   - Import the calculator module
   - Add entry to `calculators` object with name and group (the `icon` field was
     removed along with the dropdown that consumed it)
   - Add case to `switchTab()` function
   - Create and call `init[Name]Inputs()` function in `init()`

4. **Create Theme Styles**: Update `css/base.css`
   - Add CSS variables for calculator theme (primary, secondary, accent, bg colors, border)
   - Add `body.theme-[name]` rule with gradient background and CSS variables
   - Add `.theme-[name] h1` rule with color and text-shadow
   - Add `.theme-[name] h2` rule with color and border-bottom
   - Add `.theme-[name] *:focus-visible` rule with outline-color

5. **Update Share Functionality**: Update `js/utils/share.js`
   - Add calculator name to `VALID_TABS` array
   - Add any slider parameters to `sliderMap` in `parseShareUrl()`
   - Add slider entries to `sliders` array in `getShareUrl()`

6. **Write Tests**: Create `tests/calculators/[name].node.test.js`
   - Cover core calculation functions
   - Test edge cases and boundary conditions
   - Ensure all tests pass with `npm test`

7. **Update Documentation**: Update `CHANGELOG.md`
   - Create new version section following semantic versioning
   - Document all features under **Added** category
   - Be specific and descriptive

**CRITICAL**: Do NOT skip any of these steps. Missing CSS or share.js updates will cause the calculator to not work properly.

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
- `npm run test:watch` - Watch mode
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
- Chart.js - Data visualization
- Google Fonts (Cinzel, Crimson Text)

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
| `share.js` | URL encoding | Deep linking, must update for new calculators |
| `components.js` | UI builders | Stat cards, grids, insight boxes |
| `chartHelpers.js` | Chart.js wrapper | Creating/updating charts |
