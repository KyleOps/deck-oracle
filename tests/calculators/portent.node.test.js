// The Portent of Calamity page: readInputs() → the model. The maths is
// tested in tests/models/portent.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import { calculate, readInputs } from '../../js/calculators/portent.js';
import { typeCounts } from '../../js/utils/models/portent.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Portent of Calamity Calculator', () => {
    // Setup Deck: 4 types available.
    DeckConfig.updateDeck({
        lands: 30,
        creatures: 10,
        artifacts: 10,
        instants: 10
    });

    it('calculates valid probability for X=5', () => {
        global.document.getElementById('portent-xValue').value = '5';
        const { results } = calculate();
        const res5 = results[5];
        assert.ok(res5.prob4Plus >= 0 && res5.prob4Plus <= 1, 'Probability X=5 should be in valid range');
        assert.ok(res5.expectedTypes > 1, 'Expected types should be greater than 1');
    });

    it('returns 0 probability for X < 4', () => {
        global.document.getElementById('portent-xValue').value = '4';
        const { results } = calculate();
        const res2 = results[2];
        assert.strictEqual(res2.prob4Plus, 0);
    });

    it('simulates every X up to the slider maximum in one cached pass', () => {
        global.document.getElementById('portent-xValue').value = '7';
        const first = calculate();
        assert.ok(first.results[first.config.maxX], 'covers the whole slider range');
        global.document.getElementById('portent-xValue').value = '12';
        const second = calculate();
        assert.strictEqual(second.results, first.results, 'moving X reuses the cached simulation');
    });

    it('reads the X it was given and the deck\'s type mix', () => {
        global.document.getElementById('portent-xValue').value = '9';
        const config = readInputs();
        assert.strictEqual(config.x, 9);
        assert.strictEqual(config.deckSize, config.masks.length);
        assert.deepStrictEqual(config.types, typeCounts(config.masks));
        assert.ok(config.types.land > 0 && config.types.creature > 0);
    });
});
