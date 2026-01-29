import { describe, it } from 'node:test';
import assert from 'node:assert';
import { simulateChoice1, simulateChoice2, calculateMaraStats } from '../../js/calculators/mara.js';

describe('Mara Calculator', () => {
    describe('simulateChoice1', () => {
        it('stops at first nonland card', () => {
            const deck = [
                { name: 'Forest', types: ['land'], cmc: 0 },
                { name: 'Mountain', types: ['land'], cmc: 0 },
                { name: 'Llanowar Elves', types: ['creature'], cmc: 1 }
            ];

            const result = simulateChoice1(deck);

            assert.strictEqual(result.cardsExiled, 3, 'Should exile 3 cards (2 lands + 1 creature)');
            assert.strictEqual(result.spellCMC, 1, 'Spell CMC should be 1');
            assert.strictEqual(result.spellName, 'Llanowar Elves', 'Should return correct spell name');
        });

        it('returns first card if it is nonland', () => {
            const deck = [
                { name: 'Sol Ring', types: ['artifact'], cmc: 1 },
                { name: 'Forest', types: ['land'], cmc: 0 }
            ];

            const result = simulateChoice1(deck);

            assert.strictEqual(result.cardsExiled, 1, 'Should exile only 1 card');
            assert.strictEqual(result.spellCMC, 1, 'Spell CMC should be 1');
            assert.strictEqual(result.spellName, 'Sol Ring');
        });

        it('handles all lands edge case', () => {
            const deck = [
                { name: 'Forest', types: ['land'], cmc: 0 },
                { name: 'Mountain', types: ['land'], cmc: 0 },
                { name: 'Island', types: ['land'], cmc: 0 }
            ];

            const result = simulateChoice1(deck);

            assert.strictEqual(result.cardsExiled, 3, 'Should exile entire deck');
            assert.strictEqual(result.spellCMC, 0, 'Spell CMC should be 0');
            assert.strictEqual(result.spellName, null, 'No spell should be found');
        });

        it('handles artifact creatures correctly', () => {
            const deck = [
                { name: 'Forest', types: ['land'], cmc: 0 },
                { name: 'Solemn Simulacrum', types: ['artifact', 'creature'], cmc: 4 }
            ];

            const result = simulateChoice1(deck);

            assert.strictEqual(result.cardsExiled, 2, 'Should exile 2 cards');
            assert.strictEqual(result.spellCMC, 4, 'Spell CMC should be 4');
            assert.deepStrictEqual(result.spellTypes, ['artifact', 'creature']);
        });

        it('handles high CMC spells', () => {
            const deck = [
                { name: 'Ulamog', types: ['creature'], cmc: 10 }
            ];

            const result = simulateChoice1(deck);

            assert.strictEqual(result.cardsExiled, 1);
            assert.strictEqual(result.spellCMC, 10);
        });
    });

    describe('simulateChoice2', () => {
        it('sums CMC of top 4 cards', () => {
            const deck = [
                { name: 'Card1', cmc: 2, types: ['creature'] },
                { name: 'Card2', cmc: 3, types: ['sorcery'] },
                { name: 'Card3', cmc: 0, types: ['land'] },
                { name: 'Card4', cmc: 5, types: ['enchantment'] },
                { name: 'Card5', cmc: 1, types: ['instant'] }
            ];

            const result = simulateChoice2(deck);

            assert.strictEqual(result.damage, 10, 'Damage should be 2+3+0+5=10');
            assert.strictEqual(result.cards.length, 4, 'Should return 4 cards');
        });

        it('handles deck with fewer than 4 cards', () => {
            const deck = [
                { name: 'Card1', cmc: 3, types: ['creature'] },
                { name: 'Card2', cmc: 2, types: ['sorcery'] }
            ];

            const result = simulateChoice2(deck);

            assert.strictEqual(result.damage, 5, 'Damage should be 3+2=5');
            assert.strictEqual(result.cards.length, 2);
        });

        it('handles all lands (0 damage)', () => {
            const deck = [
                { name: 'Forest', cmc: 0, types: ['land'] },
                { name: 'Mountain', cmc: 0, types: ['land'] },
                { name: 'Island', cmc: 0, types: ['land'] },
                { name: 'Swamp', cmc: 0, types: ['land'] }
            ];

            const result = simulateChoice2(deck);

            assert.strictEqual(result.damage, 0, 'All lands should deal 0 damage');
        });

        it('handles missing cmc property', () => {
            const deck = [
                { name: 'Card1', types: ['creature'] }, // no cmc
                { name: 'Card2', cmc: 3, types: ['sorcery'] },
                { name: 'Card3', cmc: undefined, types: ['land'] },
                { name: 'Card4', cmc: 2, types: ['enchantment'] }
            ];

            const result = simulateChoice2(deck);

            assert.strictEqual(result.damage, 5, 'Should handle missing CMC as 0');
        });
    });

    describe('calculateMaraStats', () => {
        it('returns null for empty deck data', () => {
            const emptyData = { cardsByName: {} };
            const result = calculateMaraStats(emptyData);
            assert.strictEqual(result, null);
        });

        it('returns null for missing cardsByName', () => {
            const result = calculateMaraStats({});
            assert.strictEqual(result, null);
        });

        it('returns valid structure for populated deck', () => {
            const deckData = {
                cardsByName: {
                    'Forest': { name: 'Forest', type_line: 'Basic Land - Forest', cmc: 0, count: 20 },
                    'Lightning Bolt': { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, count: 4 },
                    'Grizzly Bears': { name: 'Grizzly Bears', type_line: 'Creature - Bear', cmc: 2, count: 4 }
                }
            };

            const result = calculateMaraStats(deckData, 100); // Small sim count for speed

            assert.ok(result !== null, 'Should return results');
            assert.ok(result.choice1, 'Should have choice1 stats');
            assert.ok(result.choice2, 'Should have choice2 stats');
            assert.ok(typeof result.choice1.avgCMC === 'number', 'avgCMC should be number');
            assert.ok(typeof result.choice1.avgExiled === 'number', 'avgExiled should be number');
            assert.ok(typeof result.choice2.avgDamage === 'number', 'avgDamage should be number');
            assert.ok(result.choice2.minDamage <= result.choice2.maxDamage, 'min should be <= max');
        });

        it('calculates reasonable averages', () => {
            // Deck with 50% lands, average nonland CMC of 2
            const deckData = {
                cardsByName: {
                    'Forest': { name: 'Forest', type_line: 'Basic Land - Forest', cmc: 0, count: 50 },
                    'Bear': { name: 'Bear', type_line: 'Creature', cmc: 2, count: 50 }
                }
            };

            const result = calculateMaraStats(deckData, 1000);

            // Choice 1: With 50% lands, expect ~2 cards exiled on average (1 land + 1 nonland)
            assert.ok(result.choice1.avgExiled >= 1 && result.choice1.avgExiled <= 4,
                `avgExiled should be reasonable, got ${result.choice1.avgExiled}`);

            // Choice 1: All nonlands are CMC 2
            assert.ok(result.choice1.avgCMC >= 1.5 && result.choice1.avgCMC <= 2.5,
                `avgCMC should be near 2, got ${result.choice1.avgCMC}`);

            // Choice 2: 50% of cards are CMC 0 (lands), 50% are CMC 2
            // Expected avg per card: 1, expected for 4 cards: 4
            assert.ok(result.choice2.avgDamage >= 2 && result.choice2.avgDamage <= 6,
                `avgDamage should be around 4, got ${result.choice2.avgDamage}`);
        });
    });
});
