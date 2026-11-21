// The Kamahl's Druidic Vow page: readInputs() → the model. The maths is
// tested in tests/models/vow.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs } from '../../js/calculators/vow.js';
import { commanderCopiesVow, vowSweep } from '../../js/utils/models/vow.js';

describe('Kamahl\'s Druidic Vow page', () => {
    it('reads the deck and the default inputs when the page is not mounted', () => {
        const config = readInputs();
        assert.ok(config.cards.length > 0, 'the example deck has a list');
        assert.strictEqual(config.x, 7);
        assert.strictEqual(config.settings.landValue, 1);
        assert.strictEqual(config.settings.cardValue, 0.25);
    });

    it('copies the Vow when a commander copies it', () => {
        const config = readInputs();
        const copies = commanderCopiesVow(DeckConfig.getCommanderNames());
        assert.strictEqual(config.doubleCast, copies);
        assert.strictEqual(config.settings.copies, copies ? 2 : 1);
    });

    it('calculates the model over what it read', () => {
        const { config, results } = calculate();
        assert.deepStrictEqual(results, vowSweep(config.library, config.maxX, config.settings, config.deckKey));
    });
});

describe('commanderCopiesVow', () => {
    it('is true when either card in the command zone copies the Vow', () => {
        assert.strictEqual(commanderCopiesVow(['The Sixth Doctor']), true);
        assert.strictEqual(commanderCopiesVow(['Susan Foreman', 'The Sixth Doctor']), true);
        assert.strictEqual(commanderCopiesVow(['Susan Foreman']), false);
        assert.strictEqual(commanderCopiesVow(null), false);
    });
});
