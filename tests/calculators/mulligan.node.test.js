import { describe, it } from 'node:test';
import { assert, assertClose } from '../node-test-helper.js';
import { calculate, calcMultiTypeSuccess, runSampleReveals } from '../../js/calculators/mulligan.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Mulligan Strategy Calculator', () => {

    describe('Hypergeometric Math (Sequential Deadlines)', () => {
        it('calculates sequential deadlines correctly (A by T1, B by T2)', () => {
            const types = [
                { id: 1, count: 1, required: 1, byTurn: 1 },
                { id: 2, count: 1, required: 1, byTurn: 2 }
            ];
            const hand = [0, 0];
            const deckSize = 17;

            const result = calcMultiTypeSuccess(deckSize, types, hand);
            assertClose(result, 1/90, 'Sequential A(T1), B(T2)');
        });

        it('calculates same-turn deadlines correctly (A and B by T2)', () => {
            const types = [
                { id: 1, count: 1, required: 1, byTurn: 2 },
                { id: 2, count: 1, required: 1, byTurn: 2 }
            ];
            const hand = [0, 0];
            const deckSize = 17;

            const result = calcMultiTypeSuccess(deckSize, types, hand);
            assertClose(result, 1/45, 'Same deadline A, B (T2)');
        });
    });

    describe('Strategy Calculation', () => {
        it('generates a valid strategy for a standard deck', () => {
            DeckConfig.updateDeck({
                lands: 36
            });
            const { result } = calculate();
            assert.ok(result.expectedSuccess >= 0 && result.expectedSuccess <= 1, 'Success rate should be valid probability');
            assert.ok(result.strategy.length > 0, 'Strategy entries should be generated');
        });
    });

    describe('Sample Reveals', () => {
        it('generates sample reveal content when card data is present', () => {
            DeckConfig.updateDeck({
                lands: 24,
                cardsByName: {
                    'Land': { name: 'Land', cmc: 0, count: 24, type_line: 'Land', mana_cost: '' },
                    'Spell': { name: 'Spell', cmc: 1, count: 36, type_line: 'Instant', mana_cost: '{1}' }
                }
            });

            const display = global.document.getElementById('mulligan-reveals-display');
            display.innerHTML = '';
            runSampleReveals();
            assert.ok(display.innerHTML.length > 0, 'Sample reveals should generate content');
        });
    });
});
