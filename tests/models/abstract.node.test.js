import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    simulateAbstractPerformance, bestFreeCastMV, bestFreeCast, buildLibrary, opponentBinsFaceUp,
    dealSampleCasts, summarize, outcomeTone
} from '../../js/utils/models/abstract.js';

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

describe('Abstract Performance - buildLibrary', () => {
    const cardsByName = {
        Forest: { name: 'Forest', count: 36, cmc: 0, type_line: 'Basic Land — Forest' },
        Bear: { name: 'Bear', count: 40, cmc: 2, type_line: 'Creature — Bear' },
        Titan: { name: 'Titan', count: 23, cmc: 6.0, type_line: 'Creature — Giant' }
    };

    it('includes lands (regression: cardDetails holds nonland cards only)', () => {
        const { deck, isDefault } = buildLibrary(cardsByName);
        assert.strictEqual(isDefault, false);
        assert.strictEqual(deck.length, 99);
        assert.strictEqual(deck.filter(c => c.isLand).length, 36);
        assert.strictEqual(deck.find(c => c.name === 'Titan').cmc, 6);
    });

    it('never deals a commander into a pile, even when the list holds both partners', () => {
        const deck = {
            cardsByName: {
                ...cardsByName,
                A: { name: 'Partner A', count: 1, cmc: 4, type_line: 'Legendary Creature — Human' },
                B: { name: 'Partner B', count: 1, cmc: 3, type_line: 'Legendary Creature — Elf' }
            },
            commanderName: 'Partner A',
            commanders: [{ name: 'Partner A' }, { name: 'Partner B' }],
            format: 'auto'
        };
        const { deck: library } = buildLibrary(deck);
        assert.strictEqual(library.length, 99);
        assert.ok(!library.some(c => c.name.startsWith('Partner')));
    });

    it('falls back to a typical deck without a decklist', () => {
        const { deck, isDefault } = buildLibrary({});
        assert.strictEqual(isDefault, true);
        assert.strictEqual(deck.length, 99);
        assert.ok(deck.some(c => c.isLand));
    });

    it('lets "nothing to cast" happen once lands are in the deck', () => {
        const { deck } = buildLibrary({
            Forest: { name: 'Forest', count: 90, cmc: 0, type_line: 'Land' },
            Bear: { name: 'Bear', count: 9, cmc: 2, type_line: 'Creature' }
        });
        const r = simulateAbstractPerformance(deck, 2000);
        assert.ok(r.realistic.dist[0] > 0.3, `expected many empty piles, got ${r.realistic.dist[0]}`);
    });
});

describe('Abstract Performance - helpers', () => {
    it('picks the highest-mana-value spell to cast', () => {
        const pile = [
            { name: 'Forest', cmc: 0, isLand: true },
            { name: 'Opt', cmc: 1, isLand: false },
            { name: 'Sphinx', cmc: 6, isLand: false }
        ];
        assert.strictEqual(bestFreeCast(pile).name, 'Sphinx');
        assert.strictEqual(bestFreeCast([{ name: 'Forest', cmc: 0, isLand: true }]), null);
    });

    it('bins the face-up pile only when it beats an average four cards', () => {
        const pile = mv => [{ cmc: mv }, { cmc: 0 }, { cmc: 0 }, { cmc: 0 }];
        assert.strictEqual(opponentBinsFaceUp(pile(10), 8), true);
        assert.strictEqual(opponentBinsFaceUp(pile(8), 8), false);
    });

    it('deals sample casts with a consistent story', () => {
        const deck = [];
        for (let i = 0; i < 40; i++) deck.push({ name: `Spell${i}`, cmc: i % 7, isLand: false });
        for (let i = 0; i < 40; i++) deck.push({ name: 'Land', cmc: 0, isLand: true });
        const samples = dealSampleCasts(deck, 6);
        assert.strictEqual(samples.length, 6);
        for (const s of samples) {
            assert.strictEqual(s.faceDown.length, 4);
            assert.strictEqual(s.faceUp.length, 4);
            const kept = s.binsFaceUp ? s.faceDown : s.faceUp;
            assert.strictEqual(s.cast?.cmc ?? 0, bestFreeCastMV(kept));
            assert.strictEqual(s.binsFaceUp, s.faceUpMV > s.expectedFourMV);
        }
        assert.deepStrictEqual(dealSampleCasts(deck.slice(0, 5)), []);
    });

    it('averages exact mana values while bucketing 10+ in the distribution', () => {
        const deck = [];
        for (let i = 0; i < 20; i++) deck.push({ name: 'Huge', cmc: 12, isLand: false });
        const r = simulateAbstractPerformance(deck, 50);
        assert.strictEqual(r.best.mean, 12);
        assert.strictEqual(r.best.dist[10], 1);
        assert.strictEqual(r.best.p50, 10);
    });
});

describe('Abstract Performance - summarize', () => {
    const deck = [];
    for (let i = 0; i < 36; i++) deck.push({ name: 'Land', cmc: 0, isLand: true });
    for (let i = 0; i < 63; i++) deck.push({ name: 'Spell', cmc: 1 + (i % 7), isLand: false });

    it('leads with the realistic opponent and brackets it with right and wrong picks', () => {
        const results = simulateAbstractPerformance(deck, 4000);
        const s = summarize({ results });
        assert.match(s.html, /usually leaves you a free <strong>\d+\+?-mana<\/strong> spell/);
        assert.match(s.html, /pick right you still average <strong>[\d.]+<\/strong>/);
        assert.match(s.html, /pick wrong, <strong>[\d.]+<\/strong>/);
        assert.ok(['good', 'warn', 'bad'].includes(s.tone));
    });

    it('says when it is using a typical deck', () => {
        const s = summarize({ results: simulateAbstractPerformance(deck, 500), isDefault: true });
        assert.match(s.html, /typical Commander deck/);
    });

    it('handles a library too small to deal', () => {
        const s = summarize({ results: null });
        assert.strictEqual(s.tone, 'flat');
        assert.doesNotThrow(() => summarize());
    });

    it('maps the realistic average to a tone', () => {
        assert.strictEqual(outcomeTone(5), 'good');
        assert.strictEqual(outcomeTone(3), 'warn');
        assert.strictEqual(outcomeTone(1), 'bad');
    });
});
