import { describe, it } from 'node:test';
import assert from 'node:assert';
import { curveBucket, curveCards, deckProfile, SPEED_GUIDE } from '../../js/utils/deckProfile.js';
import { analyzeDeckStats } from '../../js/utils/deckStats.js';
import { FORMATS } from '../../js/utils/format.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';

const stats = analyzeDeckStats(DEFAULT_DECK_DATA, { format: FORMATS.commander });

describe('deckProfile', () => {
    const rows = deckProfile(stats, FORMATS.commander);

    it('gives the six rows in reading order', () => {
        assert.deepStrictEqual(rows.map(r => r.key), ['speed', 'consistency', 'mana', 'ramp', 'flow', 'interaction']);
    });

    it('uses the deck’s own numbers', () => {
        const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
        assert.strictEqual(byKey.speed.value, stats.curve.average);
        assert.strictEqual(byKey.consistency.value, stats.odds.keepable);
        assert.strictEqual(byKey.ramp.value, stats.tags.counts.ramp ?? 0);
        const c = stats.tags.counts;
        assert.strictEqual(byKey.flow.value, (c.draw ?? 0) + (c.tutor ?? 0));
        assert.strictEqual(byKey.interaction.value, (c.removal ?? 0) + (c.counter ?? 0) + (c.wipe ?? 0));
        const weakest = Math.min(...stats.colors.filter(x => Number.isFinite(x.onCurve)).map(x => x.onCurve));
        assert.strictEqual(byKey.mana.value, weakest);
    });

    it('states every range as a guideline and keeps each value on its scale', () => {
        for (const r of rows) {
            assert.match(r.rangeTip, /guideline|no common guideline/i, `${r.key} tip`);
            assert.ok(r.max > r.min);
            assert.ok(r.value <= r.max, `${r.key} value fits the scale`);
            if (r.range) assert.ok(r.range[0] >= r.min && r.range[1] <= r.max, `${r.key} range fits the scale`);
        }
    });

    it('reads speed against the format, and never as good or bad', () => {
        const speed = rows.find(r => r.key === 'speed');
        assert.deepStrictEqual(speed.range, SPEED_GUIDE.commander.range);
        assert.strictEqual(speed.tone, 'flat');
        assert.strictEqual(speed.status, 'slower than typical', 'the example deck averages 5.6');
        const sixty = deckProfile(stats, FORMATS.constructed).find(r => r.key === 'speed');
        assert.deepStrictEqual(sixty.range, SPEED_GUIDE.constructed.range);
    });

    it('draws no role band outside Commander, and says why', () => {
        const sixty = deckProfile(stats, FORMATS.constructed);
        for (const key of ['ramp', 'flow', 'interaction']) {
            const r = sixty.find(x => x.key === key);
            assert.strictEqual(r.range, null);
            assert.strictEqual(r.tone, 'flat');
            assert.match(r.rangeTip, /no common guideline/);
        }
    });

    it('marks short mana and low consistency by what they mean', () => {
        const fake = {
            ...stats,
            odds: { ...stats.odds, keepable: 0.6 },
            colors: [{ color: 'U', onCurve: 0.7, heaviest: { name: 'X', mv: 3, pips: 2 } }]
        };
        const byKey = Object.fromEntries(deckProfile(fake, FORMATS.commander).map(r => [r.key, r]));
        assert.strictEqual(byKey.consistency.tone, 'bad');
        assert.strictEqual(byKey.mana.tone, 'bad');
        assert.strictEqual(byKey.mana.card, 'X');
    });

    it('is empty without a deck', () => {
        assert.deepStrictEqual(deckProfile(null), []);
        assert.deepStrictEqual(deckProfile(analyzeDeckStats({}, { format: FORMATS.commander })), []);
    });
});

describe('curveCards', () => {
    it('buckets by mana value with 7 and up together', () => {
        assert.strictEqual(curveBucket({ cmc: 0 }), 0);
        assert.strictEqual(curveBucket({ cmc: 3.5 }), 3);
        assert.strictEqual(curveBucket({ cmc: 12 }), 7);
    });

    it('lists the nonland cards behind each curve bar, adding up to the bar', () => {
        for (let bucket = 0; bucket <= 7; bucket++) {
            const { total, groups } = curveCards(DEFAULT_DECK_DATA, bucket);
            assert.strictEqual(total, stats.curve.buckets[bucket].total, `bucket ${bucket}`);
            assert.strictEqual(groups.reduce((s, g) => s + g.count, 0), total);
        }
    });

    it('never lists lands', () => {
        const deck = {
            Forest: { name: 'Forest', count: 10, type_line: 'Basic Land — Forest', cmc: 0 },
            Ornithopter: { name: 'Ornithopter', count: 2, type_line: 'Artifact Creature — Thopter', cmc: 0, category: 'creatures' }
        };
        const { total, groups } = curveCards(deck, 0);
        assert.strictEqual(total, 2);
        assert.deepStrictEqual(groups.map(g => g.type), ['creatures']);
    });
});
