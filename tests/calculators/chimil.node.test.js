// The Chimil page: readInputs() → the model. The maths is tested in
// tests/models/chimil.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs } from '../../js/calculators/chimil.js';
import { AUTO_SIM_GAMES, ON_BATTLEFIELD, PROJECTION_TURNS, analyzeTrigger, projectTurns } from '../../js/utils/models/chimil.js';
import { libraryOf } from '../../js/utils/library.js';

describe('Chimil page', () => {
    it('reads the default horizon and the library (no commanders)', () => {
        const config = readInputs();
        assert.strictEqual(config.turns, PROJECTION_TURNS);
        assert.strictEqual(config.library, libraryOf(DeckConfig.getDeckConfig(), ON_BATTLEFIELD));
        assert.strictEqual(config.deckSize, config.library.size);
    });

    it('clamps the horizon to the slider range', () => {
        document.getElementById('chimil-turnsSlider').value = '99';
        try {
            assert.strictEqual(readInputs().turns, 20);
        } finally {
            document.getElementById('chimil-turnsSlider').value = '';
        }
    });

    it('calculates the model over what it read, simulating once per deck', () => {
        const first = calculate();
        assert.deepStrictEqual(first.trigger, analyzeTrigger({ cardDetails: first.config.cardDetails, lands: first.config.lands }));
        assert.deepStrictEqual(first.rows, projectTurns(first.trigger, first.config.turns));
        assert.strictEqual(first.games.length, AUTO_SIM_GAMES);
        assert.strictEqual(calculate().sim.games, first.sim.games);
    });
});
