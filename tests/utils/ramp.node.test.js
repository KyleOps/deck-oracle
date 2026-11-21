/**
 * The one ramp rule (js/utils/ramp.js) on real oracle text
 * (tests/fixtures/ramp-cards.json, a Scryfall snapshot): what is ramp, what
 * Mana Development can simulate, and that every page's tag agrees with it.
 * The classifier's detailed readings (amounts, colours, filters) are tested in
 * tests/calculators/manadev.node.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classifyRamp, isRampCard, rampRole, basicTypesIn, typeBits, describeRamp } from '../../js/utils/ramp.js';
import { tagCard } from '../../js/utils/cardTags.js';

const CARDS = JSON.parse(readFileSync(new URL('../fixtures/ramp-cards.json', import.meta.url), 'utf8'));
const card = name => {
    assert.ok(CARDS[name], `fixture missing: ${name}`);
    return CARDS[name];
};

describe('ramp: the shared rule', () => {
    const counted = [
        'Sol Ring', 'Arcane Signet', 'Llanowar Elves', 'Utopia Sprawl', 'Wild Growth', 'Overgrowth', 'Ugin, Eye of the Storms',
        'Cultivate', 'Skyshroud Claim', 'Sylvan Scrying', 'Explore', 'Growth Spiral', 'Courser of Kruphix', 'Azusa, Lost but Seeking',
        'Elvish Pioneer', 'Boundless Realms', 'Rites of Flourishing', 'Ghirapur Orrery', 'Wayward Swordtooth', 'Sakura-Tribe Scout'
    ];
    const uncounted = [
        'Mana Vault', 'Grim Monolith', 'Lotus Petal', 'Jeweled Lotus', 'Yavimaya Elder', 'Burgeoning', "Uro, Titan of Nature's Wrath",
        'Smothering Tithe', 'Tireless Provisioner', 'Dockside Extortionist', 'Lotus Cobra', 'Carpet of Flowers', 'Zendikar Resurgent', 'Mana Reflection',
        'Big Score', 'Black Market Connections'
    ];
    const helps = ['Dark Ritual', 'Seething Song', 'Emerald Medallion', 'Goreclaw, Terror of Qal Sisma', 'Thryx, the Sudden Storm', 'Ugin, the Ineffable'];
    const none = ['Lightning Greaves', 'Path to Exile', 'Open the Way', "Aminatou's Augury", "Ashnod's Altar", 'Blasphemous Act', 'Kodama of the East Tree', 'Command Tower', 'Nykthos, Shrine to Nyx', 'Krosan Verge'];

    for (const name of counted) {
        it(`${name}: ramp, simulated`, () => {
            assert.equal(isRampCard(card(name)), true);
            assert.equal(rampRole(classifyRamp(card(name))), 'counted');
            assert.ok(tagCard(card(name)).includes('ramp'));
        });
    }
    for (const name of uncounted) {
        it(`${name}: ramp, not simulated`, () => {
            const info = classifyRamp(card(name));
            assert.equal(isRampCard(card(name)), true);
            assert.equal(rampRole(info), 'ramp');
            assert.match(info.label, /not counted|counted only with Treasure on/);
            assert.ok(tagCard(card(name)).includes('ramp'));
        });
    }
    for (const name of helps) {
        it(`${name}: helps your mana, not ramp`, () => {
            const info = classifyRamp(card(name));
            assert.equal(isRampCard(card(name)), false);
            assert.equal(rampRole(info), 'helps');
            assert.match(info.label, /not ramp/);
            assert.ok(!tagCard(card(name)).includes('ramp'));
        });
    }
    for (const name of none) {
        it(`${name}: not ramp`, () => {
            assert.equal(classifyRamp(card(name)), null);
            assert.equal(isRampCard(card(name)), false);
            assert.ok(!tagCard(card(name)).includes('ramp'));
        });
    }

    it('Treasure is counted only when the page counts it', () => {
        const info = classifyRamp(card('Big Score'));
        assert.equal(rampRole(info), 'ramp');
        assert.equal(rampRole(info, { treasure: true }), 'counted');
        assert.equal(rampRole(null), null);
    });
});

describe('ramp: new readings', () => {
    it('lands from hand: which, and tapped or not', () => {
        const pioneer = classifyRamp(card('Elvish Pioneer'));
        assert.equal(pioneer.putLand, 1);
        assert.equal(pioneer.putLandBasic, true);
        assert.equal(pioneer.putLandTapped, true);
        assert.equal(pioneer.label, 'Puts a basic land from your hand onto the battlefield tapped');
        const spiral = classifyRamp(card('Growth Spiral'));
        assert.equal(spiral.putLandBasic, false);
        assert.equal(spiral.putLandTapped, false);
    });

    it('a search for X lands counts as one, and says so', () => {
        const realms = classifyRamp(card('Boundless Realms'));
        assert.equal(realms.lands, 1);
        assert.equal(realms.landsVary, true);
        assert.match(realms.label, /varies, counted as 1/);
    });

    it('extra land drops for every player still help you', () => {
        assert.equal(classifyRamp(card('Rites of Flourishing')).extraDrops, 1);
        assert.equal(classifyRamp(card('Ghirapur Orrery')).extraDrops, 1);
    });

    it('a spell that only makes itself cheaper is not a cost reducer', () => {
        assert.equal(classifyRamp(card('Blasphemous Act')), null);
        const named = { name: 'Old Act', mana_cost: '{8}{R}', cmc: 9, type_line: 'Sorcery', oracle_text: 'Old Act costs {1} less to cast for each creature on the battlefield.\nOld Act deals 13 damage to each creature.' };
        assert.equal(classifyRamp(named), null);
    });

    it('triggered mana is ramp the model cannot simulate', () => {
        assert.equal(classifyRamp(card('Lotus Cobra')).unmodelled, 'manaTrigger');
        assert.equal(classifyRamp(card('Carpet of Flowers')).unmodelled, 'manaTrigger');
        assert.equal(classifyRamp(card('Zendikar Resurgent')).unmodelled, 'doubler');
        assert.equal(classifyRamp(card('Mana Reflection')).unmodelled, 'doubler');
    });
});

describe('ramp: helpers and memoisation', () => {
    it('reads basic land types as whole words', () => {
        assert.deepEqual(basicTypesIn('Forest or Plains card'), ['plains', 'forest']);
        assert.deepEqual(basicTypesIn('Snow-Covered Islands'), []);
        assert.equal(typeBits(['island', 'forest']), 0b10010);
    });

    it('returns the same frozen descriptor for the same card and identity', () => {
        const sol = card('Sol Ring');
        const a = classifyRamp(sol, { identity: ['G'] });
        assert.equal(classifyRamp(sol, { identity: ['G'] }), a);
        assert.ok(Object.isFrozen(a));
        const signet = card('Arcane Signet');
        assert.notEqual(classifyRamp(signet, { identity: ['G'] }).mask, classifyRamp(signet, { identity: ['U'] }).mask);
        assert.equal(classifyRamp(null), null);
        assert.equal(classifyRamp('Sol Ring'), null);
    });

    it('tags are memoised and frozen too', () => {
        const elves = card('Llanowar Elves');
        assert.equal(tagCard(elves), tagCard(elves));
        assert.ok(Object.isFrozen(tagCard(elves)));
        assert.deepEqual(tagCard(null), []);
    });

    it('labels an unknown unmodelled kind plainly', () => {
        assert.equal(describeRamp({ unmodelled: 'something-new' }), 'Not counted');
    });
});
