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

import { classifyRamp, isRampCard, rampRole, basicTypesIn, typeBits, describeRamp, turnMana } from '../../js/utils/ramp.js';
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
        'Elvish Pioneer', 'Boundless Realms', 'Rites of Flourishing', 'Ghirapur Orrery', 'Wayward Swordtooth', 'Sakura-Tribe Scout',
        'Fanatic of Rhonas', 'Whisperer of the Wilds', 'Ilysian Caryatid', 'Raucous Audience', 'Selvala, Eager Trailblazer',
        'Jadzia Dax, Living Legacy', 'Badgermole Cub', 'The Great Henge', 'Reshape the Earth', 'Reach the Horizon',
        'U.S.S. Voyager, Lone Wanderer', 'Open the Way', 'Lt. Arex, Ever-Adapting', 'Icetill Explorer'
    ];
    const uncounted = [
        'Mana Vault', 'Grim Monolith', 'Lotus Petal', 'Jeweled Lotus', 'Yavimaya Elder', 'Burgeoning', "Uro, Titan of Nature's Wrath",
        'Smothering Tithe', 'Tireless Provisioner', 'Dockside Extortionist', 'Lotus Cobra', 'Carpet of Flowers', 'Zendikar Resurgent', 'Mana Reflection',
        'Big Score', 'Black Market Connections', 'Groundchuck & Dirtbag', 'Vorinclex, Voice of Hunger', 'Gyre Sage',
        'Omenpath Journey', 'Silverback Elder', 'The Earth King', 'Kodama of the East Tree',
        "Kamahl's Druidic Vow", 'Through the Forest Gate', 'Lumra, Bellow of the Woods'
    ];
    const helps = ['Dark Ritual', 'Seething Song', 'Emerald Medallion', 'Goreclaw, Terror of Qal Sisma', 'Thryx, the Sudden Storm', 'Ugin, the Ineffable'];
    // Aminatou's Augury and Genesis Wave put a land (or any permanent) off the top as part of a big spell: payoffs, not ramp.
    const none = [
        'Lightning Greaves', 'Path to Exile', "Aminatou's Augury", 'Genesis Wave', "Ashnod's Altar", 'Blasphemous Act',
        'Command Tower', 'Nykthos, Shrine to Nyx', 'Krosan Verge'
    ];

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

describe('ramp: mana that depends on the board is counted at what the card makes alone', () => {
    const G = 16;
    const U = 2;
    const W = 1;

    it('Ferocious: the always-on ability counts, the power-4 one is the "more"', () => {
        const fanatic = classifyRamp(card('Fanatic of Rhonas'));
        assert.equal(fanatic.mana, 1);
        assert.equal(fanatic.mask, G);
        assert.deepEqual({ power: fanatic.more.power, mana: fanatic.more.mana }, { power: 4, mana: 4 });
        assert.equal(fanatic.label, 'Adds 1 green mana a turn (4 with a power-4 creature), from the next turn (summoning sick) — counted as 1: the model doesn’t track creature power');
        const whisperer = classifyRamp(card('Whisperer of the Wilds'));
        assert.equal(whisperer.mana, 1);
        assert.equal(whisperer.more.mana, 2);
        assert.equal(turnMana(whisperer), 1);
    });

    it('"If you control a creature with power 4 or greater, add … instead"', () => {
        const audience = classifyRamp(card('Raucous Audience'));
        assert.equal(audience.mana, 1);
        assert.equal(audience.more.mana, 2);
        assert.match(audience.label, /^Adds 1 green mana a turn \(2 with a power-4 creature\)/);
        const caryatid = classifyRamp(card('Ilysian Caryatid'), { identity: ['G', 'W'] });
        assert.equal(caryatid.mana, 1);
        assert.equal(caryatid.any, true);
        assert.equal(caryatid.more.mana, 2);
        assert.match(caryatid.label, /^Adds 1 mana of any colour a turn \(2 of one colour with a power-4 creature\)/);
    });

    it('a creature big enough to qualify itself gets the bigger ability', () => {
        const big = { ...card('Fanatic of Rhonas'), name: 'Big Fanatic', power: '4' };
        const r = classifyRamp(big);
        assert.equal(r.mana, 4);
        assert.equal(r.more, null);
    });

    it('one per Elf, colour or different power: the card counts itself', () => {
        const priest = classifyRamp(card('Priest of Titania'));
        assert.equal(priest.mana, 1);
        assert.equal(priest.more.per, 'Elf on the battlefield');
        assert.equal(priest.label, 'Adds 1 green mana a turn (1 per Elf on the battlefield), from the next turn (summoning sick) — counted as 1: the model doesn’t track your other Elves');
        assert.equal(classifyRamp(card('Elvish Archdruid')).more.per, 'Elf you control');

        const tender = classifyRamp(card('Bloom Tender'), { identity: ['G', 'W'] });
        assert.equal(tender.mana, 1);
        assert.equal(tender.mask, G, 'Bloom Tender alone is green: it makes {G}, not any colour');
        assert.equal(tender.any, false);
        assert.match(tender.label, /\(1 of each colour among your permanents\)/);

        const selvala = classifyRamp(card('Selvala, Eager Trailblazer'), { identity: ['G', 'W'] });
        assert.equal(selvala.mana, 1);
        assert.equal(selvala.oneColour, true);
        assert.equal(selvala.mask, G | W);
        assert.equal(selvala.more.per, 'different power among your creatures');
        assert.match(selvala.label, /^Adds 1 mana of any one colour a turn \(1 per different power among your creatures\)/);
    });

    it('devotion and its own power count what the card itself brings', () => {
        const acolyte = { name: 'Devoted Acolyte', mana_cost: '{3}{G}', cmc: 4, type_line: 'Creature — Human Druid', power: '2', oracle_text: '{T}: Add an amount of {G} equal to your devotion to green.' };
        const a = classifyRamp(acolyte);
        assert.equal(a.mana, 1);
        assert.equal(a.more.equal, 'your devotion to green');
        const strong = { name: 'Strong Druid', mana_cost: '{2}{G}', cmc: 3, type_line: 'Creature — Elf Druid', power: '3', oracle_text: '{T}: Add an amount of {G} equal to Strong Druid\'s power.' };
        assert.equal(classifyRamp(strong).mana, 3);
    });

    it('mana that starts at nothing is ramp the model does not count', () => {
        const sage = classifyRamp(card('Gyre Sage'));
        assert.equal(sage.modelled, false);
        assert.equal(sage.unmodelled, 'varies');
        assert.equal(sage.label, 'Makes no mana on its own (1 per +1/+1 counter on it) — not counted');
    });

    it('an amount it cannot work out still counts as one, and says it varies', () => {
        const rofellos = { name: 'Forest Lord', mana_cost: '{G}{G}', cmc: 2, type_line: 'Legendary Creature — Elf Shaman', power: '1', oracle_text: '{T}: Add {G} for each Forest you control.' };
        const r = classifyRamp(rofellos);
        assert.equal(r.mana, 1);
        assert.match(r.label, /counted as 1: the model doesn’t track your Forests/);
    });

    it('main-phase counter mana: one, then one more each turn (Jadzia Dax)', () => {
        const jadzia = classifyRamp(card('Jadzia Dax, Living Legacy'));
        assert.equal(jadzia.modelled, true);
        assert.equal(jadzia.mana, 0, 'no mana ability of its own');
        assert.equal(jadzia.phaseMana, 1);
        assert.equal(jadzia.growth, 1);
        assert.equal(jadzia.ready, 'next');
        assert.equal(turnMana(jadzia), 1);
        assert.equal(jadzia.label, 'Adds 1 green mana a turn (1 more each turn after, as it gets a +1/+1 counter each turn), from the next turn');
    });

    it('creature-tap boosts: Badgermole Cub brings its own creature (the land it earthbends)', () => {
        const cub = classifyRamp(card('Badgermole Cub'));
        assert.equal(cub.modelled, true);
        assert.equal(cub.mana, 0);
        assert.deepEqual(cub.tapBoost, { on: 'creature', mana: 1, mask: G, times: 1, own: 1 });
        assert.equal(turnMana(cub), 1);
        assert.match(cub.label, /^Adds 1 more green mana whenever you tap a creature for mana: 1 a turn from the land it earthbends/);
        assert.match(cub.label, /the model doesn’t track your other creatures$/);
        const bare = { name: 'Bare Booster', mana_cost: '{1}{G}', cmc: 2, type_line: 'Enchantment', oracle_text: 'Whenever you tap a creature for mana, add an additional {G}.' };
        const b = classifyRamp(bare);
        assert.equal(b.unmodelled, 'boost');
        assert.equal(b.label, 'Adds 1 more green mana whenever you tap a creature for mana — not counted');
    });

    it('land boosts and doublers say exactly what they add', () => {
        assert.equal(classifyRamp(card('Groundchuck & Dirtbag')).label, 'Adds 1 more green mana whenever you tap a land for mana — not counted');
        assert.equal(classifyRamp(card('Zendikar Resurgent')).label, 'Doubles the mana from your lands — not counted');
        assert.equal(classifyRamp(card('Vorinclex, Voice of Hunger')).label, 'Doubles the mana from your lands — not counted');
        assert.equal(classifyRamp(card('Mana Reflection')).label, 'Doubles the mana from your permanents — not counted');
    });

    it('{G}{U} is one of each, not two of either', () => {
        const arix = classifyRamp(card('Arixmethes, Slumbering Isle'));
        assert.deepEqual(arix.units, [G, U]);
        assert.equal(arix.mana, 2);
        assert.equal(arix.label, 'Adds 1 blue and 1 green mana a turn, from the next turn (enters tapped)');
        assert.equal(classifyRamp(card('Simic Signet')).units, null, 'a Signet pays one of its mana: counted as one, either colour');
    });

    it('a cost reduction on the card itself is generic mana only, and the model pays full price', () => {
        const henge = classifyRamp(card('The Great Henge'));
        assert.equal(henge.mana, 2);
        assert.deepEqual(henge.costsLess, { by: '{X}', when: 'the greatest power among your creatures' });
        assert.match(henge.label, /costs \{X\} less to cast \(X = the greatest power among your creatures; generic mana only\) — the model pays full price$/);
    });
});

describe('ramp: land wording families', () => {
    it('counts spelled out to ten, and "that many"', () => {
        const reshape = classifyRamp(card('Reshape the Earth'));
        assert.equal(reshape.lands, 10);
        assert.equal(reshape.landsTapped, true);
        assert.equal(classifyRamp(card('The Earth King')).unmodelled, 'trigger');
    });

    it('"with different names"', () => {
        const reach = classifyRamp(card('Reach the Horizon'));
        assert.equal(reach.distinct, true);
        assert.equal(reach.lands, 2);
        assert.equal(reach.label, 'Puts 2 basic lands with different names onto the battlefield tapped');
    });

    it('revealing until lands', () => {
        const voyager = classifyRamp(card('U.S.S. Voyager, Lone Wanderer'));
        assert.equal(voyager.reveal, true);
        assert.equal(voyager.lands, 2);
        assert.equal(voyager.landFilter, 'any');
        assert.equal(voyager.landsTapped, true);
        assert.equal(voyager.label, 'Reveals cards until it finds 2 lands and puts them onto the battlefield tapped');
        const open = classifyRamp(card('Open the Way'));
        assert.equal(open.lands, 1);
        assert.equal(open.landsVary, true);
    });

    it('a search into exile that a later trigger puts onto the battlefield', () => {
        assert.equal(classifyRamp(card('Omenpath Journey')).unmodelled, 'trigger');
    });

    it('lands off the top of the library: many is ramp, one only on a trigger', () => {
        assert.equal(classifyRamp(card('Through the Forest Gate')).label, 'Puts lands from the top twenty cards of your library onto the battlefield tapped — not counted');
        assert.equal(classifyRamp(card("Kamahl's Druidic Vow")).label, 'Puts lands from the top X cards of your library onto the battlefield — not counted');
        assert.equal(classifyRamp(card('Silverback Elder')).unmodelled, 'trigger', 'a modal bullet belongs to its "whenever"');
    });

    it('lands back from the graveyard', () => {
        assert.equal(classifyRamp(card('Lumra, Bellow of the Woods')).unmodelled, 'graveyardLands');
    });

    it('several lands from your hand, and the cards drawn first', () => {
        const arex = classifyRamp(card('Lt. Arex, Ever-Adapting'));
        assert.equal(arex.putLand, 3);
        assert.equal(arex.putLandTapped, true);
        assert.equal(arex.draws, 3);
        assert.equal(arex.label, 'Puts up to 3 lands from your hand onto the battlefield tapped; draws 3 cards');
        assert.equal(classifyRamp(card('Growth Spiral')).putLand, 1);
    });

    it('a permanent from your hand on a trigger (lands included)', () => {
        assert.equal(classifyRamp(card('Kodama of the East Tree')).unmodelled, 'trigger');
    });

    it('playing lands from the graveyard is noted, not counted', () => {
        const icetill = classifyRamp(card('Icetill Explorer'));
        assert.equal(icetill.extraDrops, 1);
        assert.equal(icetill.fromGraveyard, true);
        assert.equal(icetill.label, 'Lets you play an extra land each turn; also plays lands from your graveyard, which the model doesn’t');
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
