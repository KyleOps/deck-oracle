/**
 * Mulligan Planner — behaviour of the keep rule through the calculator's own
 * inputs (sliders read from the DOM, rows set like a share link would).
 */

import { describe, it } from 'node:test';
import { assert, assertClose, assertInRange, createMockInput, resetMocks } from '../node-test-helper.js';
import { calculate, setCardTypes, applyShareParams } from '../../js/calculators/mulligan.js';
import { keepBar } from '../../js/utils/mulliganModel.js';

const LANDS = { id: 1, name: 'Lands', count: 37, required: 3, byTurn: 3, max: 5 };
const RAMP = { id: 2, name: 'Ramp', count: 11, required: 1, byTurn: 3 };

function setup({ threshold = 75, penalty = 20, types = [LANDS, RAMP] } = {}) {
    resetMocks();
    createMockInput('mull-threshold', threshold);
    createMockInput('mull-penalty', penalty);
    setCardTypes(types);
    return calculate().result;
}

describe('Mulligan Planner — keep rule', () => {
    it('keeps exactly the sevens that clear the bar', () => {
        const result = setup({ threshold: 68 });
        result.strategy.forEach(h => {
            const legal = result.steps[0].decisions[result.strategy.indexOf(h)].legal;
            assert.strictEqual(h.keep, legal && h.successProb >= 0.68 - 1e-12, `hand ${h.counts}`);
        });
    });

    it('a higher bar keeps fewer sevens', () => {
        const rates = [50, 68, 75, 90].map(threshold => setup({ threshold }).keepSeven);
        for (let i = 1; i < rates.length; i++) assert.ok(rates[i] <= rates[i - 1], `threshold step ${i}`);
    });

    it('the penalty lowers the bar after cards are lost', () => {
        applyShareParams(new URLSearchParams('mullFree=0'));
        const strict = setup({ penalty: 0 });
        const loose = setup({ penalty: 50 });
        assertClose(strict.steps[2].bar, 0.75, 'no penalty: same bar', 1e-12);
        assertClose(loose.steps[2].bar, keepBar(0.75, 0.5, 2), 'penalty 50%: bar halves per card', 1e-12);
        assert.ok(loose.steps[2].keepChance >= strict.steps[2].keepChance);
        assert.ok(loose.avgHandSize >= strict.avgHandSize, 'a lower bar keeps bigger hands');
        assert.ok(strict.success >= loose.success - 1e-9, 'a constant bar finds better hands');
    });
});

describe('Mulligan Planner — plan statistics', () => {
    it('produces valid probabilities', () => {
        const result = setup();
        assertInRange(result.expectedSuccess, 0, 1, 'success');
        assertClose(result.strategy.reduce((s, h) => s + h.handProb, 0), 1, 'hands sum to 1', 1e-9);
        assertInRange(result.avgMulligans, 0, 3, 'average mulligans');
        assertInRange(result.expectedCards, 4, 7, 'average hand size');
    });

    it('mulligans beat keeping every seven', () => {
        const result = setup();
        assert.ok(result.expectedSuccess >= result.baselineSuccess);
    });

    it('handles one group and three groups', () => {
        assert.ok(setup({ types: [LANDS] }).expectedSuccess > 0.8);
        const three = setup({ types: [LANDS, RAMP, { id: 3, name: 'Payoffs', count: 10, required: 1, byTurn: 5 }] });
        assert.ok(three.strategy.length > 0);
        assert.strictEqual(three.types.length, 3);
    });
});

describe('Mulligan Planner — edge cases', () => {
    it('impossible requirements give no success', () => {
        const result = setup({ types: [{ id: 1, name: 'Lands', count: 5, required: 8, byTurn: 3 }] });
        assertClose(result.expectedSuccess, 0, 'impossible', 1e-9);
    });

    it('groups larger than the deck still produce a plan (and flag it)', () => {
        const result = setup({ types: [{ id: 1, name: 'Lands', count: 120, required: 3, byTurn: 3 }] });
        assert.strictEqual(result.oversize, true);
        assert.ok(result.expectedSuccess > 0.99);
    });

    it('no rows means no plan', () => {
        resetMocks();
        setCardTypes([]);
        assert.strictEqual(calculate().result, null);
    });
});
