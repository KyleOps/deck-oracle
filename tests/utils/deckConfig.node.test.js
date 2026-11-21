/**
 * Deck state: the commander's own card record survives imports, saved decks
 * and manual edits the way its name does.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

const COMMANDER = {
    name: 'Azusa, Lost but Seeking', mana_cost: '{2}{G}', cmc: 3, type_line: 'Legendary Creature — Human Monk',
    color_identity: ['G'], count: 1
};

const snapshot = (extra = {}) => ({
    id: 'list:test', name: 'Lands', commanderName: COMMANDER.name, importSource: 'paste',
    counts: { lands: 40, creatures: 59 }, actualCardCount: 99,
    cardsByName: { Forest: { name: 'Forest', count: 40, type_line: 'Basic Land — Forest' } },
    ...extra
});

describe('deckConfig commander record', () => {
    beforeEach(() => DeckConfig.resetForTests());

    it('finds the bundled example’s commander in its own list', () => {
        const card = DeckConfig.getCommanderCard();
        assert.equal(card?.name, DeckConfig.getCommanderName());
        assert.equal(card.cmc, 6);
    });

    it('restores commanderCard from a saved deck', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard().mana_cost, '{2}{G}');
        assert.equal(DeckConfig.getDeckConfig().commanderCard.name, COMMANDER.name);
    });

    it('returns null without a record, and ignores a record for a different commander', () => {
        DeckConfig.loadSnapshot(snapshot(), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard(), null);
        DeckConfig.loadSnapshot(snapshot({ commanderCard: { ...COMMANDER, name: 'Someone Else' } }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard(), null);
        DeckConfig.loadSnapshot(snapshot({ commanderName: null, commanderCard: COMMANDER }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard(), null);
    });

    it('matches a double-faced commander by its front face', () => {
        DeckConfig.loadSnapshot(snapshot({
            commanderName: 'Esika, God of the Tree',
            commanderCard: { ...COMMANDER, name: 'Esika, God of the Tree // The Prismatic Bridge' }
        }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard().name, 'Esika, God of the Tree // The Prismatic Bridge');
    });

    it('lists the command zone: the example’s one commander, with its card', () => {
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor']);
        assert.equal(DeckConfig.getCommanders()[0].card?.cmc, 6);
    });

    it('lists a single saved commander with its record, or none at all', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        assert.deepEqual(DeckConfig.getCommanders(), [{ name: COMMANDER.name, card: COMMANDER }]);
        DeckConfig.loadSnapshot(snapshot({ commanderName: null }), { persistActive: false });
        assert.deepEqual(DeckConfig.getCommanders(), []);
    });

    it('clears the record when the deck becomes manual counts', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        DeckConfig.updateField('lands', 38);
        assert.equal(DeckConfig.getDeckConfig().commanderCard, null);
        assert.equal(DeckConfig.getCommanderCard(), null);
    });

    it('accepts null through updateDeck', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        DeckConfig.updateDeck({ commanderCard: null });
        assert.equal(DeckConfig.getDeckConfig().commanderCard, null);
    });
});
