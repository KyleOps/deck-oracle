import { describe, it } from 'node:test';
import assert from 'node:assert';
import { simulateDreamHarvest, calculateDreamHarvestStats } from '../../js/calculators/dreamharvest.js';

describe('Dream Harvest Calculator', () => {
    describe('simulateDreamHarvest', () => {
        it('stops when total MV reaches 5', () => {
            const deck = [
                { name: 'Forest', types: ['land'], cmc: 0 },
                { name: 'Mountain', types: ['land'], cmc: 0 },
                { name: 'Lightning Bolt', types: ['instant'], cmc: 1 },
                { name: 'Counterspell', types: ['instant'], cmc: 2 },
                { name: 'Cultivate', types: ['sorcery'], cmc: 3 }
            ];

            const result = simulateDreamHarvest(deck);

            // Should exile: Forest(0) + Mountain(0) + Bolt(1) + Counterspell(2) + Cultivate(3) = 6 MV
            // Stops at Cultivate since 1+2+3 = 6 >= 5
            assert.strictEqual(result.totalMV >= 5, true, 'Total MV should be at least 5');
            assert.strictEqual(result.cardsExiled, 5, 'Should exile 5 cards to reach MV 5+');
        });

        it('returns first card if it has MV >= 5', () => {
            const deck = [
                { name: 'Ulamog', types: ['creature'], cmc: 10 },
                { name: 'Forest', types: ['land'], cmc: 0 }
            ];

            const result = simulateDreamHarvest(deck);

            assert.strictEqual(result.cardsExiled, 1, 'Should exile only 1 card');
            assert.strictEqual(result.totalMV, 10, 'Total MV should be 10');
            assert.strictEqual(result.numCastable, 1, 'Should have 1 castable spell');
        });

        it('handles all lands (MV never reaches 5)', () => {
            const deck = [
                { name: 'Forest', types: ['land'], cmc: 0 },
                { name: 'Mountain', types: ['land'], cmc: 0 },
                { name: 'Island', types: ['land'], cmc: 0 }
            ];

            const result = simulateDreamHarvest(deck);

            assert.strictEqual(result.cardsExiled, 3, 'Should exile entire deck');
            assert.strictEqual(result.totalMV, 0, 'Total MV should be 0');
            assert.strictEqual(result.numCastable, 0, 'No castable spells (all lands)');
        });

        it('correctly identifies castable spells (non-lands)', () => {
            const deck = [
                { name: 'Forest', types: ['land'], cmc: 0 },
                { name: 'Sol Ring', types: ['artifact'], cmc: 1 },
                { name: 'Signet', types: ['artifact'], cmc: 2 },
                { name: 'Commander Sphere', types: ['artifact'], cmc: 3 }
            ];

            const result = simulateDreamHarvest(deck);

            // Forest(0) + Sol Ring(1) + Signet(2) + Sphere(3) = 6 MV
            assert.strictEqual(result.numCastable, 3, 'Should have 3 castable spells');
            assert.strictEqual(result.totalCastableMV, 6, 'Castable spells total MV should be 6');
        });

        it('handles exactly MV 5 threshold', () => {
            const deck = [
                { name: 'Lightning Bolt', types: ['instant'], cmc: 1 },
                { name: 'Negate', types: ['instant'], cmc: 2 },
                { name: 'Cultivate', types: ['sorcery'], cmc: 2 },
                { name: 'Extra Card', types: ['creature'], cmc: 4 }
            ];

            const result = simulateDreamHarvest(deck);

            // Bolt(1) + Negate(2) + Cultivate(2) = 5 MV exactly
            assert.strictEqual(result.totalMV, 5, 'Should stop at exactly MV 5');
            assert.strictEqual(result.cardsExiled, 3, 'Should exile 3 cards');
        });
    });

    describe('calculateDreamHarvestStats', () => {
        it('returns null for empty deck data', () => {
            const emptyData = { cardsByName: {} };
            const result = calculateDreamHarvestStats(emptyData);
            assert.strictEqual(result, null);
        });

        it('returns null for missing cardsByName', () => {
            const result = calculateDreamHarvestStats({});
            assert.strictEqual(result, null);
        });

        it('returns valid structure for populated deck', () => {
            const deckData = {
                cardsByName: {
                    'Forest': { name: 'Forest', type_line: 'Basic Land - Forest', cmc: 0, count: 20 },
                    'Lightning Bolt': { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, count: 4 },
                    'Grizzly Bears': { name: 'Grizzly Bears', type_line: 'Creature - Bear', cmc: 2, count: 4 },
                    'Harmonize': { name: 'Harmonize', type_line: 'Sorcery', cmc: 4, count: 4 }
                }
            };

            const result = calculateDreamHarvestStats(deckData, 100);

            assert.ok(result !== null, 'Should return results');
            assert.ok(typeof result.avgCardsExiled === 'number', 'avgCardsExiled should be number');
            assert.ok(typeof result.avgTotalMV === 'number', 'avgTotalMV should be number');
            assert.ok(typeof result.avgCastable === 'number', 'avgCastable should be number');
            assert.ok(typeof result.avgCastableMV === 'number', 'avgCastableMV should be number');
            assert.ok(result.avgTotalMV >= 5, 'avgTotalMV should be at least 5 (threshold)');
        });

        it('calculates reasonable averages', () => {
            // Deck with mix of lands and spells
            const deckData = {
                cardsByName: {
                    'Forest': { name: 'Forest', type_line: 'Basic Land - Forest', cmc: 0, count: 30 },
                    'Bear': { name: 'Bear', type_line: 'Creature', cmc: 2, count: 20 },
                    'Angel': { name: 'Angel', type_line: 'Creature', cmc: 5, count: 10 }
                }
            };

            const result = calculateDreamHarvestStats(deckData, 500);

            // With this deck composition, we should exile multiple cards on average
            assert.ok(result.avgCardsExiled >= 1 && result.avgCardsExiled <= 10,
                `avgCardsExiled should be reasonable, got ${result.avgCardsExiled}`);

            // Total MV should be around 5-7 on average (stopping at threshold)
            assert.ok(result.avgTotalMV >= 5 && result.avgTotalMV <= 12,
                `avgTotalMV should be around threshold, got ${result.avgTotalMV}`);

            // Should have some castable spells on average
            assert.ok(result.avgCastable >= 0.5,
                `avgCastable should have some spells, got ${result.avgCastable}`);
        });
    });
});
