import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tagCard, tagDeck } from '../../js/utils/cardTags.js';

const card = (name, type_line, oracle_text, extra = {}) => ({ name, type_line, oracle_text, count: 1, cmc: 2, ...extra });

describe('tagCard — ramp', () => {
    it('tags mana rocks and dorks', () => {
        assert.deepEqual(tagCard(card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.')), ['ramp']);
        assert.ok(tagCard(card('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.')).includes('ramp'));
        assert.ok(tagCard(card('Arcane Signet', 'Artifact', "{T}: Add one mana of any color in your commander's color identity.")).includes('ramp'));
    });

    it('tags land-fetching spells, including basic-type searches', () => {
        assert.ok(tagCard(card('Cultivate', 'Sorcery', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.')).includes('ramp'));
        assert.deepEqual(tagCard(card('Skyshroud Claim', 'Sorcery', 'Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.')), ['ramp']);
    });

    it('does not call a one-shot ritual ramp', () => {
        assert.deepEqual(tagCard(card('Dark Ritual', 'Instant', 'Add {B}{B}{B}.')), []);
    });

    it('never tags lands', () => {
        assert.deepEqual(tagCard(card('Command Tower', 'Land', '{T}: Add one mana of any color.')), []);
    });
});

describe('tagCard — interaction and value', () => {
    it('tags card draw but not opponent-only draw', () => {
        assert.ok(tagCard(card('Harmonize', 'Sorcery', 'Draw three cards.')).includes('draw'));
        assert.ok(!tagCard(card('Prosperity', 'Sorcery', 'Each opponent draws X cards.')).includes('draw'));
    });

    it('separates single-target removal from wipes', () => {
        assert.deepEqual(tagCard(card('Swords to Plowshares', 'Instant', 'Exile target creature. Its controller gains life equal to its power.')), ['removal']);
        assert.ok(tagCard(card('Wrath of God', 'Sorcery', "Destroy all creatures. They can't be regenerated.")).includes('wipe'));
        assert.ok(tagCard(card('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.')).includes('removal'));
    });

    it('does not count graveyard exile as removal', () => {
        assert.ok(!tagCard(card('Bojuka Bog', 'Creature', "Exile target card from a graveyard.")).includes('removal'));
    });

    it('tags counterspells and tutors, but not land tutors', () => {
        assert.ok(tagCard(card('Counterspell', 'Instant', 'Counter target spell.')).includes('counter'));
        assert.ok(tagCard(card('Demonic Tutor', 'Sorcery', 'Search your library for a card, put that card into your hand, then shuffle.')).includes('tutor'));
        assert.ok(!tagCard(card('Rampant Growth', 'Sorcery', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.')).includes('tutor'));
    });

    it('tags recursion and protection', () => {
        assert.ok(tagCard(card('Eternal Witness', 'Creature — Human Shaman', 'When Eternal Witness enters, you may return target card from your graveyard to your hand.')).includes('recursion'));
        assert.ok(tagCard(card('Heroic Intervention', 'Instant', 'Permanents you control gain hexproof and indestructible until end of turn.')).includes('protection'));
    });
});

describe('tagDeck', () => {
    it('weights counts by copies and lists members', () => {
        const result = tagDeck({
            a: card('Llanowar Elves', 'Creature — Elf', '{T}: Add {G}.', { count: 4 }),
            b: card('Divination', 'Sorcery', 'Draw two cards.', { count: 2 }),
            c: card('Forest', 'Basic Land — Forest', '', { count: 20 })
        });
        assert.equal(result.counts.ramp, 4);
        assert.equal(result.counts.draw, 2);
        assert.deepEqual(result.members.ramp, ['Llanowar Elves']);
        assert.deepEqual(result.byCard.Forest, []);
    });
});
