// The multiplayer pages (Mara, Dream Harvest, Mind's Dilation): readInputs()
// → the model. The maths is tested in tests/models/{mara,dreamharvest,
// mindsdilation}.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import * as Mara from '../../js/calculators/mara.js';
import * as DreamHarvest from '../../js/calculators/dreamharvest.js';
import * as MindsDilation from '../../js/calculators/mindsdilation.js';
import { readOpponents } from '../../js/utils/opponentPages.js';

const PAGES = { mara: Mara, dreamharvest: DreamHarvest, mindsdilation: MindsDilation };

describe('multiplayer pages read the opponents', () => {
    for (const [key, page] of Object.entries(PAGES)) {
        it(`${key}: reads the opponent state and has nothing to show without decks`, () => {
            const inputs = page.readInputs();
            const state = readOpponents();
            assert.deepStrictEqual(inputs.opponents, state.opponents);
            assert.strictEqual(inputs.signature, state.signature);
            assert.deepStrictEqual(inputs.opponents, [], 'no opponent decks are loaded');
            assert.deepStrictEqual(page.calculate(), {});
        });
    }
});

describe('Mind’s Dilation share params', () => {
    it('round-trips The Sixth Doctor switch and ignores junk', () => {
        const { getShareParams, applyShareParams, readInputs } = MindsDilation;
        assert.deepStrictEqual(getShareParams(), {});
        assert.strictEqual(readInputs().sixthDoctor, false);
        applyShareParams(new URLSearchParams('sixth=1'));
        assert.deepStrictEqual(getShareParams(), { sixth: '1' });
        assert.strictEqual(readInputs().sixthDoctor, true);
        applyShareParams(new URLSearchParams('sixth=<script>'));
        assert.deepStrictEqual(getShareParams(), { sixth: '1' });
        applyShareParams(new URLSearchParams('sixth=0'));
        assert.deepStrictEqual(getShareParams(), {});
    });
});
