// The card a page casts is on the stack (or, once it resolves, the
// battlefield) — never in the library it looks at. Each page takes one listed
// copy out, only when the list names it.
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import * as Wave from '../../js/calculators/wave.js';
import * as Vow from '../../js/calculators/vow.js';
import * as Portent from '../../js/calculators/portent.js';
import * as Surge from '../../js/calculators/surge.js';
import * as Abstract from '../../js/calculators/abstract.js';
import * as Chimil from '../../js/calculators/chimil.js';
import * as Rashmi from '../../js/calculators/rashmi.js';
import * as Vortex from '../../js/calculators/vortex.js';
import * as Versus from '../../js/calculators/versus.js';
import * as Lumra from '../../js/calculators/lumra.js';
import { OPENING_HAND } from '../../js/utils/models/lumra.js';

const BASE = {
    Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 10 },
    Bears: { name: 'Grizzly Bears', type_line: 'Creature — Bear', cmc: 2, power: '2', toughness: '2', count: 5 },
    Giant: { name: 'Craw Giant', type_line: 'Creature — Giant', cmc: 6, power: '6', toughness: '4', count: 3 },
    Opt: { name: 'Opt', type_line: 'Instant', cmc: 1, count: 4 }
};
const BASE_SIZE = Object.values(BASE).reduce((n, c) => n + c.count, 0);

/** Each page, the card it casts, and the size of the library it read. */
const PAGES = [
    ['Genesis Wave', Wave, 'Genesis Wave', 'Sorcery', 3, i => i.deckSize],
    ['Kamahl’s Druidic Vow', Vow, "Kamahl's Druidic Vow", 'Legendary Sorcery', 2, i => i.deckSize],
    ['Portent of Calamity', Portent, 'Portent of Calamity', 'Sorcery', 1, i => i.deckSize],
    ['Primal Surge', Surge, 'Primal Surge', 'Sorcery', 10, i => i.deckSize],
    ['Abstract Performance', Abstract, 'Abstract Performance', 'Sorcery', 6, i => i.library.size],
    ['Chimil', Chimil, 'Chimil, the Inner Sun', 'Legendary Artifact', 6, i => i.deckSize],
    ['Rashmi', Rashmi, 'Rashmi, Eternities Crafter', 'Legendary Creature — Human Druid', 4, i => i.library.size],
    ['Monstrous Vortex', Vortex, 'Monstrous Vortex', 'Enchantment', 4, i => i.library.size],
    ['Head to Head (Vortex’s library)', Versus, 'Monstrous Vortex', 'Enchantment', 4, i => i.library.size],
    ['Lumra', Lumra, 'Lumra, Bellow of the Woods', 'Legendary Creature — Bear Elemental', 6, i => i.deckSize]
];

const original = DeckConfig.getDeckConfig();
after(() => DeckConfig.updateDeck(original));

function useList(extra = {}) {
    // A new cardsByName object each time: DeckConfig never edits a list in place.
    DeckConfig.updateDeck({ importSource: 'moxfield', cardsByName: { ...BASE, ...extra }, actualCardCount: null });
}

describe('the cast card is not in the library', () => {
    for (const [label, page, name, typeLine, cmc, sizeOf] of PAGES) {
        const card = count => ({ Cast: { name, type_line: typeLine, cmc, count, power: '5', toughness: '5' } });

        it(`${label}: one listed copy is on the stack or battlefield`, () => {
            useList(card(1));
            assert.strictEqual(sizeOf(page.readInputs()), BASE_SIZE, 'the only copy is out');
            useList(card(2));
            assert.strictEqual(sizeOf(page.readInputs()), BASE_SIZE + 1, 'a second copy stays in the library');
        });

        it(`${label}: a list without it loses nothing`, () => {
            useList();
            assert.strictEqual(sizeOf(page.readInputs()), BASE_SIZE);
        });
    }

    it('Lumra: the copy you cast was in your opening hand, so six cards come from the library', () => {
        useList({ Cast: { name: 'Lumra, Bellow of the Woods', type_line: 'Legendary Creature — Bear Elemental', cmc: 6, count: 1 } });
        assert.strictEqual(Lumra.readInputs().openingHand, OPENING_HAND - 1);
        useList();
        assert.strictEqual(Lumra.readInputs().openingHand, OPENING_HAND);
    });
});
