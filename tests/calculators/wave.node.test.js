// The Genesis Wave page: readInputs() → the model. The maths is tested in
// tests/models/wave.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs } from '../../js/calculators/wave.js';
import { buildWaveLibrary, waveSweep } from '../../js/utils/models/wave.js';

describe('Genesis Wave page', () => {
    it('reads the deck and the default inputs when the page is not mounted', () => {
        const config = readInputs();
        assert.ok(config.cards.length > 0, 'the example deck has a list');
        assert.strictEqual(config.x, 7);
        assert.strictEqual(config.maxX, 30);
        assert.deepStrictEqual(config.settings, { landValue: 1, cardValue: 0.25 });
        assert.strictEqual(config.deckSize, config.library.deckSize);
    });

    it('calculates the model over what it read', () => {
        const { config, results } = calculate();
        assert.deepStrictEqual(Object.keys(results).map(Number), Array.from({ length: config.maxX }, (_, i) => i + 1));
        assert.deepStrictEqual(results, waveSweep(config.library, config.maxX, config.settings, config.deckKey));
    });

    it('falls back to the type counts for a hand-edited deck', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            DeckConfig.updateDeck({
                importSource: 'manual', creatures: 30, artifacts: 0, enchantments: 0, planeswalkers: 0,
                battles: 0, instants: 5, sorceries: 5, lands: 36, actualCardCount: null
            });
            const config = readInputs();
            assert.deepStrictEqual(config.cards, []);
            assert.strictEqual(config.library.hasList, false);
            assert.deepStrictEqual(config.library, buildWaveLibrary([], DeckConfig.getDeckConfig()));
            assert.match(config.deckKey, /^counts:/);
        } finally {
            DeckConfig.updateDeck(original);
        }
    });
});
