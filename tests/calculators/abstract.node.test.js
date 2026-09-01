import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import { simulateAbstractPerformance, bestFreeCastMV } from '../../js/calculators/abstract.js';

describe('Abstract Performance - bestFreeCastMV', () => {
    it('returns 0 for an all-land pile', () => {
        const pile = [
            { name: 'Forest', cmc: 0, isLand: true },
            { name: 'Island', cmc: 0, isLand: true },
            { name: 'Plains', cmc: 0, isLand: true },
            { name: 'Mountain', cmc: 0, isLand: true },
        ];
        assert.strictEqual(bestFreeCastMV(pile), 0);
    });

    it('returns the highest spell CMC', () => {
        const pile = [
            { name: 'Forest', cmc: 0, isLand: true },
            { name: 'Opt', cmc: 1, isLand: false },
            { name: 'Counterspell', cmc: 2, isLand: false },
            { name: 'Consecrated Sphinx', cmc: 6, isLand: false },
        ];
        assert.strictEqual(bestFreeCastMV(pile), 6);
    });

    it('ignores land CMC when computing max', () => {
        const pile = [
            { name: 'Gaea\'s Cradle', cmc: 0, isLand: true },
            { name: 'Birds of Paradise', cmc: 1, isLand: false },
            { name: 'Forest', cmc: 0, isLand: true },
            { name: 'Forest', cmc: 0, isLand: true },
        ];
        assert.strictEqual(bestFreeCastMV(pile), 1);
    });

    it('handles empty pile', () => {
        assert.strictEqual(bestFreeCastMV([]), 0);
    });
});

describe('Abstract Performance - simulateAbstractPerformance', () => {
    const buildDeck = () => {
        const deck = [];
        // 36 lands, 63 spells with varied CMC
        for (let i = 0; i < 36; i++) deck.push({ name: 'Land', cmc: 0, isLand: true });
        for (let i = 0; i < 10; i++) deck.push({ name: 'Spell1', cmc: 1, isLand: false });
        for (let i = 0; i < 15; i++) deck.push({ name: 'Spell2', cmc: 2, isLand: false });
        for (let i = 0; i < 12; i++) deck.push({ name: 'Spell3', cmc: 3, isLand: false });
        for (let i = 0; i < 10; i++) deck.push({ name: 'Spell4', cmc: 4, isLand: false });
        for (let i = 0; i < 8; i++) deck.push({ name: 'Spell5', cmc: 5, isLand: false });
        for (let i = 0; i < 5; i++) deck.push({ name: 'Spell6', cmc: 6, isLand: false });
        for (let i = 0; i < 3; i++) deck.push({ name: 'Spell7', cmc: 7, isLand: false });
        return deck;
    };

    it('returns results object with all three scenarios', () => {
        const deck = buildDeck();
        const results = simulateAbstractPerformance(deck, 100);
        assert.ok(results !== null, 'Should return results');
        assert.ok('best' in results, 'Should have best');
        assert.ok('realistic' in results, 'Should have realistic');
        assert.ok('worst' in results, 'Should have worst');
    });

    it('best case has higher mean than worst case', () => {
        const deck = buildDeck();
        const results = simulateAbstractPerformance(deck, 5000);
        assert.ok(results.best.mean >= results.worst.mean,
            `Best (${results.best.mean.toFixed(3)}) should >= worst (${results.worst.mean.toFixed(3)})`);
    });

    it('realistic case falls between best and worst', () => {
        const deck = buildDeck();
        const results = simulateAbstractPerformance(deck, 5000);
        const { best, realistic, worst } = results;
        assert.ok(realistic.mean >= worst.mean - 0.1,
            `Realistic mean ${realistic.mean.toFixed(3)} should be >= worst ${worst.mean.toFixed(3)}`);
        assert.ok(realistic.mean <= best.mean + 0.1,
            `Realistic mean ${realistic.mean.toFixed(3)} should be <= best ${best.mean.toFixed(3)}`);
    });

    it('distributions sum to 1 (within floating point tolerance)', () => {
        const deck = buildDeck();
        const results = simulateAbstractPerformance(deck, 1000);
        for (const scenario of ['best', 'realistic', 'worst']) {
            const total = results[scenario].dist.reduce((s, v) => s + v, 0);
            assert.ok(Math.abs(total - 1.0) < 0.01,
                `${scenario} dist should sum to ~1, got ${total}`);
        }
    });

    it('returns null for a deck with fewer than 8 cards', () => {
        const deck = [
            { name: 'A', cmc: 1, isLand: false },
            { name: 'B', cmc: 2, isLand: false },
        ];
        assert.strictEqual(simulateAbstractPerformance(deck, 100), null);
    });

    it('mean is positive when deck has spells', () => {
        const deck = buildDeck();
        const results = simulateAbstractPerformance(deck, 1000);
        assert.ok(results.best.mean > 0, 'Best mean should be > 0 with spells in deck');
    });

    it('mean is 0 when deck is all lands', () => {
        const deck = [];
        for (let i = 0; i < 99; i++) deck.push({ name: 'Land', cmc: 0, isLand: true });
        const results = simulateAbstractPerformance(deck, 200);
        assert.ok(results !== null);
        assert.strictEqual(results.best.mean, 0);
        assert.strictEqual(results.worst.mean, 0);
        assert.strictEqual(results.realistic.mean, 0);
    });
});
