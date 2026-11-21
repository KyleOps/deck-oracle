import { describe, it } from 'node:test';
import { assertClose } from '../helpers/assert.js';
import assert from 'node:assert';
import {
    calculateFetchLandSetup, calculateLumraStats, isFetchLand, expectedLandDrops, assignFetchRoles,
    playToLumra, summariseSizes, countFetchLands, summarize, returnTone
} from '../../js/utils/models/lumra.js';

describe('Lumra Calculator', () => {
    it('calculates expected milled lands correctly (50% lands)', () => {
        const deckSize = 100;
        const landCount = 50;
        const gyLands = 0;
        
        // Expected value for hypergeometric distribution: n * (K / N)
        // 4 * (50 / 100) = 2
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 2.0, 'Expected milled should be 2.0');
        assertClose(result.totalReturned, 2.0, 'Total returned should match expected milled (0 gy)');
    });

    it('calculates expected milled lands correctly (25% lands)', () => {
        const deckSize = 100;
        const landCount = 25;
        const gyLands = 0;
        
        // 4 * (25 / 100) = 1
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 1.0, 'Expected milled should be 1.0');
    });

    it('adds graveyard lands to total', () => {
        const deckSize = 100;
        const landCount = 50;
        const gyLands = 5;
        
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 2.0, 'Expected milled still 2.0');
        assertClose(result.totalReturned, 7.0, 'Total returned should be 5 + 2 = 7');
    });

    it('handles 0 lands in deck', () => {
        const deckSize = 100;
        const landCount = 0;
        const gyLands = 3;
        
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 0.0, 'Expected milled should be 0');
        assertClose(result.totalReturned, 3.0, 'Total returned should be just GY lands');
    });

    it('handles 100% lands in deck', () => {
        const deckSize = 100;
        const landCount = 100;
        const gyLands = 0;
        
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 4.0, 'Expected milled should be 4');
    });

    it('handles multiplier (2 triggers)', () => {
        const deckSize = 100;
        const landCount = 50;
        const gyLands = 0;
        const multiplier = 2;
        
        // Expected: 8 cards milled, 50% lands -> 4 lands
        const result = calculateLumraStats(deckSize, landCount, gyLands, multiplier);
        
        assertClose(result.expectedMilled, 4.0, 'Expected milled should be 4.0 (2x trigger)');
    });

    it('adds expected cracked fetches to the lands returned', () => {
        const result = calculateLumraStats(100, 50, 2, 1, 1.25);
        assertClose(result.totalReturned, 5.25, '2 existing + 1.25 fetches + 2 milled');
    });

    it('calculates exact odds and expected fetches seen by a turn', () => {
        const result = calculateFetchLandSetup(100, 10, 3);
        assert.equal(result.cardsSeen, 10);
        assertClose(result.expectedSeen, 1, 'expected fetches seen');
        assertClose(result.expectedCracked, 1, 'expected cracked fetches');
        assert.ok(result.probabilityAtLeastOne > 0.65 && result.probabilityAtLeastOne < 0.70);
    });

    it('caps expected cracked fetches at the number of land drops', () => {
        const result = calculateFetchLandSetup(20, 20, 2);
        assertClose(result.expectedCracked, 2, 'turn two permits at most two cracks');
    });

    it('detects fetch lands from type and rules text', () => {
        assert.equal(isFetchLand({
            type_line: 'Land',
            oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Island card.'
        }), true);
        assert.equal(isFetchLand({ type_line: 'Sorcery', oracle_text: 'Search your library for a land card.' }), false);
        assert.equal(isFetchLand({ type_line: 'Land', oracle_text: '{T}: Add {G}.' }), false);
        assert.equal(isFetchLand({ name: 'Misty Rainforest', type_line: 'Land' }), true, 'supports older imports without rules text');
    });
});

describe('Lumra - expectedLandDrops', () => {
    it('is the expected lands seen when the turn cap never binds', () => {
        // 50% lands, 7 + 10 cards seen -> 8.5 lands on average, far below... the cap of 10 binds rarely
        const drops = expectedLandDrops(100, 50, 10);
        assert.ok(drops < 8.5 && drops > 8, `got ${drops}`);
    });

    it('is capped at one land drop per turn', () => {
        assertClose(expectedLandDrops(100, 100, 4), 4, 'all lands: exactly one drop a turn');
        assert.strictEqual(expectedLandDrops(100, 0, 6), 0);
        assert.strictEqual(expectedLandDrops(0, 0, 6), 0);
    });

    it('matches a direct hypergeometric sum on a small case', () => {
        // 2 lands in 4 cards, opening hand 1, turn 1 -> see 2 cards; P(>=1 land) = 1 - C(2,2)/C(4,2) = 5/6
        assertClose(expectedLandDrops(4, 2, 1, 1), 5 / 6, 'one drop if either card is a land');
    });
});

describe('Lumra - simulation helpers', () => {
    const card = (name, land, fetch = false) => ({ name, types: land ? ['land'] : ['creature'], isFetchCard: fetch });

    it('assigns fetch roles to detected fetch lands first, then other lands', () => {
        const deck = [card('Forest', true), card('Misty', true, true), card('Bear', false), card('Island', true)];
        assignFetchRoles(deck, 1);
        assert.deepStrictEqual(deck.filter(c => c.isFetch).map(c => c.name), ['Misty']);
        assignFetchRoles(deck, 2);
        assert.deepStrictEqual(deck.filter(c => c.isFetch).map(c => c.name).sort(), ['Forest', 'Misty']);
        assignFetchRoles(deck, 0);
        assert.strictEqual(deck.some(c => c.isFetch), false);
        assignFetchRoles(deck, 10);
        assert.strictEqual(deck.filter(c => c.isFetch).length, 3, 'never marks a nonland');
    });

    it('plays to Lumra: land drops capped by turn, fetches cracked, then mills the next cards', () => {
        const lib = [
            card('L1', true), card('F1', true), card('S1', false), card('L2', true),
            card('L3', true), card('S2', false), card('S3', false), card('L4', true), // opening 7 + 1 draw on turn 1
            card('M1', true), card('M2', false), card('M3', true), card('M4', false), card('M5', true)
        ];
        lib[1].isFetch = true;
        const g = playToLumra(lib, { turn: 1, openingHand: 7 });
        assert.strictEqual(g.drops, 1);
        assert.strictEqual(g.cracked, 1);
        assert.deepStrictEqual(g.milled.map(c => c.name), ['M1', 'M2', 'M3', 'M4']);
        assert.strictEqual(g.landsMilled, 2);

        const doubled = playToLumra(lib, { turn: 1, multiplier: 2, openingHand: 7 });
        assert.strictEqual(doubled.milled.length, 5, 'stops at the end of the library');
    });

    it('summarises sizes with percentiles, not extremes', () => {
        const games = [
            { drops: 5, cracked: 0, landsMilled: 0 },
            { drops: 5, cracked: 0, landsMilled: 1 },
            { drops: 5, cracked: 1, landsMilled: 2 },
            { drops: 6, cracked: 0, landsMilled: 4 }
        ];
        const s = summariseSizes(games, 1);
        assert.strictEqual(s.p50, 7);
        assert.strictEqual(s.p25, 6);
        assert.strictEqual(s.counts[6], 1);
        assert.strictEqual(s.counts[11], 1);
        assert.strictEqual(s.noLandsMilled, 0.25);
        assert.strictEqual(summariseSizes([]).p50, 0);
    });

    it('counts fetch lands in a decklist', () => {
        assert.strictEqual(countFetchLands({
            'Misty Rainforest': { name: 'Misty Rainforest', type_line: 'Land', count: 1 },
            Forest: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', count: 30 },
            'Evolving Wilds': { name: 'Evolving Wilds', type_line: 'Land', count: 2 }
        }), 3);
        assert.strictEqual(countFetchLands(undefined), 0);
    });
});

describe('Lumra - summarize', () => {
    const base = { turn: 6, multiplier: 1, gyLands: 0, drops: 4.6, milled: 1.5, fetches: 0, returned: 1.5, pNoLands: 0.15 };

    it('leads with the typical size and its range', () => {
        const s = summarize({ ...base, sizes: { p25: 5, p50: 6, p75: 7 } });
        assert.match(s.html, /Cast on turn 6, Lumra typically enters as a <strong>6\/6<\/strong>/);
        assert.match(s.html, /between 5\/5 and 7\/7/);
        assert.match(s.html, /brings back <strong>1\.5<\/strong>/);
        assert.match(s.html, /15% of the time the mill finds no lands/);
        assert.strictEqual(s.tone, 'warn');
    });

    it('names each source of returned lands that applies', () => {
        const s = summarize({ ...base, gyLands: 2, fetches: 1.2, returned: 4.7, sizes: { p25: 9, p50: 9, p75: 9 } });
        assert.match(s.html, /1\.2 cracked fetch lands/);
        assert.match(s.html, /2 already in your graveyard/);
        assert.doesNotMatch(s.html, /between/);
        assert.strictEqual(s.tone, 'good');
    });

    it('mills more with extra triggers and falls back to averages without a simulation', () => {
        const s = summarize({ ...base, multiplier: 2, sizes: null });
        assert.match(s.html, /top 8/);
        assert.match(s.html, /<strong>6\/6<\/strong>/);
    });

    it('asks for a deck when there is nothing to work with', () => {
        assert.strictEqual(summarize(null).tone, 'flat');
        assert.strictEqual(returnTone(0.5), 'bad');
    });
});
