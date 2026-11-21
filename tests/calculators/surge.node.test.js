import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import {
    buildDeckExcludingSurge,
    calculateSurgePayback,
    calculateSurgeRunValue,
    getDeckConfig,
    simulatePrimalSurge,
    summarize,
    surgeCastPlan,
    surgeDots,
    surgeRunOdds,
    surgeRunPmf,
    surgeValuePmf
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

            // A new deck is a new object (DeckConfig never edits a list in place).
            DeckConfig.updateDeck({ cardsByName: { ...cardsByName, Surge: { name: 'Impulsive Research', type_line: 'Sorcery', cmc: 4, count: 1 } } });
            assert.equal(getDeckConfig().deckSize, 4);
            assert.equal(getDeckConfig().nonPermanents, 2);
        } finally {
            DeckConfig.updateDeck(original);
        }
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

describe('Primal Surge exact distributions (out of 100 casts)', () => {
    const permanents = [
        { key: 'a', cmc: 1, isLand: false, count: 1 },
        { key: 'b', cmc: 2, isLand: false, count: 1 },
        { key: 'c', cmc: 0, isLand: true, count: 1 }
    ];
    const settings = { threshold: 3, landValue: 1, cardValue: 0.5 };

    it('gives the exact chance of each run length', () => {
        const pmf = surgeRunPmf(3, 2);
        assertClose(pmf.reduce((a, b) => a + b, 0), 1, 'sums to one');
        assertClose(pmf[0], 2 / 5, 'first card stops it');
        assertClose(pmf[3], 3 / 5 * 2 / 4 * 1 / 3, 'all three, then a stop');
        assert.deepStrictEqual(surgeRunPmf(4, 0), [0, 0, 0, 0, 1], 'no stops: the whole library');
    });

    it('matches a brute-force count of every library order, value by value', () => {
        const library = [...permanents, { key: 's', stop: true }, { key: 's', stop: true }];
        const all = orderings(library);
        const counts = new Map();
        for (const order of all) {
            let value = 0;
            for (const card of order) {
                if (card.stop) break;
                value += card.cmc + settings.cardValue + (card.isLand ? settings.landValue : 0);
            }
            counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        const pmf = surgeValuePmf(permanents, 2, settings);
        assertClose(pmf.reduce((a, e) => a + e.p, 0), 1, 'sums to one');
        for (const { value, p } of pmf) assertClose(p, (counts.get(value) ?? 0) / all.length, `value ${value}`);
        const paid = pmf.filter(e => e.value >= settings.threshold).reduce((a, e) => a + e.p, 0);
        assertClose(paid, calculateSurgePayback(permanents, 2, settings).paybackProbability, 'agrees with the payback chance');
    });

    it('draws 100 dots, and both views agree on how many paid for themselves', () => {
        const cards = [
            { cmc: 0, isLand: true, count: 30 },
            { cmc: 2, isLand: false, count: 20 },
            { cmc: 5, isLand: false, count: 10 }
        ];
        const s = { threshold: 10, landValue: 1, cardValue: 0.25 };
        const payback = calculateSurgePayback(cards, 15, s).paybackProbability;
        const valuePmf = surgeValuePmf(cards, 15, s);
        // Short runs never pay, long ones always do (shape only; the page passes its real subset table).
        const shortBySize = Array.from({ length: 61 }, (_, k) => (k < 3 ? 1 : k < 6 ? 0.5 : 0));
        const dots = surgeDots({ permanents: 60, stops: 15, table: { shortBySize }, valuePmf, threshold: 10 });
        assert.strictEqual(dots.permanents.length, 100);
        assert.strictEqual(dots.value.length, 100);
        const goodValue = dots.value.filter(d => d.tone === 'good').length;
        assert.ok(Math.abs(goodValue - payback * 100) <= 1, `${goodValue} dots vs ${payback}`);
        assert.ok(dots.value.every(d => (d.value >= 10) === (d.tone === 'good')), 'tone follows the target');
        assert.strictEqual(dots.permanents.filter(d => d.tone === 'good').length, goodValue, 'same count in both views');
    });

    it('splits each run length by its own exact payback share', () => {
        const table = { shortBySize: [1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0] };
        const dots = surgeDots({ permanents: 10, stops: 5, table, valuePmf: null, threshold: 10 });
        assert.strictEqual(dots.permanents.length, 100);
        assert.ok(dots.permanents.filter(d => d.value < 2).every(d => d.tone === 'bad'), 'runs that never pay are rings');
        assert.ok(dots.permanents.filter(d => d.value >= 3).every(d => d.tone === 'good'), 'runs that always pay are solid');
        assert.strictEqual(dots.value, null);
    });

    it('shows neutral dots without mana values', () => {
        const dots = surgeDots({ permanents: 10, stops: 5, table: null });
        assert.ok(dots.permanents.every(d => d.tone === 'flat'));
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

describe('Primal Surge cast animation plan', () => {
    const card = (name, type_line, cmc, types) => ({ name, type_line, cmc, types });
    const forest = card('Forest', 'Basic Land — Forest', 0, ['land']);
    const bear = card('Bear', 'Creature — Bear', 2, ['creature']);
    const bolt = card('Bolt', 'Instant', 1, ['instant']);
    const settings = { threshold: 4, landValue: 1, cardValue: 0.25 };

    it('puts permanents onto the battlefield until the first instant or sorcery', () => {
        const plan = surgeCastPlan([forest, bear, bolt, bear], settings);
        assert.deepStrictEqual(plan.steps.map(s => s.fate), ['battlefield', 'battlefield', 'stop']);
        assert.strictEqual(plan.permanents, 2);
        assert.strictEqual(plan.value, 0 + 1 + 0.25 + 2 + 0.25);
        assert.strictEqual(plan.paidBack, false);
        assert.match(plan.steps[2].note, /stops here/);
        assert.match(plan.summary, /Bolt stopped it/);
    });

    it('runs the whole library when nothing stops it', () => {
        const plan = surgeCastPlan([forest, bear, bear], settings);
        assert.strictEqual(plan.stopped, false);
        assert.strictEqual(plan.paidBack, true);
        assert.match(plan.summary, /whole library/);
        assert.match(plan.steps.at(-1).totals[1].value, /^5\.8 /);
        assert.strictEqual(plan.steps.at(-1).totals[1].tone, 'good');
    });
});
