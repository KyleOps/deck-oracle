import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import {
    buildDeckExcludingSurge,
    buildSurgeValueRanges,
    calculateSurgePayback,
    calculateSurgeRunValue,
    getDeckConfig,
    simulatePrimalSurge
} from '../../js/calculators/surge.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Primal Surge Calculator', () => {
    it('calculates mathematical EV correctly', () => {
        const expectedVal = 50 / 11;
        const result = simulatePrimalSurge(60, 10, 50);
        assertClose(result.expectedPermanents, expectedVal, 'Expected Value calculation');
    });

    it('handles edge case: 0 non-permanents (full deck)', () => {
        const resultFull = simulatePrimalSurge(60, 0, 60);
        assertClose(resultFull.expectedPermanents, 60, 'Full Deck calculation');
    });

    it('handles edge case: all non-permanents', () => {
        const resultNone = simulatePrimalSurge(60, 60, 0);
        assertClose(resultNone.expectedPermanents, 0, '0 Perms calculation');
    });

    it('counts lands and cards put into play on top of raw mana value', () => {
        const result = calculateSurgeRunValue({
            manaValue: 3,
            lands: 5,
            permanents: 8
        }, {
            threshold: 10,
            landValue: 1,
            cardValue: 0.25
        });

        assert.equal(result.effectiveValue, 10);
        assert.equal(result.paidBack, true);
    });

    it('classifies value strictly below the threshold as a whiff', () => {
        const result = calculateSurgeRunValue({
            manaValue: 3,
            lands: 5,
            permanents: 7
        }, {
            threshold: 10,
            landValue: 1,
            cardValue: 0.25
        });

        assert.equal(result.effectiveValue, 9.75);
        assert.equal(result.paidBack, false);
    });

    it('calculates exact payback odds across possible stopping positions', () => {
        const result = calculateSurgePayback([
            { cmc: 1, isLand: false, count: 2 }
        ], 1, {
            threshold: 2,
            landValue: 0,
            cardValue: 0
        });

        // The one non-permanent is equally likely to be first, second, or
        // third. Only the third position lets both one-drops enter.
        assertClose(result.paybackProbability, 1 / 3, 'Payback probability');
        assertClose(result.whiffProbability, 2 / 3, 'Whiff probability');
    });

    it('handles a no-stop library as one deterministic full-deck result', () => {
        const paid = calculateSurgePayback([
            { cmc: 0, isLand: true, count: 5 },
            { cmc: 1, isLand: false, count: 3 }
        ], 0, {
            threshold: 10,
            landValue: 1,
            cardValue: 0.25
        });

        assert.equal(paid.expectedEffectiveValue, 10);
        assert.equal(paid.paybackProbability, 1);
        assert.equal(paid.whiffProbability, 0);
    });

    it('removes only the cast Primal Surge, preserving other sorceries', () => {
        const library = buildDeckExcludingSurge({ cardsByName: {
            Cultivate: { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, count: 1 },
            Surge: { name: 'Primal Surge', type_line: 'Sorcery', cmc: 10, count: 2 },
            Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 1 }
        } });

        assert.deepEqual(library.map(card => card.name), ['Cultivate', 'Primal Surge', 'Forest']);
    });

    it('does not remove an unrelated spell when Surge is absent from the imported list', () => {
        const cardData = { cardsByName: {
            Cultivate: { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, count: 1 },
            Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 1 }
        } };

        assert.deepEqual(buildDeckExcludingSurge(cardData).map(card => card.name), ['Cultivate', 'Forest']);
    });

    it('keeps exact odds and sampled library sizes aligned with the named card', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            const cardsByName = {
                Cultivate: { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, count: 1 },
                Surge: { name: 'Primal Surge', type_line: 'Sorcery', cmc: 10, count: 1 },
                Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 2 }
            };
            DeckConfig.updateDeck({
                creatures: 0, artifacts: 0, enchantments: 0, planeswalkers: 0,
                battles: 0, instants: 0, sorceries: 2, lands: 2,
                actualCardCount: 4, cardsByName
            });
            assert.equal(getDeckConfig().deckSize, buildDeckExcludingSurge({ cardsByName }).length);
            assert.equal(getDeckConfig().nonPermanents, 1);

            cardsByName.Surge = { name: 'Impulsive Research', type_line: 'Sorcery', cmc: 4, count: 1 };
            DeckConfig.updateDeck({ cardsByName });
            assert.equal(getDeckConfig().deckSize, 4);
            assert.equal(getDeckConfig().nonPermanents, 2);
        } finally {
            DeckConfig.updateDeck(original);
        }
    });

    it('covers every sampled result with non-overlapping ranges split at the payback threshold', () => {
        const values = [0, 4.9, 10, 10.25, 25, 999];
        const ranges = buildSurgeValueRanges(values, 10.25);

        assert.equal(ranges.reduce((sum, range) => sum + range.count, 0), values.length);
        assert.equal(ranges.filter(range => !range.paidBack).reduce((sum, range) => sum + range.count, 0), 3);
        assert.equal(ranges.filter(range => range.paidBack).reduce((sum, range) => sum + range.count, 0), 3);
        assert.ok(ranges.filter(range => !range.paidBack).every(range => range.end <= 10.25));
        assert.ok(ranges.filter(range => range.paidBack).every(range => range.start >= 10.25));
        assert.equal(ranges.at(-1).count, 1, 'the long-tail result remains visible');
        assert.ok(ranges.length <= 13, 'wide spreads should remain readable');
    });
});
