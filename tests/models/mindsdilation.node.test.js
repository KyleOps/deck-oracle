/**
 * Tests for Mind's Dilation calculator
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    calculateMindsDilationStats, roundStats, formatRounds, summarizeMindsDilation,
    MINDS_DILATION_COST
} from '../../js/utils/models/mindsdilation.js';

// Helper to build minimal opponentData from a card list
function makeOpponentData(cards) {
    const cardsByName = {};
    for (const c of cards) {
        cardsByName[c.name] = {
            name: c.name,
            cmc: c.cmc ?? 0,
            type_line: c.type_line ?? 'Instant',
            count: c.count ?? 1
        };
    }
    const deckSize = cards.reduce((s, c) => s + (c.count ?? 1), 0);
    return { cardsByName, deckSize };
}

describe('calculateMindsDilationStats', () => {
    it('returns null for empty deck', () => {
        const result = calculateMindsDilationStats({ cardsByName: {}, deckSize: 0 });
        assert.strictEqual(result, null);
    });

    it('returns null for null input', () => {
        assert.strictEqual(calculateMindsDilationStats(null), null);
    });

    it('returns null for missing cardsByName', () => {
        assert.strictEqual(calculateMindsDilationStats({ deckSize: 10 }), null);
    });

    it('correctly separates lands and nonlands', () => {
        const data = makeOpponentData([
            { name: 'Forest', cmc: 0, type_line: 'Basic Land', count: 36 },
            { name: 'Counterspell', cmc: 2, type_line: 'Instant', count: 4 }
        ]);
        const stats = calculateMindsDilationStats(data);
        assert.strictEqual(stats.landCount, 36);
        assert.strictEqual(stats.nonlandCount, 4);
        assert.strictEqual(stats.deckSize, 40);
    });

    it('pNonland is nonlandCount / total', () => {
        const data = makeOpponentData([
            { name: 'Island', cmc: 0, type_line: 'Basic Land — Island', count: 30 },
            { name: 'Opt', cmc: 1, type_line: 'Instant', count: 10 }
        ]);
        const stats = calculateMindsDilationStats(data);
        assert.ok(Math.abs(stats.pNonland - 10 / 40) < 1e-9);
    });

    it('evPerTrigger = pNonland * avgEffectiveMV', () => {
        const data = makeOpponentData([
            { name: 'Island', cmc: 0, type_line: 'Basic Land — Island', count: 36 },
            { name: 'Opt', cmc: 1, type_line: 'Instant', count: 4 },
            { name: 'Wrath of God', cmc: 4, type_line: 'Sorcery', count: 4 }
        ]);
        const stats = calculateMindsDilationStats(data);
        const expected = stats.pNonland * stats.avgEffectiveMV;
        assert.ok(Math.abs(stats.evPerTrigger - expected) < 1e-9);
    });

    it('all-lands deck: pNonland is 0, evPerTrigger is 0', () => {
        const data = makeOpponentData([
            { name: 'Forest', cmc: 0, type_line: 'Basic Land — Forest', count: 36 }
        ]);
        const stats = calculateMindsDilationStats(data);
        assert.strictEqual(stats.pNonland, 0);
        assert.strictEqual(stats.evPerTrigger, 0);
    });

    it('identifies historic cards: artifacts', () => {
        const data = makeOpponentData([
            { name: 'Sol Ring', cmc: 1, type_line: 'Artifact', count: 4 }
        ]);
        const stats = calculateMindsDilationStats(data);
        assert.strictEqual(stats.historicCount, 4);
    });

    it('identifies historic cards: legendary creatures', () => {
        const data = makeOpponentData([
            { name: 'Emrakul', cmc: 15, type_line: 'Legendary Creature — Eldrazi', count: 1 }
        ]);
        const stats = calculateMindsDilationStats(data);
        assert.strictEqual(stats.historicCount, 1);
    });

    it('identifies historic cards: sagas', () => {
        const data = makeOpponentData([
            { name: 'The Eldest Reborn', cmc: 5, type_line: 'Enchantment — Saga', count: 2 }
        ]);
        const stats = calculateMindsDilationStats(data);
        assert.strictEqual(stats.historicCount, 2);
    });

    it('Sixth Doctor doubles historic MV but not non-historic', () => {
        const data = makeOpponentData([
            { name: 'Sol Ring', cmc: 1, type_line: 'Artifact', count: 4 },    // historic: 1 → 2
            { name: 'Opt', cmc: 1, type_line: 'Instant', count: 4 }            // non-historic: 1 → 1
        ]);
        const statsNormal = calculateMindsDilationStats(data, false);
        const statsDoctor = calculateMindsDilationStats(data, true);

        // Without doctor: all 8 cards have effective MV 1 → avg = 1
        assert.ok(Math.abs(statsNormal.avgEffectiveMV - 1.0) < 1e-9);

        // With doctor: 4 historic × 2 + 4 non-historic × 1 = 12 / 8 = 1.5
        assert.ok(Math.abs(statsDoctor.avgEffectiveMV - 1.5) < 1e-9);
    });

    it('Sixth Doctor raises evPerTrigger when historics present', () => {
        const data = makeOpponentData([
            { name: 'Island', cmc: 0, type_line: 'Basic Land — Island', count: 36 },
            { name: 'Sol Ring', cmc: 1, type_line: 'Artifact', count: 4 }
        ]);
        const statsNormal = calculateMindsDilationStats(data, false);
        const statsDoctor = calculateMindsDilationStats(data, true);
        assert.ok(statsDoctor.evPerTrigger > statsNormal.evPerTrigger);
    });

    it('mvBuckets sums to nonlandCount', () => {
        const data = makeOpponentData([
            { name: 'Island', cmc: 0, type_line: 'Basic Land — Island', count: 30 },
            { name: 'Opt', cmc: 1, type_line: 'Instant', count: 4 },
            { name: 'Wrath', cmc: 4, type_line: 'Sorcery', count: 4 },
            { name: 'Ulamog', cmc: 10, type_line: 'Legendary Creature — Eldrazi', count: 2 }
        ]);
        const stats = calculateMindsDilationStats(data);
        const bucketTotal = Object.values(stats.mvBuckets).reduce((a, b) => a + b, 0);
        assert.strictEqual(bucketTotal, stats.nonlandCount);
    });
});

describe('Mind’s Dilation — library details', () => {
    it('bands split the whole library and sum to 1', () => {
        const data = makeOpponentData([
            { name: 'Island', cmc: 0, type_line: 'Basic Land — Island', count: 36 },
            { name: 'Opt', cmc: 1, type_line: 'Instant', count: 30 },
            { name: 'Wrath', cmc: 4, type_line: 'Sorcery', count: 20 },
            { name: 'Ulamog', cmc: 10, type_line: 'Legendary Creature — Eldrazi', count: 13 }
        ]);
        const { bands } = calculateMindsDilationStats(data);
        assert.ok(Math.abs(bands.land + bands.cheap + bands.mid + bands.big - 1) < 1e-12);
        assert.ok(Math.abs(bands.big - 13 / 99) < 1e-12);
    });

    it('a modal double-faced spell // land is a castable spell, not a land', () => {
        const data = makeOpponentData([
            { name: 'Forest', cmc: 0, type_line: 'Basic Land — Forest', count: 3 },
            { name: 'Bala Ged Recovery // Bala Ged Sanctuary', cmc: 3, type_line: 'Sorcery // Land', count: 1 }
        ]);
        const stats = calculateMindsDilationStats(data);
        assert.strictEqual(stats.nonlandCount, 1);
        assert.strictEqual(stats.pNonland, 0.25);
    });

    it('The Sixth Doctor moves historic spells into higher value bands', () => {
        const data = makeOpponentData([
            { name: 'Sol Ring', cmc: 1, type_line: 'Artifact', count: 1 },
            { name: 'Bident', cmc: 3, type_line: 'Legendary Enchantment Artifact', count: 1 }
        ]);
        assert.strictEqual(calculateMindsDilationStats(data, false).bands.big, 0);
        assert.strictEqual(calculateMindsDilationStats(data, true).bands.big, 0.5);
    });
});

describe('roundStats', () => {
    it('adds hit chances and value across opponents', () => {
        const r = roundStats([{ pNonland: 0.6, evPerTrigger: 2 }, { pNonland: 0.7, evPerTrigger: 2.5 }]);
        assert.ok(Math.abs(r.spellsPerRound - 1.3) < 1e-12);
        assert.ok(Math.abs(r.manaPerRound - 4.5) < 1e-12);
        assert.ok(Math.abs(r.chanceAny - (1 - 0.4 * 0.3)) < 1e-12);
        assert.ok(Math.abs(r.paybackRounds - MINDS_DILATION_COST / 4.5) < 1e-12);
    });

    it('never pays back against an all-land library', () => {
        assert.strictEqual(roundStats([{ pNonland: 0, evPerTrigger: 0 }]).paybackRounds, Infinity);
        assert.strictEqual(formatRounds(Infinity), 'never');
    });

    it('formats rounds in plain words', () => {
        assert.strictEqual(formatRounds(0.8), 'under a round');
        assert.strictEqual(formatRounds(1.02), '1 round');
        assert.strictEqual(formatRounds(1.08), '1.1 rounds');
        assert.strictEqual(formatRounds(3.64), '3.6 rounds');
    });
});

describe('summarizeMindsDilation', () => {
    const stats = (p, mv) => ({ pNonland: p, avgEffectiveMV: mv, evPerTrigger: p * mv });

    it('is empty without opponents', () => {
        assert.deepStrictEqual(summarizeMindsDilation([]), { html: '', tone: 'flat' });
    });

    it('one opponent: hit rate per turn and a slow payback', () => {
        const line = summarizeMindsDilation([{ name: 'Solo', stats: stats(0.62, 3) }]);
        assert.strictEqual(line.tone, 'warn');
        assert.match(line.html, /If Solo casts a spell every turn/);
        assert.match(line.html, /62%/);
        assert.match(line.html, /3\.8 rounds/);
    });

    it('three opponents: free spells a round, chance of at least one, quick payback', () => {
        const line = summarizeMindsDilation([
            { name: 'A', stats: stats(0.69, 2.9) },
            { name: 'B', stats: stats(0.68, 2.9) },
            { name: 'C', stats: stats(0.71, 3.6) }
        ]);
        assert.strictEqual(line.tone, 'good');
        assert.match(line.html, /2\.1 free spells a round/);
        assert.match(line.html, /97%/);
        assert.match(line.html, /1\.1 rounds/);
    });

    it('mentions The Sixth Doctor when it is counted', () => {
        const line = summarizeMindsDilation([{ name: 'A', stats: stats(0.5, 2) }], { sixthDoctor: true });
        assert.match(line.html, /Sixth Doctor/);
        assert.strictEqual(line.tone, 'bad');
    });
});
