// The Head to Head page: readInputs() → the model. The maths is tested in
// tests/models/versus.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs } from '../../js/calculators/versus.js';
import { verdict } from '../../js/utils/models/versus.js';

describe('Head to Head page', () => {
    it('defaults to Wild Pair against Monstrous Vortex, on the live deck', () => {
        const inputs = readInputs();
        assert.strictEqual(inputs.a, 'wildpair');
        assert.strictEqual(inputs.b, 'vortex');
        assert.strictEqual(inputs.treatStarAs5Plus, false);
        assert.strictEqual(inputs.deck.cardsByName, DeckConfig.getDeckConfig().cardsByName);
    });

    it('never compares an engine with itself', () => {
        document.getElementById('versus-engine-a').value = 'vortex';
        document.getElementById('versus-engine-b').value = 'vortex';
        try {
            assert.strictEqual(readInputs().b, 'wildpair');
        } finally {
            document.getElementById('versus-engine-a').value = '';
            document.getElementById('versus-engine-b').value = '';
        }
    });

    it('compares once per deck and settings', () => {
        const first = calculate();
        assert.deepStrictEqual(first.config, { a: 'wildpair', b: 'vortex', treatStarAs5Plus: false });
        assert.ok(first.ctx && first.cmp, 'the example deck has creatures to compare');
        assert.deepStrictEqual(first.verdict, verdict(first.cmp));
        assert.strictEqual(calculate(), first, 'an unchanged deck reuses the comparison');
    });
});
