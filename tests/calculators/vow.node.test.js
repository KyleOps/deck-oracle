import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import { simulateVow } from '../../js/calculators/vow.js';

describe('Kamahl\'s Druidic Vow Calculator', () => {
    // Distribution contains counts of VALID HITS only
    const distribution = {
        0: 30, // Lands
        3: 10, // Legendary Permanents with CMC 3
        5: 5   // Legendary Permanents with CMC 5
    };
    // Deck size includes non-hits too
    const deckSize = 60; // 30 lands + 15 legends + 15 non-hits

    it('calculates mathematical EV correctly for X=4', () => {
        // Valid hits at X=4: Lands (30) + 3-drop Legends (10) = 40 hits
        const x = 4;
        const result = simulateVow(deckSize, distribution, x);
        const expected = x * (40 / deckSize); // 4 * (40/60) = 2.66...
        assertClose(result.expectedHits, expected, 'EV calculation for X=4');
    });

    it('calculates EV correctly for X=6', () => {
        // Valid hits at X=6: Lands (30) + 3-drop (10) + 5-drop (5) = 45 hits
        const x = 6;
        const result = simulateVow(deckSize, distribution, x);
        const expected = x * (45 / deckSize); // 6 * (45/60) = 4.5
        assertClose(result.expectedHits, expected, 'EV calculation for X=6');
    });

    it('handles edge case: X=0', () => {
        const result0 = simulateVow(deckSize, distribution, 0);
        assertClose(result0.expectedHits, 0, 'X=0 results in 0 hits');
    });

    it('handles edge case: X=2 (Only Lands valid)', () => {
        // Valid hits at X=2: Lands (30) only
        const result2 = simulateVow(deckSize, distribution, 2);
        const expected = 2 * (30 / deckSize); // 2 * 0.5 = 1
        assertClose(result2.expectedHits, expected, 'X=2 calculation');
    });

    it('returns detailed breakdown (lands, legends, mana value)', () => {
        // Create mock card data for breakdown testing
        const mockCardData = {
            cardsByName: {
                'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 30 },
                'Ragavan': { name: 'Ragavan, Nimble Pilferer', type_line: 'Legendary Creature — Monkey Pirate', cmc: 1, count: 1 },
                'Omnath': { name: 'Omnath, Locus of Creation', type_line: 'Legendary Creature — Elemental', cmc: 4, count: 1 },
                'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, count: 1 }, // Not legendary, shouldn't count
                'Lightning Bolt': { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, count: 1 } // Not a permanent
            }
        };

        const result = simulateVow(34, distribution, 5, false, mockCardData);

        // Verify all breakdown fields exist
        assert.ok(result.expectedLands !== undefined, 'Should return expectedLands');
        assert.ok(result.expectedLegends !== undefined, 'Should return expectedLegends');
        assert.ok(result.expectedManaValue !== undefined, 'Should return expectedManaValue');

        // expectedLands should be based on 30 lands out of 34 cards, revealing 5
        assertClose(result.expectedLands, 5 * (30/34), 'Expected lands calculation');

        // expectedLegends should be based on 2 legendaries (Ragavan + Omnath) out of 34 cards
        assertClose(result.expectedLegends, 5 * (2/34), 'Expected legends calculation');
    });

    it('doubles card count when doubleCast is true', () => {
        const mockCardData = {
            cardsByName: {
                'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 30 },
                'Gaea\'s Cradle': { name: 'Gaea\'s Cradle', type_line: 'Legendary Land', cmc: 0, count: 1 }
            }
        };

        const normal = simulateVow(31, { 0: 31 }, 5, false, mockCardData);
        const doubled = simulateVow(31, { 0: 31 }, 5, true, mockCardData);

        // Double cast should reveal 2X cards (10 instead of 5)
        assertClose(doubled.expectedHits, normal.expectedHits * 2, 'Should double expected hits');
        assertClose(doubled.expectedLands, normal.expectedLands * 2, 'Should double expected lands');
        assertClose(doubled.expectedLegends, normal.expectedLegends * 2, 'Should double expected legends');
    });

    it('handles deck with no legendaries', () => {
        const landsOnly = { 0: 30 }; // 30 lands, 30 non-permanents
        const mockCardData = {
            cardsByName: {
                'Forest': { name: 'Forest', type_line: 'Basic Land', cmc: 0, count: 30 },
                'Lightning Bolt': { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, count: 30 }
            }
        };

        const result = simulateVow(60, landsOnly, 10, false, mockCardData);

        assert.strictEqual(result.expectedLegends, 0, 'Should have 0 expected legends');
        assertClose(result.expectedLands, 10 * (30/60), 'Should only count lands');
    });

    it('handles deck with all legendaries', () => {
        const allLegends = { 3: 60 }; // 60 CMC 3 legendary permanents
        const mockCardData = {
            cardsByName: {
                'Ragavan': { name: 'Ragavan, Nimble Pilferer', type_line: 'Legendary Creature — Monkey', cmc: 3, count: 60 }
            }
        };

        const result = simulateVow(60, allLegends, 5, false, mockCardData);

        assert.strictEqual(result.expectedLands, 0, 'Should have 0 expected lands');
        assertClose(result.expectedLegends, 5, 'Should expect ~5 legends from 5 reveals');
    });

    it('correctly excludes non-legendary permanents from legend count', () => {
        const mockCardData = {
            cardsByName: {
                'Ragavan': { name: 'Ragavan', type_line: 'Legendary Creature', cmc: 1, count: 10 },
                'Grizzly Bears': { name: 'Grizzly Bears', type_line: 'Creature — Bear', cmc: 2, count: 10 },
                'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, count: 10 }
            }
        };

        const result = simulateVow(30, { 1: 20, 2: 10 }, 5, false, mockCardData);

        // Only Ragavan should count as legendary
        assertClose(result.expectedLegends, 5 * (10/30), 'Only legendary cards should count');
    });
});
