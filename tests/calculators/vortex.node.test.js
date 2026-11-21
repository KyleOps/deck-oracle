// The Monstrous Vortex page: readInputs() → the model. The maths is tested in
// tests/models/vortex.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import { calculate, readInputs } from '../../js/calculators/vortex.js';
import { DEFAULT_MV } from '../../js/utils/models/vortex.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Monstrous Vortex page', () => {
    it('reads the default mana value and the library (no commanders) when not mounted', () => {
        const config = readInputs();
        assert.strictEqual(config.mv, DEFAULT_MV);
        assert.strictEqual(config.library.commanders.length > 0, DeckConfig.getCommanderNames().length > 0);
    });

    it('reads the shared deck and caches the analysis between renders', () => {
        DeckConfig.updateDeck({
            cardsByName: {
                'Big Dino': { name: 'Big Dino', type_line: 'Creature — Dinosaur', cmc: 6, power: '5', toughness: '5', count: 1 },
                'Tiny Spell': { name: 'Tiny Spell', type_line: 'Sorcery', cmc: 1, count: 1 },
                Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 6 }
            }
        });
        const first = calculate();
        const second = calculate();
        assert.strictEqual(first.analysis, second.analysis, 'no re-simulation when nothing changed');
        assert.strictEqual(first.analysis.creatures[0].name, 'Big Dino');
        assert.strictEqual(first.point.mv, 6);
    });
});
