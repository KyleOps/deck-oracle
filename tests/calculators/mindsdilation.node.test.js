/**
 * Tests for Mind's Dilation calculator
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateMindsDilationStats } from '../../js/calculators/mindsdilation.js';

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
