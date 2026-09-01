import { describe, it } from 'node:test';
import assert from 'node:assert';

import { buildTypeSegments, buildCurveBars } from '../../js/utils/radarPanel.js';

describe('buildTypeSegments', () => {
    it('drops zero-count types so the bar has no invisible slivers', () => {
        const segs = buildTypeSegments({ creatures: 30, lands: 36, instants: 0, battles: 0 });
        assert.deepStrictEqual(segs.map(s => s.key), ['creatures', 'lands']);
    });

    it('produces percentages that sum to 100', () => {
        const segs = buildTypeSegments({ creatures: 30, lands: 36, artifacts: 34 });
        const sum = segs.reduce((a, s) => a + s.pct, 0);
        assert.ok(Math.abs(sum - 100) < 1e-9, `got ${sum}`);
    });

    it('sizes each segment in proportion to its count', () => {
        const segs = buildTypeSegments({ creatures: 25, lands: 75 });
        assert.strictEqual(segs.find(s => s.key === 'creatures').pct, 25);
        assert.strictEqual(segs.find(s => s.key === 'lands').pct, 75);
    });

    it('gives every segment a label and a colour', () => {
        for (const s of buildTypeSegments({ creatures: 1, lands: 1, planeswalkers: 1 })) {
            assert.ok(s.label && typeof s.label === 'string');
            assert.ok(s.color.startsWith('var(--type-'));
        }
    });

    it('returns an empty array for an empty or all-zero deck', () => {
        assert.deepStrictEqual(buildTypeSegments({}), []);
        assert.deepStrictEqual(buildTypeSegments({ creatures: 0, lands: 0 }), []);
        assert.deepStrictEqual(buildTypeSegments(), []);
    });

    it('ignores non-numeric counts', () => {
        const segs = buildTypeSegments({ creatures: 10, lands: 'many', artifacts: null });
        assert.deepStrictEqual(segs.map(s => s.key), ['creatures']);
    });
});

describe('buildCurveBars', () => {
    it('spans 0..maxCmc inclusive so gaps stay visible', () => {
        const bars = buildCurveBars({ 2: 5 }, { maxCmc: 7 });
        assert.strictEqual(bars.length, 8);
        assert.deepStrictEqual(bars.map(b => b.cmc), [0, 1, 2, 3, 4, 5, 6, 7]);
        assert.strictEqual(bars[1].count, 0);
    });

    it('normalizes heights against the tallest column', () => {
        const bars = buildCurveBars({ 1: 5, 2: 10 });
        assert.strictEqual(bars[2].heightPct, 100);
        assert.strictEqual(bars[1].heightPct, 50);
    });

    it('folds everything above maxCmc into the top bucket', () => {
        const bars = buildCurveBars({ 8: 2, 9: 1, 12: 3 }, { maxCmc: 7 });
        assert.strictEqual(bars[7].count, 6);
        assert.strictEqual(bars[7].label, '7+');
    });

    it('labels non-terminal buckets with the plain MV', () => {
        assert.strictEqual(buildCurveBars({}, { maxCmc: 7 })[3].label, '3');
    });

    it('rounds fractional MVs to the nearest bucket', () => {
        const bars = buildCurveBars({ 2.4: 1, 2.6: 1 });
        assert.strictEqual(bars[2].count, 1);
        assert.strictEqual(bars[3].count, 1);
    });

    it('returns all-zero heights for an empty curve rather than NaN', () => {
        for (const b of buildCurveBars({})) {
            assert.strictEqual(b.count, 0);
            assert.strictEqual(b.heightPct, 0);
        }
    });

    it('ignores negative, zero, and non-numeric entries', () => {
        const bars = buildCurveBars({ 1: -5, 2: 0, 3: 'x', 4: 8 });
        assert.strictEqual(bars[1].count, 0);
        assert.strictEqual(bars[2].count, 0);
        assert.strictEqual(bars[3].count, 0);
        assert.strictEqual(bars[4].count, 8);
    });

    it('honours a custom maxCmc', () => {
        assert.strictEqual(buildCurveBars({}, { maxCmc: 4 }).length, 5);
    });
});
