// The Lumra page: readInputs() → the model. The maths is tested in
// tests/models/lumra.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs } from '../../js/calculators/lumra.js';
import { ON_BATTLEFIELD, OPENING_HAND, SIM_GAMES, buildLumraLibrary, calculateFetchLandSetup, countFetchLands, expectedLandDrops } from '../../js/utils/models/lumra.js';
import { landCount, libraryOf } from '../../js/utils/library.js';

describe('Lumra page', () => {
    it('reads the library (no commanders), its lands and the default inputs', () => {
        const config = readInputs();
        const library = libraryOf(DeckConfig.getDeckConfig(), ON_BATTLEFIELD);
        assert.strictEqual(config.library, library);
        assert.strictEqual(config.deckSize, library.size);
        assert.strictEqual(config.landCount, landCount(library));
        assert.strictEqual(config.turn, 6);
        assert.strictEqual(config.multiplier, 1);
        assert.strictEqual(config.gyLands, 0);
        assert.strictEqual(config.fetchCount, countFetchLands(library.cards), 'detected fetch lands fill the box');
        assert.strictEqual(config.openingHand, OPENING_HAND, 'the example deck has no Lumra');
        assert.deepStrictEqual(config.fetchSetup, calculateFetchLandSetup(config.deckSize, config.fetchCount, config.turn, OPENING_HAND));
    });

    it('calculates exact averages and simulated sizes over what it read', () => {
        const r = calculate();
        assert.strictEqual(r.drops, expectedLandDrops(r.config.deckSize, r.config.landCount, r.config.turn, r.config.openingHand));
        assert.strictEqual(r.games.length, SIM_GAMES);
        assert.strictEqual(r.sizes.games, SIM_GAMES);
    });

    it('stands in generic cards for a deck of counts only', () => {
        const deck = buildLumraLibrary({ library: null, deckSize: 10, landCount: 4 });
        assert.strictEqual(deck.length, 10);
        assert.strictEqual(deck.filter(c => c.types.includes('land')).length, 4);
        assert.ok(deck.every(c => c.generic && !c.isFetchCard));
    });
});
