# Calculator anatomy (v3)

How a calculator page is built in Deck Oracle 3. Read this before adding or
changing a calculator.

## Files

| File | Owns |
|------|------|
| `js/utils/calculatorRegistry.js` | Name, group, card, the **question**, summary, method, keywords, lazy loaders. One entry per page. |
| `js/utils/models/<key>.js` | The page's maths and words: pure functions from plain inputs to results, plus `summarize()` (the bottom line). No DOM, no DeckConfig — the page passes the library and settings in. |
| `js/calculators/<key>.js` | The page: `readInputs()`, `calculate()`, rendering, `init()` / `updateUI()`, share hooks. |
| `js/views/<key>.js` | `export const template` (markup), optional `export const styles` (CSS string, scoped under `#<key>-tab`), and `export const guide` (the "How it works" drawer). |
| `tests/models/<key>.node.test.js` | The model: plain inputs, exact expectations. No DOM mocks (import `assertClose` from `tests/helpers/assert.js`, not `node-test-helper.js`). |
| `tests/calculators/<key>.node.test.js` | The page glue: what `readInputs()` reads (defaults when not mounted, clamps, the library it builds) and that `calculate()` is the model over it. |

Pages whose maths predates `models/` keep it in a named module instead:
Land Drops (`landDrops.js`), Mulligan Planner (`mulliganModel.js`, sample
games included), Draw Odds (`drawOdds.js`), Opening Hands (`handLab.js`),
Mana Development (`manaDevelopment.js`), Mana Base (`castability.js`) and
the Discover pages' shared simulation (`discover.js`). Game Plan's words
are in `models/plan.js`, over three modules of its own: the plan schema
(`planSchema.js`), the card rules (`planRules.js`) and the engine
(`planEngine.js`). Shared by several
models: `models/cardList.js` (the big spells' card list, `withoutCopy`) and
`models/opponentLibrary.js` (the multiplayer pages' opponent library, seeded
revealer and distribution helpers).

### One page, one shape

```js
// js/calculators/wave.js
export function readInputs() {               // the DOM and the deck → a plain object
    const deck = DeckConfig.getDeckConfig();
    const cards = deckCardList(deck, ON_STACK);
    const library = buildWaveLibrary(cards, deck);
    return { library, x: readX('wave', 7), settings: { … }, deckKey: … };
}
export function calculate() {                // the model over what was read
    const config = readInputs();
    return { config, results: waveSweep(config.library, config.maxX, config.settings, config.deckKey) };
}
export function updateUI() { const { config, results } = calculate(); /* render */ }
```

- `readInputs()` is the only function that reads the page's inputs or deck
  state. It returns defaults when the page has never been mounted, so other
  code (and tests) can call it any time.
- Models never import `deckConfig.js`, `opponentState.js`, `bigSpells.js`,
  `opponentPages.js` or a page. Code that needs another page's maths imports
  its **model** (`bigSpellComparison.js` → the four big-spell models;
  Head to Head → `models/wildpair.js`), never the page.
- Caches live where the state does: a model may memoise a pure result (keyed
  on the Library's identity or a content key); per-page state (sample
  shuffles, the selected row) stays in the page.

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
   `good` / `warn` / `bad` / `flat`. Build the sentence in the model's
   **pure, exported, tested** `summarize(result)` so it can't drift from the
   numbers.
2. **Hero stats** — `renderHeroStats([...])`. Plain-word labels ("Free-spell
   chance", not `P(FREE)`; "Average card types", not `E[TYPES]`). Every
   non-obvious stat gets `tip: '…'` (plain text) or `term: '<glossary key>'`.
3. **Inputs** — the left rail (`.panel.panel-config`). Each input has a label
   that says what it changes and a one-line hint. Only add inputs that change
   the answer for the deck as built.
4. **Charts / tables** — the evidence. Every chart has a one-line caption
   saying how to read it (`<p class="tx-caption">`, see Styling).
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
- **The card a page casts is not in the library either.** Each model exports
  its card and the options: `ON_STACK = { exclude: ['Genesis Wave'] }` for a
  spell (Genesis Wave, the Vow, Portent, Primal Surge, Abstract Performance),
  `ON_BATTLEFIELD` for a permanent whose ability reads the library (Chimil,
  Rashmi, Monstrous Vortex, Lumra). `libraryOf(deck, ON_STACK)` /
  `deckCardList(deck, ON_STACK)` take one listed copy out, only when the list
  names it — a list without it already is a library without it. On a plain
  card list use `withoutCopy(cards, name)` (`models/cardList.js`). If the
  card was drawn first (Lumra is cast from your hand), count it among the
  cards you have seen (`handFromLibrary`). Not for cards the ability can't
  find anyway (Wild Pair finds creatures) or for opponents' libraries.
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
- Turn order: pages whose answer depends on who goes first use
  `js/utils/turnOrder.js` — `turnOrderHTML()` for the control,
  `syncTurnOrder(root, onPlay, format)` after a render,
  `turnOrderClicked(event)` in the page's click handler and
  `effectiveOnPlay(onPlay, format)` for the maths (in multiplayer Commander
  everyone draws, so the control hides and the maths is on the play). The
  page keeps its own `onPlay` and share parameter.

### Page families

Pages that are the same page around a different model share the page, not
just helpers:

- **Multiplayer** (Mara, Dream Harvest, Mind's Dilation):
  `createOpponentPage({ key, stats, summarize, hero, sections, placeholder,
  sample, layout?, settings?, bind? })` in `js/utils/opponentPages.js`
  returns the page's `readInputs` / `calculate` / `updateUI` / `init`: stats
  cached per opponent deck, a render only when the opponents or settings
  change, the empty and loading states, and sample casts with Reshuffle and
  Show more (`sampleCastsHTML()`). The page module is its markup:
  `export const { readInputs, calculate, updateUI, init } = page;`
- **X spells** (Genesis Wave, Kamahl's Druidic Vow; Portent and Primal Surge
  use the parts that fit): the kit in `js/utils/bigSpells.js` —
  `readXSpell()` (deck → library → X), `readValueInput()`, `setXInputs()`,
  `paybackChart()`, `paybackSampleHTML()`, `renderXSweep()`,
  `valueBandsTable()`, `renderEmptyAnswer()` and `bindBigSpellControls()`.

### Cards that need a rule of their own (Game Plan)

Game Plan's goldfish (`js/utils/planEngine.js`) reads lands through
`classifyLand` and ramp through `ramp.js`, like Mana Development. A card
whose mana depends on the board, or that triggers on what you cast, gets a
**card rule** in `js/utils/planRules.js` instead, keyed by its front-face
`nameKey()`:

```js
defineCardRule('Fanatic of Rhonas', rule(ferocious('{G}', '{G}{G}{G}{G}')));
defineCardRule('Selvala, Eager Trailblazer', rule(
    distinctPowers(),
    creatureCastToken({ name: 'Mercenary', power: 1, toughness: 1, colors: R, subtypes: 'mercenary' })
));
```

A rule is data plus small hooks (`mana`, `tapBoost`, `onMainPhase`,
`onEnter`, `onCast`, `creature`, `power`, `rampValue`) that act on the game
only through its rules API (`powerOf`, `distinctPowers`, `controlsPower`,
`countSubtype`, `addMana`, `createToken`, `fetchLand`, `copySpell`, …), so
a new card never touches the engine loop. When a whole wording family
shares a rule (every "Ferocious — {T}: Add …"), add a detector to
`DETECTORS` instead; named rules win over detected ones. Test each rule with
an exact scripted game (`playScriptedPlanGame`) in
`tests/models/plan.node.test.js`.

Presets — a plan that comes with its deck — are modules in
`js/data/plans/<id>.js` (`id`, `title`, `deckUrl`, `commanders`, `plan`,
`notes`, `snapshot`) listed in `js/data/plans/index.js`, imported the first
time they are used. Plans are plain data (`js/utils/planSchema.js`), so a
preset's plan is exactly what a share link (`gp=`) carries.

## Styling

- Use tokens only (`var(--tx-*)`, `var(--t-*)`, `var(--radius-*)`). No hex
  colours outside `css/tokens.css` and `js/utils/chartHelpers.js`.
- No inline `style="…"` for layout or type — put it in the view's `styles`
  export scoped to `#<key>-tab`. Inline style is fine only for data-driven
  values (a bar's width, a type's colour).
- `--tx-good` / `--tx-warn` / `--tx-bad` mean something about the result;
  `--tx-accent` marks the selected/recommended/interactive thing. Nothing else.
- Captions and legends have one style each: `<p class="tx-caption">` under a
  chart, table or sample (`is-below` directly under a figure, `is-inset`
  inside an already padded block) and `.tx-legend` for a key (`is-panel` on
  its own row, `is-below` under its band). Pages draw their own swatches,
  never their own caption or legend rule.
- Hero stats (`renderHeroStats`) share one grid — 150px-or-wider columns,
  two across on a phone. Style the stats if you must, never
  `grid-template-columns`, or phones and tablets reflow differently.
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

Settings that change the answer belong in share links, and the page module
owns them (`js/utils/share.js` knows only the deck, opponents and tab):

```js
/** Inputs share links carry as they are. Names and ids are in links already shared: never rename them. */
export const shareInputs = Object.freeze([
    { param: 'waveX', id: 'wave-xSlider', min: 0, max: 30 },
    { param: 'waveLand', id: 'wave-land-value', min: 0, max: 20, float: true }
]);
export function getShareParams() { return onPlay ? {} : { draw: 1 }; }   // everything else
export function applyShareParams(params) { /* validate and clamp every value */ }
```

`shareInputs` values are bounded and set on the input with input/change
events, as if typed; `applyShareParams()` runs after them. A parameter packed
with LZ-String (loaded on demand) goes in `PACKED_PARAMS` in share.js so the
app loads it before applying the link (Mulligan's `mullTypes`, packed by
`packRequirements()` in `mulliganModel.js`). `tests/utils/shareUrl.node.test.js`
lists every parameter a link has ever carried: add yours there.
