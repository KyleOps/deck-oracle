import { describe, it } from 'node:test';
import assert from 'node:assert';
import { drawType, drawTypeMin } from '../../js/utils/hypergeometric.js';
import { FORMATS } from '../../js/utils/format.js';
import {
    openingLands, landDropOdds, firstLikelyMiss, landCountComparison,
    chanceWords, chanceTone, summarizeLandDrops
} from '../../js/utils/landDrops.js';
import { formatChance } from '../../js/utils/percent.js';

const close = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const chances = r => r.byTurn.map(t => t.chance);

describe('landDrops — exact odds', () => {
    it('opening-seven distribution sums to one', () => {
        const d = openingLands(99, 37);
        assert.strictEqual(d.length, 8);
        close(d.reduce((s, p) => s + p, 0), 1, 1e-12);
        close(d[3], drawType(99, 37, 7, 3), 1e-15);
    });

    it('without mulligans, "every drop through turn T" is at least T lands among the cards seen', () => {
        const cmd = landDropOdds({ deckSize: 99, lands: 37 });
        cmd.byTurn.forEach(t => close(t.chance, drawTypeMin(99, 37, 7 + t.turn, t.turn), 1e-12, `turn ${t.turn}`));
        const play = landDropOdds({ deckSize: 60, lands: 24, format: FORMATS.constructed, onPlay: true });
        play.byTurn.forEach(t => close(t.chance, drawTypeMin(60, 24, 6 + t.turn, t.turn), 1e-12, `play turn ${t.turn}`));
        const draw = landDropOdds({ deckSize: 60, lands: 24, format: FORMATS.constructed, onPlay: false });
        draw.byTurn.forEach(t => close(t.chance, drawTypeMin(60, 24, 7 + t.turn, t.turn), 1e-12, `draw turn ${t.turn}`));
    });

    it('being on the draw helps in 60-card games but not in Commander', () => {
        const play = chances(landDropOdds({ deckSize: 60, lands: 24, format: FORMATS.constructed, onPlay: true }));
        const draw = chances(landDropOdds({ deckSize: 60, lands: 24, format: FORMATS.constructed, onPlay: false }));
        play.forEach((p, i) => assert.ok(draw[i] >= p));
        assert.deepStrictEqual(
            chances(landDropOdds({ deckSize: 99, lands: 37, onPlay: true })),
            chances(landDropOdds({ deckSize: 99, lands: 37, onPlay: false })));
    });

    it('a keep range of 0–7 is the same as no mulligans', () => {
        const raw = chances(landDropOdds({ deckSize: 99, lands: 37 }));
        const all = chances(landDropOdds({ deckSize: 99, lands: 37, keepRange: [0, 7] }));
        all.forEach((p, i) => close(p, raw[i], 1e-12));
    });

    it('mulliganing bad land hands is the average over kept sevens', () => {
        const N = 99;
        const L = 37;
        const keep = [2, 4];
        const q = [2, 3, 4].reduce((s, k) => s + drawType(N, L, 7, k), 0);
        const r = landDropOdds({ deckSize: N, lands: L, keepRange: keep });
        r.byTurn.forEach(t => {
            let expected = 0;
            for (let k = 2; k <= 4; k++) expected += drawType(N, L, 7, k) / q * drawTypeMin(N - 7, L - k, t.turn, Math.max(0, t.turn - k));
            // Spells go to the bottom first, so lands are only cut after 3+ bottoms — a sliver of games.
            close(t.chance, expected, 2e-3, `turn ${t.turn}`);
        });
        close(r.keepRate, q, 1e-12);
    });

    it('counting ramp without mulligans is the same as having that many more lands', () => {
        const withRamp = chances(landDropOdds({ deckSize: 99, lands: 30, ramp: 6 }));
        const lands = chances(landDropOdds({ deckSize: 99, lands: 36 }));
        withRamp.forEach((p, i) => close(p, lands[i], 1e-12));
    });

    it('more lands never lowers the odds', () => {
        const rows = landCountComparison({ deckSize: 99, lands: 37, keepRange: [2, 5] });
        assert.deepStrictEqual(rows.map(r => r.delta), [-2, -1, 0, 1, 2]);
        for (let i = 1; i < rows.length; i++) {
            assert.ok(rows[i].byTurn[3].chance >= rows[i - 1].byTurn[3].chance);
        }
        const base = landDropOdds({ deckSize: 99, lands: 37, keepRange: [2, 5] });
        assert.deepStrictEqual(rows[2].byTurn, base.byTurn);
        assert.ok(landCountComparison({ deckSize: 40, lands: 1 }).every(r => r.lands >= 0));
    });

    it('finds the first turn most games have missed a drop', () => {
        assert.strictEqual(firstLikelyMiss([{ turn: 1, chance: 0.9 }, { turn: 2, chance: 0.6 }, { turn: 3, chance: 0.4 }]), 3);
        assert.strictEqual(firstLikelyMiss([{ turn: 1, chance: 0.9 }]), null);
        assert.strictEqual(firstLikelyMiss(landDropOdds({ deckSize: 99, lands: 37, keepRange: [2, 5] }).byTurn), 6);
    });

    it('returns zeros for a deck too small to deal a hand', () => {
        assert.ok(landDropOdds({ deckSize: 5, lands: 3 }).byTurn.every(t => t.chance === 0));
    });
});

describe('landDrops — words', () => {
    it('summarises with the turn 3 and 4 odds and a tone', () => {
        const odds = landDropOdds({ deckSize: 99, lands: 37, keepRange: [2, 5] });
        const ramp = landDropOdds({ deckSize: 99, lands: 37, ramp: 10, keepRange: [2, 5] });
        const s = summarizeLandDrops({ lands: 37, deckSize: 99, byTurn: odds.byTurn, withRamp: ramp.byTurn, ramp: 10 });
        assert.match(s.html, /through turn 3 in <strong>92%<\/strong>/);
        assert.match(s.html, /through turn 4 in <strong>76%<\/strong>/);
        assert.match(s.html, /turn 6/);
        assert.match(s.html, /Counting your 10 cheap ramp cards/);
        assert.strictEqual(s.tone, 'good');
    });

    it('tone follows turn-four reliability', () => {
        const byTurn = t4 => [{ turn: 3, chance: 0.9 }, { turn: 4, chance: t4 }, { turn: 5, chance: 0.3 }];
        assert.strictEqual(summarizeLandDrops({ lands: 1, deckSize: 60, byTurn: byTurn(0.72) }).tone, 'good');
        assert.strictEqual(summarizeLandDrops({ lands: 1, deckSize: 60, byTurn: byTurn(0.6) }).tone, 'warn');
        assert.strictEqual(summarizeLandDrops({ lands: 1, deckSize: 60, byTurn: byTurn(0.4) }).tone, 'bad');
        assert.strictEqual(summarizeLandDrops({ lands: 0, deckSize: 60, byTurn: [] }).tone, 'flat');
    });

    it('mentions lands alone when ramp is counted', () => {
        const s = summarizeLandDrops({
            lands: 20, deckSize: 60, ramp: 8, countingRamp: true,
            byTurn: [{ turn: 3, chance: 0.95 }, { turn: 4, chance: 0.9 }],
            landsOnly: [{ turn: 3, chance: 0.8 }, { turn: 4, chance: 0.6 }]
        });
        assert.match(s.html, /20 lands and 8 cheap ramp cards/);
        assert.match(s.html, /Lands alone: 60%/);
    });

    it('plain words and tones', () => {
        assert.strictEqual(chanceWords(0.97), 'almost always');
        assert.strictEqual(chanceWords(0.5), 'about half the time');
        assert.strictEqual(chanceWords(0.1), 'rarely');
        assert.strictEqual(chanceTone(0.8), 'good');
        assert.strictEqual(chanceTone(0.6), 'warn');
        assert.strictEqual(chanceTone(0.2), 'flat');
    });

    it('formatChance never rounds to a false certainty', () => {
        assert.strictEqual(formatChance(0.999), '>99%');
        assert.strictEqual(formatChance(1), '100%');
        assert.strictEqual(formatChance(0.001), '<1%');
        assert.strictEqual(formatChance(0), '0%');
        assert.strictEqual(formatChance(0.756), '76%');
        assert.strictEqual(formatChance(NaN), '—');
    });
});
