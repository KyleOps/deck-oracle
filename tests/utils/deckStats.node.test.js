import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    manaCurve, typeComposition, colorProfile, colorCastProbability, sourcesNeeded,
    recommendedLands, landOdds, analyzeDeckStats, healthChecks
} from '../../js/utils/deckStats.js';
import { drawTypeMin } from '../../js/utils/hypergeometric.js';
import { FORMATS, detectFormat, resolveFormat, cardsSeenByTurn } from '../../js/utils/format.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';

const c = (name, cmc, category, extra = {}) => ({ name, cmc, category, count: 1, type_line: category === 'lands' ? 'Land' : 'Creature', ...extra });

describe('format', () => {
    it('detects formats from deck shape', () => {
        assert.equal(detectFormat({ deckSize: 99 }), 'commander');
        assert.equal(detectFormat({ deckSize: 60 }), 'constructed');
        assert.equal(detectFormat({ deckSize: 40 }), 'limited');
        assert.equal(detectFormat({ deckSize: 60, commanderName: 'Atraxa' }), 'commander');
    });

    it('resolves explicit preferences over detection', () => {
        assert.equal(resolveFormat('limited', { deckSize: 99 }).key, 'limited');
        assert.equal(resolveFormat('auto', { deckSize: 40 }).key, 'limited');
        assert.equal(resolveFormat('bogus', { deckSize: 99 }).key, 'commander');
    });

    it('counts cards seen, skipping the first draw only on the play in 1v1', () => {
        assert.equal(cardsSeenByTurn(0, { format: FORMATS.constructed }), 7);
        assert.equal(cardsSeenByTurn(1, { format: FORMATS.constructed, onPlay: true }), 7);
        assert.equal(cardsSeenByTurn(1, { format: FORMATS.constructed, onPlay: false }), 8);
        assert.equal(cardsSeenByTurn(3, { format: FORMATS.commander, onPlay: true }), 10);
    });
});

describe('manaCurve and composition', () => {
    const deck = {
        a: c('One', 1, 'creatures', { count: 2 }),
        b: c('Three', 3, 'sorceries', { type_line: 'Sorcery' }),
        d: c('Nine', 9, 'creatures'),
        l: c('Forest', 0, 'lands', { count: 5 })
    };

    it('buckets nonland cards and folds 7+ together', () => {
        const curve = manaCurve(deck);
        assert.equal(curve.nonlandCount, 4);
        assert.equal(curve.buckets[1].total, 2);
        assert.equal(curve.buckets[7].total, 1);
        assert.equal(curve.buckets[7].mv, '7+');
        assert.equal(curve.average, (1 + 1 + 3 + 9) / 4);
        assert.equal(curve.median, 2);
    });

    it('counts each card once by primary type', () => {
        assert.deepEqual(typeComposition(deck), [
            { type: 'creatures', count: 3 }, { type: 'sorceries', count: 1 }, { type: 'lands', count: 5 }
        ]);
    });
});

describe('colorCastProbability', () => {
    it('matches the plain hypergeometric when every land is a source', () => {
        // With all lands producing the colour, "≥1 source and ≥1 land" is just ≥1 land.
        const p = colorCastProbability({ deckSize: 60, lands: 24, sources: 24, pips: 1, landsNeeded: 1, seen: 7 });
        assert.ok(Math.abs(p.joint - drawTypeMin(60, 24, 7, 1)) < 1e-12);
        assert.ok(Math.abs(p.conditional - 1) < 1e-12);
    });

    it('agrees with brute-force enumeration on a tiny deck', () => {
        // 6 cards: 2 green lands, 1 other land, 3 spells. Draw 3. Need ≥2 lands of which ≥1 green.
        const deck = ['G', 'G', 'L', 'S', 'S', 'S'];
        let ok = 0; let landsOk = 0; let total = 0;
        for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) for (let k = j + 1; k < 6; k++) {
            const hand = [deck[i], deck[j], deck[k]];
            const g = hand.filter(x => x === 'G').length;
            const lands = hand.filter(x => x !== 'S').length;
            total++;
            if (lands >= 2) { landsOk++; if (g >= 1) ok++; }
        }
        const p = colorCastProbability({ deckSize: 6, lands: 3, sources: 2, pips: 1, landsNeeded: 2, seen: 3 });
        assert.ok(Math.abs(p.joint - ok / total) < 1e-12);
        assert.ok(Math.abs(p.landsOk - landsOk / total) < 1e-12);
        assert.ok(Math.abs(p.conditional - ok / landsOk) < 1e-12);
    });

    it('needs more sources for more pips', () => {
        const one = sourcesNeeded({ deckSize: 99, lands: 37, pips: 1, landsNeeded: 3, seen: 10 });
        const two = sourcesNeeded({ deckSize: 99, lands: 37, pips: 2, landsNeeded: 3, seen: 10 });
        assert.ok(one < two, `${one} < ${two}`);
        // Asking for more pips than there are lands can never be satisfied
        assert.equal(sourcesNeeded({ deckSize: 40, lands: 3, pips: 4, landsNeeded: 3, seen: 8 }), null);
        assert.equal(sourcesNeeded({ deckSize: 40, lands: 3, pips: 3, landsNeeded: 3, seen: 8 }), 3);
    });
});

describe('recommendedLands', () => {
    it('applies the Commander regression', () => {
        const r = recommendedLands({ format: FORMATS.commander, averageMV: 3, cheapAccel: 10 });
        assert.equal(r.recommended, Math.round(31.42 + 3.13 * 3 - 0.28 * 10));
        assert.equal(r.extrapolated, false);
    });

    it('scales the 60-card fit for limited and clamps out-of-range curves', () => {
        const sixty = recommendedLands({ format: FORMATS.constructed, averageMV: 3, cheapAccel: 0 }).raw;
        const forty = recommendedLands({ format: FORMATS.limited, averageMV: 3, cheapAccel: 0 }).raw;
        assert.ok(Math.abs(forty - sixty * 40 / 60) < 1e-9);
        assert.equal(recommendedLands({ format: FORMATS.commander, averageMV: 6 }).extrapolated, true);
    });
});

describe('landOdds', () => {
    it('produces an opening distribution that sums to 1', () => {
        const odds = landOdds({ deckSize: 60, lands: 24, format: FORMATS.constructed });
        const sum = odds.openingDist.reduce((s, p) => s + p, 0);
        assert.ok(Math.abs(sum - 1) < 1e-9);
        assert.ok(odds.keepable > 0.7 && odds.keepable < 0.9);
        assert.ok(odds.dropsBy[3] > odds.dropsBy[5]);
    });
});

describe('analyzeDeckStats on the bundled example deck', () => {
    const stats = analyzeDeckStats(DEFAULT_DECK_DATA, { format: FORMATS.commander });

    it('reads the deck shape', () => {
        assert.equal(stats.deckSize, 98, '100 cards less two commanders');
        assert.equal(stats.lands, 37);
        assert.deepEqual(stats.identity, ['U', 'G']);
        assert.ok(stats.curve.average > 4);
    });

    it('finds colour sources for both colours', () => {
        const green = stats.colors.find(x => x.color === 'G');
        const blue = stats.colors.find(x => x.color === 'U');
        assert.ok(green.sources > blue.sources);
        assert.ok(green.onCurve > 0 && green.onCurve <= 1);
        assert.ok(blue.heaviest.pips >= 2);
    });

    it('turns the numbers into findings', () => {
        const findings = healthChecks(stats, { format: FORMATS.commander });
        const ids = findings.map(f => f.id);
        assert.ok(ids.includes('lands'));
        assert.ok(ids.includes('opener'));
        assert.ok(ids.includes('color-U'));
        assert.ok(ids.includes('role-ramp'));
        findings.forEach(f => assert.ok(['good', 'warn', 'bad', 'info'].includes(f.status)));
    });

    it('words its chances with honest ends and its counts in agreement', () => {
        const sure = { ...stats, odds: { ...stats.odds, keepable: 0.998 } };
        const opener = healthChecks(sure, { format: FORMATS.commander }).find(f => f.id === 'opener');
        assert.strictEqual(opener.value, '>99%', 'not quite certain never prints as 100%');
        assert.match(opener.title, /^>99% of opening hands/);
        const color = healthChecks(stats, { format: FORMATS.commander }).find(f => f.id.startsWith('color-'));
        assert.match(color.title, /^\d+ \w+ sources?$/);
        assert.doesNotMatch(color.title, /^1 \w+ sources$/);
        assert.match(color.detail, /\(\d+ pips? at mana value/);
    });

    it('skips Commander role guidelines for other formats', () => {
        const findings = healthChecks(stats, { format: FORMATS.constructed });
        assert.ok(!findings.some(f => f.id.startsWith('role-')));
    });

    it('returns no findings for an empty deck', () => {
        assert.deepEqual(healthChecks(analyzeDeckStats({}), {}), []);
    });
});

describe('colorProfile', () => {
    it('tracks pips, sources and the hardest card per colour', () => {
        const profile = colorProfile({
            a: { name: 'Counterspell', count: 1, cmc: 2, mana_cost: '{U}{U}', type_line: 'Instant', color_identity: ['U'] },
            b: { name: 'Opt', count: 1, cmc: 1, mana_cost: '{U}', type_line: 'Instant', color_identity: ['U'] },
            l: { name: 'Island', count: 10, type_line: 'Basic Land — Island' },
            w: { name: 'Wastes', count: 2, type_line: 'Basic Land', color_identity: [] }
        });
        const blue = profile.colors.find(x => x.color === 'U');
        assert.equal(blue.pips, 3);
        assert.equal(blue.sources, 10);
        assert.equal(blue.heaviest.name, 'Counterspell');
        assert.equal(profile.colorlessLands, 2);
    });
});
