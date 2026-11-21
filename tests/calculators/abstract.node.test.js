// The Abstract Performance page: readInputs() → the model. The maths is
// tested in tests/models/abstract.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs } from '../../js/calculators/abstract.js';
import { ITERATIONS, PILE_SIZE } from '../../js/utils/models/abstract.js';
import { libraryOf } from '../../js/utils/library.js';

describe('Abstract Performance page', () => {
    it('deals from the library: commanders are never in it', () => {
        const { library } = readInputs();
        assert.strictEqual(library, libraryOf(DeckConfig.getDeckConfig()));
        assert.ok(library.commanders.length > 0, 'the example deck has commanders');
    });

    it('simulates the deck once and reuses the result', () => {
        const first = calculate();
        assert.ok(first, 'the example deck deals two piles');
        assert.strictEqual(first.deckSize, readInputs().library.size);
        assert.ok(first.deckSize >= PILE_SIZE * 2);
        assert.ok(ITERATIONS > 0);
        assert.strictEqual(calculate(), first);
    });
});
