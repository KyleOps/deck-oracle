/**
 * Deck Overview: the hero names every commander, counts the deck the way
 * players do (98 in the library + 2 commanders = 100) and detects the format
 * from the command zone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../node-test-helper.js';

import { deckIdentity, calculate } from '../../js/calculators/overview.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Deck Overview: who the deck is', () => {
    it('the example deck: both commanders, 100 cards, Commander', () => {
        DeckConfig.resetForTests();
        const deck = deckIdentity({
            deckName: null,
            commanders: DeckConfig.getCommanders(),
            total: DeckConfig.getDeckTotal(),
            librarySize: calculate().stats.deckSize
        });
        assert.deepEqual(deck.commanders, ['The Sixth Doctor', 'Susan Foreman']);
        assert.equal(deck.commanderTitle, 'Commanders');
        assert.equal(deck.name, 'The Sixth Doctor + Susan Foreman');
        assert.equal(deck.size, 100);
        assert.equal(deck.sizeDetail, '98 in the library + 2 commanders');
        assert.equal(deck.detected, 'commander');
    });

    it('one commander, none, and a deck name', () => {
        const one = deckIdentity({ deckName: 'Elves', commanders: [{ name: 'Lathril, Blade of the Elves', card: null }], total: { total: 100, detail: '99 in the library + 1 commander' }, librarySize: 99 });
        assert.equal(one.name, 'Elves');
        assert.equal(one.commanderTitle, 'Commander');
        assert.equal(one.size, 100);
        const sixty = deckIdentity({ commanders: [], total: { total: 60, detail: null }, librarySize: 60 });
        assert.equal(sixty.name, 'Your deck');
        assert.deepEqual(sixty.commanders, []);
        assert.equal(sixty.sizeDetail, null);
        assert.equal(sixty.detected, 'constructed');
        // A small pile with a commander is still Commander (the command zone decides).
        assert.equal(deckIdentity({ commanders: ['Tymna the Weaver'], librarySize: 40 }).detected, 'commander');
        // No total (counts only): the library size stands.
        assert.equal(deckIdentity({ librarySize: 99 }).size, 99);
    });
});
