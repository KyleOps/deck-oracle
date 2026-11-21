// The Wild Pair page: readInputs() → the model. The maths is tested in
// tests/models/wildpair.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs, setSelectedTotal } from '../../js/calculators/wildpair.js';
import { analyzeDeck, fitVerdict } from '../../js/utils/models/wildpair.js';
import { libraryOf, sameCard } from '../../js/utils/library.js';

describe('Wild Pair page', () => {
    it('searches the library: commanders are never in it', () => {
        const config = readInputs();
        const commanders = DeckConfig.getCommanderNames();
        assert.ok(commanders.length > 0, 'the example deck has commanders');
        for (const name of commanders) {
            assert.ok(!config.cardDetails.some(c => sameCard(c.name, name)), `${name} stays in the command zone`);
        }
        assert.strictEqual(config.deckSize, libraryOf(DeckConfig.getDeckConfig()).size);
    });

    it('calculates the model over what it read, on a total the deck has', () => {
        const { config, analysis, fit, total, group } = calculate();
        assert.deepStrictEqual(analysis, analyzeDeck(config.cardDetails));
        assert.deepStrictEqual(fit, fitVerdict(analysis));
        assert.ok(analysis.totals.includes(total));
        assert.strictEqual(group?.total, total);
    });

    it('keeps a chosen total until the deck changes', () => {
        const { analysis } = calculate();
        const pick = analysis.totals[0];
        setSelectedTotal(pick);
        assert.strictEqual(calculate().total, pick);
    });
});
