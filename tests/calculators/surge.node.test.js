import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import {
    buildDeckExcludingSurge,
    buildSurgeValueRanges,
    calculateSurgePayback,
    calculateSurgeRunValue,
    getDeckConfig,
    simulatePrimalSurge,
    summarize,
    surgeRunOdds
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

/** Every distinct ordering of a small library, each equally likely. */
function orderings(cards) {
    if (cards.length <= 1) return [cards];
    const out = [];
    const seen = new Set();
    cards.forEach((card, i) => {
        if (seen.has(card.key)) return;
        seen.add(card.key);
        const rest = cards.filter((_, j) => j !== i);
        for (const tail of orderings(rest)) out.push([card, ...tail]);
    });
    return out;
}

describe('Primal Surge exact odds', () => {
    it('gives the chance of reaching each run length, and the median', () => {
        const odds = surgeRunOdds(3, 2);
        assertClose(odds.atLeast[1], 3 / 5, 'first card is a permanent');
        assertClose(odds.atLeast[2], 3 / 5 * 2 / 4, 'first two');
        assertClose(odds.atLeast[3], 3 / 5 * 2 / 4 * 1 / 3, 'all three');
        assert.strictEqual(odds.median, 1);
        assertClose(odds.mean, 1, 'P / (NP + 1)');
        assert.strictEqual(surgeRunOdds(5, 0).median, 5, 'no stops: always the whole library');
    });

    it('matches a brute-force count of every library order', () => {
        const permanents = [
            { key: 'a', cmc: 1, isLand: false, count: 1 },
            { key: 'b', cmc: 2, isLand: false, count: 1 },
            { key: 'c', cmc: 0, isLand: true, count: 1 }
        ];
        const library = [...permanents, { key: 's', stop: true }, { key: 's', stop: true }];
        const settings = { threshold: 3, landValue: 1, cardValue: 0.5 };
        let paid = 0;
        const all = orderings(library);
        for (const order of all) {
            let value = 0;
            for (const card of order) {
                if (card.stop) break;
                value += card.cmc + settings.cardValue + (card.isLand ? settings.landValue : 0);
            }
            if (value >= settings.threshold) paid++;
        }
        const exact = calculateSurgePayback(permanents, 2, settings);
        assertClose(exact.paybackProbability, paid / all.length, 'subset-sum count agrees with enumeration');
    });
});

describe('Primal Surge bottom line', () => {
    const base = { permanents: 79, stops: 20, mean: 79 / 21, median: 2, threshold: 10, payback: 0.49 };

    it('names the stopping cards, the run, and the payback chance', () => {
        const { html, tone } = summarize(base);
        assert.match(html, /20 instants and sorceries/);
        assert.match(html, /3\.8 permanents/);
        assert.match(html, /half the time 2 or fewer/);
        assert.match(html, /49%/);
        assert.strictEqual(tone, 'warn');
    });

    it('suggests cutting stops only when it matters', () => {
        assert.match(summarize({ ...base, cutTo: { count: 5, payback: 0.58 } }).html, /Cutting 5 of them would lift that to <strong>58%/);
        assert.doesNotMatch(summarize({ ...base, cutTo: { count: 5, payback: 0.5 } }).html, /Cutting/);
        assert.match(summarize({ ...base, stops: 1, cutTo: { count: 1, payback: 0.9 } }).html, /Cutting that one/);
    });

    it('handles no stops, no permanents and counts-only decks', () => {
        const all = summarize({ ...base, stops: 0, payback: 1 });
        assert.strictEqual(all.tone, 'good');
        assert.match(all.html, /all 79 permanents/);
        assert.strictEqual(summarize({ ...base, permanents: 0 }).tone, 'bad');
        const counts = summarize({ ...base, payback: null });
        assert.strictEqual(counts.tone, 'flat');
        assert.match(counts.html, /Import your decklist/);
    });

    it('ignores a stale card list once the counts are edited by hand', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            DeckConfig.updateDeck({
                importSource: 'manual', creatures: 30, artifacts: 0, enchantments: 0, planeswalkers: 0,
                battles: 0, instants: 5, sorceries: 5, lands: 36, actualCardCount: null
            });
            const config = getDeckConfig();
            assert.strictEqual(config.mvKnown, false);
            assert.strictEqual(config.nonPermanents, 9, 'one sorcery is the Surge being cast');
            assert.strictEqual(config.deckSize, 75);
        } finally {
            DeckConfig.updateDeck(original);
        }
    });
});
