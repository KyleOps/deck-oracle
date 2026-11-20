# Deck Oracle

Exact odds for your Magic: The Gathering deck. Import a list from Moxfield,
Archidekt or plain text and Deck Oracle tells you, in plain words, how your
deck actually plays: how often you hit land drops, whether your lands cast
your spells on curve, what your opening hands look like, and what your big
payoff cards really do.

Every page answers one question, says the answer first, then shows the
evidence.

## What's inside

**Your deck** (works with any deck: Commander, 60-card or 40-card)

| Page | Answers |
|------|---------|
| Deck Overview | How healthy is this deck's mana, curve and card mix? |
| Draw Odds | What are the chances I draw a card, or one of a group, by a given turn? |
| Mana Base | Can my lands cast my spells on curve? |
| Opening Hands | What do my opening hands actually look like? (sample hands with card images, London mulligan practice) |
| Mulligan Planner | Which hands should I keep, and how often will I find one? |
| Land Drops | How reliably will I hit a land drop every turn? |

**Engines**: Wild Pair, Monstrous Vortex, Chimil, Rashmi, and Head to Head (Wild Pair vs Vortex)

**Big spells**: Portent of Calamity, Genesis Wave, Kamahl's Druidic Vow, Primal Surge, Abstract Performance, Lumra

**Multiplayer**: Ensnared by the Mara, Dream Harvest, Mind's Dilation (these read your opponents' decklists)

Also included:

- **Deck library**: every import is saved in your browser; switch decks from the sidebar.
- **Format aware**: Commander (free first mulligan, everyone draws on turn one), 60-card and 40-card (on the play or the draw).
- **How it works**: every page has a drawer explaining the method, assumptions and terms.
- **Search everything**: press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> to jump to any calculator, card or action.
- Light and dark themes, card image previews on hover, share links, offline support (PWA).

## Running it

It's a static site: no build step.

```bash
npm install        # dev tooling only (tests, lint, local server)
npm run dev        # http://localhost:3000
```

## Development

```bash
npm test           # unit tests (node:test)
npm run test:e2e   # browser tests (Playwright, Chromium)
npm run lint       # ESLint
npm run check      # all of the above
npm run sw:manifest  # regenerate the offline asset list and module preloads after adding files
```

Architecture in one paragraph: `index.html` is only the app shell. `js/main.js`
wires the shell (`js/shell/`): router, sidebar, command palette, deck dialog,
guide drawer, overlays, theme. Calculators are listed in
`js/utils/calculatorRegistry.js` and loaded on first visit: logic in
`js/calculators/<key>.js`, markup, styles and guide in `js/views/<key>.js`.
Deck state lives in `js/utils/deckConfig.js`. The pure analysis modules
(`mana.js`, `cardTags.js`, `deckStats.js`, `format.js`, `hypergeometric.js`)
are fully unit-tested. See [docs/calculator-anatomy.md](docs/calculator-anatomy.md)
before adding a calculator.

## Credits

Card data and images come from [Scryfall](https://scryfall.com). Land-count
guidance uses Frank Karsten's published regressions. Deck Oracle is unofficial
Fan Content permitted under the Wizards of the Coast Fan Content Policy. It is
not approved or endorsed by Wizards. Portions of the materials used are property
of Wizards of the Coast. ©Wizards of the Coast LLC.

## License

MIT
