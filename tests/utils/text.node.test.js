import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pct, points, pointsShort, avg, one, plural, inflect } from '../../js/utils/text.js';

describe('pct — honest ends', () => {
    it('rounds to whole percents in the middle', () => {
        assert.equal(pct(0.42), '42%');
        assert.equal(pct(0.125), '13%');
        assert.equal(pct(0.005), '1%');
        assert.equal(pct(0.994), '99%');
    });

    it('never prints 100% for an uncertain chance or 0% for a possible one', () => {
        assert.equal(pct(0.997), '>99%');
        assert.equal(pct(0.995), '>99%');
        assert.equal(pct(0.9999999), '>99%');
        assert.equal(pct(0.004), '<1%');
        assert.equal(pct(1e-12), '<1%');
    });

    it('prints certainties as they are', () => {
        assert.equal(pct(1), '100%');
        assert.equal(pct(0), '0%');
        assert.equal(pct(1.2), '100%');
        assert.equal(pct(-0.1), '0%');
    });

    it('has no number to print for non-numbers', () => {
        assert.equal(pct(NaN), '—');
        assert.equal(pct(Infinity), '—');
        assert.equal(pct(undefined), '—');
        assert.equal(pct('0.5'), '—');
    });

    it('keeps the same honesty at one decimal', () => {
        assert.equal(pct(0.4237, 1), '42.4%');
        assert.equal(pct(0.42, 1), '42.0%');
        assert.equal(pct(0.0004, 1), '<0.1%');
        assert.equal(pct(0.9996, 1), '>99.9%');
        assert.equal(pct(0.999, 1), '99.9%');
        assert.equal(pct(1, 1), '100%');
    });

    it('matches the old "honest" formatters wherever they agreed', () => {
        // percent.formatChance and bigSpells.pct
        const legacy = p => (p <= 0 ? '0%' : p >= 1 ? '100%' : p < 0.005 ? '<1%' : p >= 0.995 ? '>99%' : `${Math.round(p * 100)}%`);
        for (let i = 0; i <= 1000; i++) assert.equal(pct(i / 1000), legacy(i / 1000), String(i / 1000));
    });
});

describe('points', () => {
    it('reads a change in chance as percentage points', () => {
        assert.equal(points(0.09), '+9 points');
        assert.equal(points(-0.01), '−1 point');
        assert.equal(points(0.001), 'no change');
        assert.equal(points(NaN), '—');
    });

    it('has a compact table form', () => {
        assert.equal(pointsShort(0.09), '+9 pts');
        assert.equal(pointsShort(-0.2), '−20 pts');
        assert.equal(pointsShort(0), '0');
        assert.equal(pointsShort(undefined), '—');
    });
});

describe('avg / one', () => {
    it('formats averages and never shows -0', () => {
        assert.equal(avg(3.14159), '3.1');
        assert.equal(avg(3.14159, 2), '3.14');
        assert.equal(avg(-0.01), '0.0');
        assert.equal(avg(NaN), '—');
        assert.equal(one(2), '2.0');
        assert.equal(one(Infinity), '—');
    });
});

describe('plural / inflect', () => {
    it('agrees the noun with the count', () => {
        assert.equal(plural(1, 'card'), '1 card');
        assert.equal(plural(3, 'card'), '3 cards');
        assert.equal(plural(0, 'copy', 'copies'), '0 copies');
        assert.equal(inflect(1, 'land'), 'land');
        assert.equal(inflect(2, 'land'), 'lands');
        assert.equal(inflect(2, 'mulligan', 'mulligans'), 'mulligans');
    });
});
