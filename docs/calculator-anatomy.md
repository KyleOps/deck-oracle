# Calculator anatomy (v3)

How a calculator page is built in Deck Oracle 3. Read this before adding or
changing a calculator.

## Files

| File | Owns |
|------|------|
| `js/utils/calculatorRegistry.js` | Name, group, card, the **question**, summary, method, keywords, lazy loaders. One entry per page. |
| `js/calculators/<key>.js` | Logic + rendering. Exports `init()`, `updateUI()`, usually `calculate()`. |
| `js/views/<key>.js` | `export const template` (markup), optional `export const styles` (CSS string, scoped under `#<key>-tab`), and `export const guide` (the "How it works" drawer). |
| `tests/calculators/<key>.node.test.js` | Node test runner tests for the pure logic. |

The shell (router) loads the module and view the first time the page opens,
renders the **shared page header** (card art, mana cost, rules text, the
question, "In this deck" badge, "How it works" button) and then the template
inside `<div class="calc-body">`, then calls `init()` once and `updateUI()` on
every visit. Do **not** put an `<h1>` or rules text in the template — the
header already shows them.

`isCalculatorActive('<key>')` tells you whether your page is visible; skip
rendering when it is not (`registerCalculator()` in `calculatorBase.js` wires
a debounced, visibility-aware `updateUI` to deck changes for you).

## The page, top to bottom

1. **Bottom line** — `renderBottomLine({ html, tone })` from
   `js/utils/components.js`. One or two sentences a player could repeat at the
   table, with the key numbers in `<strong>`. Tone is what the answer MEANS:
   `good` / `warn` / `bad` / `flat`. Build the sentence in a **pure, exported,
   tested** function (e.g. `summarize(result)`) so it can't drift from the
   numbers.
2. **Hero stats** — `renderHeroStats([...])`. Plain-word labels ("Free-spell
   chance", not `P(FREE)`; "Average card types", not `E[TYPES]`). Every
   non-obvious stat gets `tip: '…'` (plain text) or `term: '<glossary key>'`.
3. **Inputs** — the left rail (`.panel.panel-config`). Each input has a label
   that says what it changes and a one-line hint. Only add inputs that change
   the answer for the deck as built.
4. **Charts / tables** — the evidence. Every chart has a one-line caption
   saying how to read it.
5. **Samples** — real shuffled examples where the mechanic is random. Card
   names go through `cardRef(name)` so hovering shows the card image.
6. **Details** — secondary breakdowns, collapsible.

## Words

- Sentence case for panel headers: "Cards revealed (X)", not "01 · X PARAM".
- No `E[...]`, `P(...)`, `Δ`, "kernel", "sweep", "step response" in visible
  text. Say "average", "chance", "change", "by X".
- Explain a term the first time it appears with `term('p95', 'good turn')` from
  `js/data/glossary.js` (add new glossary entries in the guide's `terms` list
  only if they already exist in GLOSSARY).
- Percentages: whole numbers unless the difference matters (`64%`, not
  `64.03%`). Averages: one decimal. Format chances with `pct()` from
  `js/utils/text.js` — never `Math.round(p * 100) + '%'`: it has honest ends
  (`>99%`, `<1%`; only a certainty prints as `100%` / `0%`). `one()` / `avg()`
  for averages, `plural(n, 'card')` → "3 cards", `inflect(n, 'card')` → "cards".

## The deck and the shared helpers

Pages never walk `cardsByName` themselves. The library comes from
`js/utils/library.js`, which owns the one rule every page shares:
**commanders are never in the library** — any number of them (partners, a
Doctor and their companion, a commander and a background), whether or not the
list holds them. Outside Commander there is no command zone.

```js
import { libraryOf, expandLibrary, isLand } from '../utils/library.js';

const library = libraryOf(DeckConfig.getDeckConfig());   // or libraryOf(snapshot, { format, commanders, exclude })
library.cards     // counted card records (map them to the page's own shape)
library.size      // copies in the library
library.commanders// names kept in the command zone ([] outside Commander)
const deck = expandLibrary(library, card => ({ name: card.name, cmc: card.cmc, land: isLand(card) }));
```

- `libraryOf()` returns the same frozen object for the same list and options,
  so cache on its identity (`if (cache.lib !== library) …`). Lists are
  immutable: a changed deck is a new `cardsByName` object.
- `exclude: ['Primal Surge']` takes the spell on the stack out (one copy).
- Commanders still set the colour identity: pass their records
  (`DeckConfig.getCommanders().map(c => c.card)`) as `commanderCards` to
  `deckColorIdentity`, `analyzeCastability`, `buildLibrary` (Opening Hands)
  and `buildManaLibrary`.
- Card typing: `cardTypes(typeLine)`, `isLand(card)`, `isPermanent(card)`
  (front face, whole words); names match with `nameKey()` / `sameCard()`.
- Randomness: `mulberry32(seed)`, `hashString(text)`, `shuffle(arr, rng)`,
  `shuffled(arr, rng)`, `partialShuffle(arr, n, size, rng)` in
  `js/utils/random.js`. Seed from the deck (`hashString(library.key)`) so a
  page's numbers don't move on revisit.
- Percentiles: `quantile(weights, q)` / `quantileSorted(samples, q)` in
  `js/utils/stats.js` — nearest rank, the smallest value with at least `q` of
  outcomes at or below it. Quote p10–p99, never the sampled maximum.
- Tones: `toneFor(p, { good, warn })` and `toneColor(tone)` in
  `js/utils/components.js`. `pBarCell(p)` is neutral unless given a colour.
- `choose(n, k)` comes from `js/utils/hypergeometric.js` (cached).

## Styling

- Use tokens only (`var(--tx-*)`, `var(--t-*)`, `var(--radius-*)`). No hex
  colours outside `css/tokens.css` and `js/utils/chartHelpers.js`.
- No inline `style="…"` for layout or type — put it in the view's `styles`
  export scoped to `#<key>-tab`. Inline style is fine only for data-driven
  values (a bar's width, a type's colour).
- `--tx-good` / `--tx-warn` / `--tx-bad` mean something about the result;
  `--tx-accent` marks the selected/recommended/interactive thing. Nothing else.
- Charts: build with `createOrUpdateChart` and colours from `TX_CHART`
  (`js/utils/chartHelpers.js`) — never literal colours — so they re-theme.

## Guide (`export const guide` in the view)

```js
export const guide = {
    intro: 'What the card does and what this page tells you, in two sentences.',
    howToRead: ['<strong>Free-spell chance</strong> is …', '…'],
    method: 'How the numbers are produced (exact formula / N simulated games / deck search).',
    assumptions: ['What the model ignores or simplifies.'],
    tips: ['Deck-building advice the numbers support.'],
    terms: ['exact', 'p95']           // keys from js/data/glossary.js
};
```

## Share links

Settings that change the answer belong in share links. Prefer exporting
`getShareParams()` → `{ param: value }` and `applyShareParams(URLSearchParams)`
from the calculator module (validate and clamp every value). The legacy
`SLIDERS` table in `js/utils/share.js` keeps old links working — never rename
the input ids it lists.
