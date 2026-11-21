import { describe, it } from 'node:test';
import { assert, assertClose } from '../node-test-helper.js';
import {
    calculate, buildRashmiState, freeSpellOdds, oddsByCastMv, revealBreakdown, reliableFrom,
    curveRows, classifyReveal, summarize, chanceTone, isXSpell
} from '../../js/calculators/rashmi.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

const DECK = {
    'Card A': { name: 'Card A', cmc: 2, count: 10, type_line: 'Creature', mana_cost: '{2}' },
    'Card B': { name: 'Card B', cmc: 5, count: 10, type_line: 'Creature', mana_cost: '{5}' },
    'Card C': { name: 'Card C', cmc: 3, count: 10, type_line: 'Instant', mana_cost: '{3}' },
    'Land': { name: 'Land', cmc: 0, count: 30, type_line: 'Land', mana_cost: '' }
};

describe('Rashmi, Eternities Crafter Calculator', () => {
    DeckConfig.updateDeck({ lands: 30, cardsByName: DECK });

    it('calculates correct probability at CMC 4', () => {
        global.document.getElementById('rashmi-cmcValue').value = '4';
        const { results } = calculate();
        const resultAt4 = results[4];
        assertClose(resultAt4.probFreeSpell, 1 / 3, 'Probability at CMC 4');
        assertClose(resultAt4.expectedCmc, 2.5, 'Expected CMC at CMC 4');
    });

    it('handles CMC where no spells are free', () => {
        global.document.getElementById('rashmi-cmcValue').value = '2';
        const { results } = calculate();
        assert.strictEqual(results[2].probFreeSpell, 0);
    });

    it('calculates correct probability at CMC 6', () => {
        global.document.getElementById('rashmi-cmcValue').value = '6';
        const { results } = calculate();
        assertClose(results[6].probFreeSpell, 0.5, 'Probability at CMC 6');
    });

    it('recomputes for a new deck even when it has the same shape (regression)', () => {
        // The old cache key was "number of unique names + land count", so a
        // different deck with the same shape silently reused stale odds.
        global.document.getElementById('rashmi-cmcValue').value = '4';
        const other = {
            'Card A': { name: 'Card A', cmc: 1, count: 10, type_line: 'Creature', mana_cost: '{1}' },
            'Card B': { name: 'Card B', cmc: 1, count: 10, type_line: 'Creature', mana_cost: '{1}' },
            'Card C': { name: 'Card C', cmc: 1, count: 10, type_line: 'Instant', mana_cost: '{1}' },
            'Land': { name: 'Land', cmc: 0, count: 30, type_line: 'Land', mana_cost: '' }
        };
        DeckConfig.updateDeck({ lands: 30, cardsByName: other });
        assertClose(calculate().results[4].probFreeSpell, 0.5, 'all 30 spells are cheaper than 4');
        DeckConfig.updateDeck({ lands: 30, cardsByName: DECK });
        assertClose(calculate().results[4].probFreeSpell, 1 / 3, 'back to the first deck');
    });
});

describe('buildRashmiState / freeSpellOdds', () => {
    const state = buildRashmiState(DECK);

    it('counts the whole library, lands included', () => {
        assert.strictEqual(state.deckSize, 60);
        assert.strictEqual(state.lands, 30);
        assert.strictEqual(state.spells, 30);
    });

    it('needs strictly lesser mana value', () => {
        assert.strictEqual(freeSpellOdds(state, 2).probFreeSpell, 0);
        assertClose(freeSpellOdds(state, 3).probFreeSpell, 10 / 60);
        assertClose(freeSpellOdds(state, 6).expectedCmc, (20 + 50 + 30) / 30);
    });

    it('never offers a free spell off a zero-cost or empty deck', () => {
        assert.strictEqual(freeSpellOdds(state, 0).probFreeSpell, 0);
        assert.strictEqual(freeSpellOdds(buildRashmiState({}), 5).probFreeSpell, 0);
        assert.strictEqual(buildRashmiState(undefined).hasImportedData, false);
    });

    it('can leave X spells out of the free spells', () => {
        const deck = {
            ...DECK,
            Wave: { name: 'Wave', cmc: 3, count: 1, type_line: 'Sorcery', mana_cost: '{X}{G}{G}{G}' }
        };
        const counted = buildRashmiState(deck);
        const excluded = buildRashmiState(deck, { excludeX: true });
        assert.strictEqual(counted.xCount, 1);
        assertClose(freeSpellOdds(counted, 4).probFreeSpell, 21 / 61);
        assertClose(freeSpellOdds(excluded, 4).probFreeSpell, 20 / 61);
    });

    it('detects X costs', () => {
        assert.strictEqual(isXSpell('{X}{U}'), true);
        assert.strictEqual(isXSpell('{2}{U}'), false);
        assert.strictEqual(isXSpell(undefined), false);
    });
});

describe('revealBreakdown', () => {
    it('splits the library into free, too big and land, summing to one', () => {
        const b = revealBreakdown(buildRashmiState(DECK), 4);
        assertClose(b.free, 20 / 60);
        assertClose(b.tooBig, 10 / 60);
        assertClose(b.land, 30 / 60);
        assertClose(b.free + b.tooBig + b.xLeftOut + b.land, 1);
    });
});

describe('reliableFrom', () => {
    it('finds the cheapest spell that reaches 7 in 10', () => {
        const deck = {
            Cheap: { name: 'Cheap', cmc: 1, count: 80, type_line: 'Creature', mana_cost: '{1}' },
            Land: { name: 'Land', cmc: 0, count: 20, type_line: 'Land', mana_cost: '' }
        };
        const r = reliableFrom(oddsByCastMv(buildRashmiState(deck)));
        assert.strictEqual(r.mv, 2);
    });

    it('reports the best case when nothing gets there', () => {
        const r = reliableFrom(oddsByCastMv(buildRashmiState(DECK)));
        assert.strictEqual(r.mv, null);
        assertClose(r.best.prob, 0.5);
    });
});

describe('curveRows', () => {
    it('lists your spells by mana value with the odds when each is cast first', () => {
        const { rows, average } = curveRows(buildRashmiState(DECK));
        assert.deepStrictEqual(rows.map(r => r.x), [2, 3, 5]);
        assert.deepStrictEqual(rows.map(r => r.count), [10, 10, 10]);
        assertClose(rows[2].prob, 20 / 60);
        assertClose(average, (0 + 10 / 60 + 20 / 60) / 3);
    });
});

describe('classifyReveal', () => {
    it('sorts a revealed card the way Rashmi does', () => {
        assert.strictEqual(classifyReveal({ types: ['land'], cmc: 0 }, 5), 'land');
        assert.strictEqual(classifyReveal({ types: ['creature'], cmc: 4 }, 5), 'free');
        assert.strictEqual(classifyReveal({ types: ['creature'], cmc: 5 }, 5), 'big');
        assert.strictEqual(classifyReveal({ types: ['sorcery'], cmc: 3, mana_cost: '{X}{G}{G}{G}' }, 5, true), 'x');
        assert.strictEqual(classifyReveal({ types: ['sorcery'], cmc: 3, mana_cost: '{X}{G}{G}{G}' }, 5, false), 'free');
    });
});

describe('summarize (bottom line)', () => {
    const state = buildRashmiState(DECK);
    const rows = oddsByCastMv(state);
    const reliable = reliableFrom(rows);

    it('states the chance and the usual size of the free spell', () => {
        const s = summarize({ castMv: 6, odds: freeSpellOdds(state, 6), reliable, landShare: 0.5 });
        assert.match(s.html, /<strong>6-mana<\/strong> spell/);
        assert.match(s.html, /<strong>50%<\/strong> of the time/);
        assert.match(s.html, /<strong>3\.3-mana<\/strong> card/);
        assert.strictEqual(s.tone, 'good');
    });

    it('explains the ceiling when nothing is reliable', () => {
        const s = summarize({ castMv: 4, odds: freeSpellOdds(state, 4), reliable, landShare: 0.5 });
        assert.match(s.html, /No spell reaches 7 in 10: 50% of your library is lands/);
    });

    it('says so when nothing in the deck is cheaper', () => {
        const s = summarize({ castMv: 1, odds: freeSpellOdds(state, 1), reliable, landShare: 0.5 });
        assert.match(s.html, /can’t flip a free spell/);
        assert.strictEqual(s.tone, 'bad');
    });

    it('points to the reliable mana value when there is one', () => {
        const s = summarize({ castMv: 3, odds: freeSpellOdds(state, 3), reliable: { mv: 7, best: { x: 7, prob: 0.8 } }, landShare: 0.2 });
        assert.match(s.html, /once your first spell costs <strong>7<\/strong>/);
    });

    it('asks for a decklist when there is none', () => {
        assert.strictEqual(summarize({ hasImportedData: false }).tone, 'flat');
        assert.doesNotThrow(() => summarize(undefined));
    });

    it('maps chances to tones', () => {
        assert.strictEqual(chanceTone(0.6), 'good');
        assert.strictEqual(chanceTone(0.35), 'warn');
        assert.strictEqual(chanceTone(0.1), 'bad');
        assert.strictEqual(chanceTone(0), 'bad');
    });
});
