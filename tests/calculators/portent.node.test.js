import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import {
    analyze, buildTypeMasks, calculate, maxExiled, portentOutcomes, resolvePortent,
    simulatePortent, summarize, typeMask
} from '../../js/calculators/portent.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

const card = (name, typeLine, cmc = 0) => ({
    name,
    type_line: typeLine,
    cmc,
    types: ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land', 'instant', 'sorcery']
        .filter(t => typeLine.toLowerCase().includes(t))
});

describe('Portent of Calamity Calculator', () => {
    // Setup Deck: 4 types available.
    DeckConfig.updateDeck({
        lands: 30,
        creatures: 10,
        artifacts: 10,
        instants: 10
    });

    it('calculates valid probability for X=5', () => {
        global.document.getElementById('portent-xValue').value = '5';
        const { results } = calculate();
        const res5 = results[5];
        assert.ok(res5.prob4Plus >= 0 && res5.prob4Plus <= 1, 'Probability X=5 should be in valid range');
        assert.ok(res5.expectedTypes > 1, 'Expected types should be greater than 1');
    });

    it('returns 0 probability for X < 4', () => {
        global.document.getElementById('portent-xValue').value = '4';
        const { results } = calculate();
        const res2 = results[2];
        assert.strictEqual(res2.prob4Plus, 0);
    });

    it('simulates every X up to the slider maximum in one cached pass', () => {
        global.document.getElementById('portent-xValue').value = '7';
        const first = calculate();
        assert.ok(first.results[first.config.maxX], 'covers the whole slider range');
        global.document.getElementById('portent-xValue').value = '12';
        const second = calculate();
        assert.strictEqual(second.results, first.results, 'moving X reuses the cached simulation');
    });
});

describe('Portent exile matching', () => {
    it('reads card types from a type line', () => {
        assert.strictEqual(typeMask('Artifact Creature — Golem'), typeMask('Creature') | typeMask('Artifact'));
        assert.strictEqual(typeMask('Basic Land — Forest'), typeMask('Land'));
        assert.strictEqual(typeMask(''), 0);
    });

    it('exiles a dual-typed card for only one of its types', () => {
        // Artifact creature + land + sorcery shows four types, but only three
        // cards can be exiled — the old distinct-type count said four.
        const masks = ['Artifact Creature', 'Land', 'Sorcery'].map(typeMask);
        assert.strictEqual(maxExiled(masks), 3);
        assert.strictEqual(maxExiled(['Artifact Creature', 'Artifact Creature'].map(typeMask)), 2);
        assert.strictEqual(maxExiled(['Artifact Creature', 'Artifact', 'Land'].map(typeMask)), 3);
    });

    it('re-routes earlier choices to fit more cards (augmenting paths)', () => {
        // Creature first takes the creature slot, then must move to artifact so
        // the plain creature fits.
        const masks = ['Artifact Creature', 'Creature', 'Land', 'Instant'].map(typeMask);
        assert.strictEqual(maxExiled(masks), 4);
    });

    it('fixes the free-spell odds for cards with several types', () => {
        // Every card is an artifact enchantment creature land: four types on one
        // card, but each reveal can exile only as many cards as it shows.
        const masks = new Array(40).fill(typeMask('Artifact Enchantment Creature Land'));
        const results = simulatePortent(masks, 5, { iterations: 200 });
        assert.strictEqual(results[1].prob4Plus, 0, 'one card is one exile, not four');
        assert.strictEqual(results[3].prob4Plus, 0);
        assert.strictEqual(results[4].prob4Plus, 1);
        assertClose(results[2].expectedTypes, 2, 'two cards, two exiles');
        assertClose(results[4].expectedToHand, 3, 'one of four is cast free');
    });

    it('builds single-type cards from type counts when there is no list', () => {
        const masks = buildTypeMasks([], { lands: 2, creatures: 1, instants: 1 });
        assert.strictEqual(masks.length, 4);
        assert.strictEqual(maxExiled(Array.from(masks)), 3);
    });
});

describe('resolvePortent', () => {
    it('exiles one card per type and casts the costliest spell', () => {
        const revealed = [
            card('Forest', 'Basic Land — Forest'),
            card('Bolt', 'Instant', 1),
            card('Titan', 'Creature — Giant', 7),
            card('Golem', 'Artifact Creature — Golem', 3),
            card('Ponder', 'Sorcery', 1)
        ];
        const r = resolvePortent(revealed);
        assert.strictEqual(r.exiled.length, 5);
        assert.strictEqual(r.freeSpell, true);
        assert.strictEqual(r.free.name, 'Titan');
        assert.strictEqual(r.toHand.length, 4);
        assert.strictEqual(r.graveyard.length, 0);
        assert.strictEqual(r.exiled.find(e => e.card.name === 'Golem').type, 'artifact', 'Golem fills the artifact slot');
    });

    it('keeps the costliest spell among the exiled cards even when slots compete', () => {
        const revealed = [
            card('Plain Creature', 'Creature', 2),
            card('Big Golem', 'Artifact Creature', 8),
            card('Trinket', 'Artifact', 1),
            card('Island', 'Basic Land — Island'),
            card('Opt', 'Instant', 1)
        ];
        const r = resolvePortent(revealed);
        assert.strictEqual(r.exiled.length, 4, 'two creatures and one artifact fill only three slots');
        assert.strictEqual(r.free.name, 'Big Golem');
        assert.deepStrictEqual(r.graveyard.map(c => c.name), ['Trinket']);
    });

    it('casts nothing below four cards', () => {
        const r = resolvePortent([card('Forest', 'Land'), card('Opt', 'Instant', 1), card('Bear', 'Creature', 2)]);
        assert.strictEqual(r.freeSpell, false);
        assert.strictEqual(r.free, null);
        assert.strictEqual(r.toHand.length, 3);
    });
});

describe('Portent bottom line', () => {
    const results = {};
    const probs = [0, 0, 0.05, 0.2, 0.45, 0.62, 0.74, 0.83, 0.88, 0.92, 0.95];
    probs.forEach((p, i) => {
        results[i + 1] = { prob4Plus: p, expectedTypes: 1 + i * 0.4, expectedToHand: 1 + i * 0.4 - p };
    });

    it('answers with the free-spell chance, cards kept and the reliable X', () => {
        const a = analyze(results, 7);
        assert.strictEqual(a.reliableX, 10);
        const { html, tone } = summarize(a);
        assert.match(html, /X=7/);
        assert.match(html, /74%/);
        assert.match(html, /3\.4 cards/);
        assert.match(html, /X=10/);
        assert.strictEqual(tone, 'good');
    });

    it('flags a weak X and a deck that can never cast free', () => {
        assert.strictEqual(summarize(analyze(results, 4)).tone, 'bad');
        assert.strictEqual(summarize(analyze(results, 5)).tone, 'warn');
        const noTypes = summarize(analyze(results, 7, { typesInDeck: 3 }));
        assert.strictEqual(noTypes.tone, 'bad');
        assert.match(noTypes.html, /never/);
    });

    it('points out when a cheaper X is already reliable', () => {
        assert.match(summarize(analyze(results, 11)).html, /X=10 is already 9 in 10/);
    });
});

describe('portentOutcomes (DOM-free)', () => {
    it('answers for a card list without touching the page', () => {
        const saved = global.document;
        global.document = undefined;
        try {
            const cards = [
                { name: 'Forest', type_line: 'Land', cmc: 0, count: 20 },
                { name: 'Bear', type_line: 'Creature', cmc: 2, count: 20 },
                { name: 'Opt', type_line: 'Instant', cmc: 1, count: 20 },
                { name: 'Rock', type_line: 'Artifact', cmc: 2, count: 20 }
            ];
            const r = portentOutcomes({ cards, counts: {}, x: 8 });
            assert.ok(r.prob4Plus > 0.5 && r.prob4Plus < 1);
            assert.ok(r.expectedTypes > 3 && r.expectedTypes <= 4);
        } finally {
            global.document = saved;
        }
    });
});
