/**
 * Mana Development: the ramp classifier against real oracle text, scripted
 * goldfish games with known answers, the simulation's invariants, the bottom
 * line, and the page contract.
 *
 * tests/fixtures/ramp-cards.json is a Scryfall snapshot (name, cost, type,
 * oracle text) of the cards below, so the classifier is tested on the exact
 * wording players import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../node-test-helper.js';

import * as MD from '../../js/utils/manaDevelopment.js';
import * as Page from '../../js/calculators/manadev.js';
import { template, styles, guide } from '../../js/views/manadev.js';
import { GLOSSARY } from '../../js/data/glossary.js';
import { FORMATS } from '../../js/utils/format.js';
import { COLOR_BIT, mulberry32 } from '../../js/utils/handLab.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import { budget } from '../helpers/timing.js';
import { libraryOf } from '../../js/utils/library.js';
import { tagDeck } from '../../js/utils/cardTags.js';

const CARDS = JSON.parse(readFileSync(new URL('../fixtures/ramp-cards.json', import.meta.url), 'utf8'));
const GU = COLOR_BIT.G | COLOR_BIT.U;
const ramp = (name, identity = ['G', 'U']) => {
    assert.ok(CARDS[name], `fixture missing: ${name}`);
    return MD.classifyRamp(CARDS[name], { identity });
};
const land = (name, opts) => MD.classifyLand(CARDS[name], opts);

/** Assert a subset of descriptor fields. */
function like(actual, expected, name) {
    assert.ok(actual, `${name} should be recognised`);
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(actual[k], v, `${name}.${k}`);
}

// ── Classifier ───────────────────────────────────────────────────────────────

describe('ramp classifier: mana permanents', () => {
    const cases = {
        'Sol Ring': { kind: 'rock', mana: 2, mask: 0, ready: 'now', modelled: true },
        'Arcane Signet': { kind: 'rock', mana: 1, mask: GU, any: true, ready: 'now' },
        'Mind Stone': { kind: 'rock', mana: 1, mask: 0 },
        'Gilded Lotus': { kind: 'rock', mana: 3, any: true },
        'Simic Signet': { kind: 'rock', mana: 1, mask: GU, any: false, activation: 1 },
        'Talisman of Curiosity': { kind: 'rock', mana: 1, mask: GU },
        'Fellwar Stone': { kind: 'rock', mana: 1, any: true },
        "Commander's Sphere": { kind: 'rock', mana: 1, any: true },
        'Worn Powerstone': { kind: 'rock', mana: 2, ready: 'tapped' },
        'Thran Dynamo': { kind: 'rock', mana: 3, mask: 0 },
        'Hedron Archive': { kind: 'rock', mana: 2 },
        'Cursed Mirror': { kind: 'rock', mana: 1, mask: COLOR_BIT.R },
        'Llanowar Elves': { kind: 'dork', mana: 1, mask: COLOR_BIT.G, ready: 'sick' },
        'Elvish Mystic': { kind: 'dork', mana: 1, ready: 'sick' },
        'Birds of Paradise': { kind: 'dork', mana: 1, any: true, ready: 'sick' },
        "Avacyn's Pilgrim": { kind: 'dork', mana: 1, mask: COLOR_BIT.W },
        'Bloom Tender': { kind: 'dork', mana: 1, variable: true, mask: COLOR_BIT.G, any: false },
        'Priest of Titania': { kind: 'dork', mana: 1, variable: true, mask: COLOR_BIT.G },
        'Selvala, Heart of the Wilds': { kind: 'dork', mana: 1, variable: true },
        'Arixmethes, Slumbering Isle': { kind: 'dork', mana: 2, mask: GU, units: [COLOR_BIT.G, COLOR_BIT.U], ready: 'tapped' },
        'Fanatic of Rhonas': { kind: 'dork', mana: 1, mask: COLOR_BIT.G, variable: true, ready: 'sick' },
        'Whisperer of the Wilds': { kind: 'dork', mana: 1, mask: COLOR_BIT.G, variable: true },
        'Jadzia Dax, Living Legacy': { kind: 'dork', mana: 0, phaseMana: 1, growth: 1, mask: COLOR_BIT.G, ready: 'next' },
        'Badgermole Cub': { kind: 'dork', mana: 0, mask: COLOR_BIT.G, ready: 'next' },
        'Ugin, Eye of the Storms': { kind: 'walker', mana: 3, mask: 0, ready: 'now' },
        'Utopia Sprawl': { kind: 'aura', mana: 1, any: true, ready: 'next' },
        'Wild Growth': { kind: 'aura', mana: 1, mask: COLOR_BIT.G },
        'Overgrowth': { kind: 'aura', mana: 2, mask: COLOR_BIT.G }
    };
    for (const [name, expected] of Object.entries(cases)) {
        it(name, () => like(ramp(name), expected, name));
    }
});

describe('ramp classifier: land searches and land drops', () => {
    const cases = {
        'Rampant Growth': { kind: 'fetch', lands: 1, toHand: 0, landsTapped: true, landFilter: 'basic' },
        'Cultivate': { lands: 1, toHand: 1, landsTapped: true, landFilter: 'basic' },
        "Kodama's Reach": { lands: 1, toHand: 1, landsTapped: true },
        'Explosive Vegetation': { lands: 2, toHand: 0, landsTapped: true, landFilter: 'basic' },
        'Circuitous Route': { lands: 2, landsTapped: true, landFilter: 'basic' },
        'Skyshroud Claim': { lands: 2, landsTapped: false, landFilter: ['forest'] },
        'Three Visits': { lands: 1, landsTapped: false, landFilter: ['forest'] },
        "Nature's Lore": { lands: 1, landsTapped: false, landFilter: ['forest'] },
        'Farseek': { lands: 1, landsTapped: true, landFilter: ['plains', 'island', 'swamp', 'mountain'] },
        'Harrow': { lands: 2, landsTapped: false, sacrificeLand: 1 },
        'Sakura-Tribe Elder': { lands: 1, landsTapped: true, extraCost: 0 },
        'Wood Elves': { lands: 1, landsTapped: false, landFilter: ['forest'] },
        'Solemn Simulacrum': { lands: 1, landsTapped: true },
        "Wayfarer's Bauble": { lands: 1, landsTapped: true, extraCost: 2 },
        'Burnished Hart': { lands: 2, landsTapped: true, extraCost: 3 },
        'Sylvan Scrying': { lands: 0, toHand: 1, landFilter: 'any' },
        'Azusa, Lost but Seeking': { kind: 'drops', extraDrops: 2 },
        'Exploration': { extraDrops: 1 },
        'Dryad of the Ilysian Grove': { extraDrops: 1 },
        'Oracle of Mul Daya': { extraDrops: 1, fromTop: true },
        'Courser of Kruphix': { extraDrops: 0, fromTop: true },
        'Explore': { extraDropsOnce: 1, draws: 1 },
        'Growth Spiral': { putLand: 1, draws: 1 },
        'Reshape the Earth': { lands: 10, landsTapped: true, landFilter: 'any' },
        'Reach the Horizon': { lands: 2, landsTapped: true, landFilter: 'basic', distinct: true },
        'U.S.S. Voyager, Lone Wanderer': { lands: 2, landsTapped: true, landFilter: 'any', reveal: true },
        'Open the Way': { lands: 1, landsTapped: true, landFilter: 'any', reveal: true, landsVary: true },
        'Lt. Arex, Ever-Adapting': { putLand: 3, putLandTapped: true, draws: 3 }
    };
    for (const [name, expected] of Object.entries(cases)) {
        it(name, () => like(ramp(name), { modelled: true, ...expected }, name));
    }

    it('reads a long search sentence that never says "card" in linear time', () => {
        // The earlier pattern backtracked exponentially on "a or a or a …" (CodeQL js/redos).
        const oracle = `Search your library for a ${'a or '.repeat(40)}thing.`;
        const card = { name: 'Odd Text', mana_cost: '{1}{G}', cmc: 2, type_line: 'Sorcery', oracle_text: oracle, color_identity: ['G'] };
        const start = performance.now();
        MD.classifyRamp(card, { identity: ['G'] });
        assert.ok(performance.now() - start < budget(50));
    });
});

describe('ramp classifier: recognised but not counted', () => {
    const cases = {
        'Mana Vault': 'noUntap',
        'Dark Ritual': 'ritual',
        'Yavimaya Elder': 'trigger',
        'Smothering Tithe': 'treasureTrigger',
        'Tireless Provisioner': 'treasureTrigger',
        'Emerald Medallion': 'reducer',
        'Goreclaw, Terror of Qal Sisma': 'reducer',
        'Zendikar Resurgent': 'doubler',
        'Groundchuck & Dirtbag': 'doubler',
        'Gyre Sage': 'varies',
        'Omenpath Journey': 'trigger',
        'The Earth King': 'trigger',
        'Silverback Elder': 'trigger',
        'Kodama of the East Tree': 'trigger',
        'Through the Forest Gate': 'topLands',
        "Kamahl's Druidic Vow": 'topLands',
        'Lumra, Bellow of the Woods': 'graveyardLands'
    };
    for (const [name, why] of Object.entries(cases)) {
        it(`${name} (${why})`, () => {
            const r = ramp(name);
            like(r, { modelled: false, unmodelled: why }, name);
            assert.match(r.label, /not counted/);
        });
    }

    it('Big Score: two Treasure, counted only when Treasure is on', () => {
        like(ramp('Big Score'), { modelled: false, treasure: 2, draws: 2, kind: 'treasure' }, 'Big Score');
        assert.match(ramp('Big Score').label, /counted only with Treasure on/);
    });

    it('ignores cards that are not ramp, including opponent-side land searches', () => {
        for (const name of ['Lightning Greaves', 'Path to Exile', 'Genesis Wave', "Aminatou's Augury"]) assert.equal(ramp(name), null, name);
        assert.equal(MD.classifyRamp(CARDS['Command Tower']), null, 'lands are never ramp spells');
        assert.equal(MD.classifyRamp(null), null);
    });
});

describe('ramp classifier: plain-word labels', () => {
    it('says what the model thinks each card does', () => {
        assert.equal(ramp('Sol Ring').label, 'Adds 2 colourless mana a turn, from the turn you cast it');
        assert.equal(ramp('Llanowar Elves').label, 'Adds 1 green mana a turn, from the next turn (summoning sick)');
        assert.equal(ramp('Simic Signet').label, 'Adds 1 blue or green mana a turn (net of its {1} cost), from the turn you cast it');
        assert.equal(ramp('Arcane Signet').label, 'Adds 1 mana of any colour a turn, from the turn you cast it');
        assert.equal(ramp('Cultivate').label, 'Puts a basic land onto the battlefield tapped and 1 more into your hand');
        assert.equal(ramp('Skyshroud Claim').label, 'Puts 2 Forests onto the battlefield untapped');
        assert.equal(ramp('Farseek').label, 'Puts a Plains, Island, Swamp or Mountain onto the battlefield tapped');
        assert.equal(ramp('Burnished Hart').label, 'Puts 2 basic lands onto the battlefield tapped (plus {3} to activate)');
        assert.equal(ramp('Oracle of Mul Daya').label, 'Lets you play an extra land each turn; Lets you play lands from the top of your library');
        assert.equal(ramp('Priest of Titania').label, 'Adds 1 green mana a turn (1 per Elf on the battlefield), from the next turn (summoning sick) — counted as 1: the model doesn’t track your other Elves');
        assert.equal(ramp('Fanatic of Rhonas').label, 'Adds 1 green mana a turn (4 with a power-4 creature), from the next turn (summoning sick) — counted as 1: the model doesn’t track creature power');
        assert.equal(ramp('Arixmethes, Slumbering Isle').label, 'Adds 1 blue and 1 green mana a turn, from the next turn (enters tapped)');
        assert.equal(ramp('Reach the Horizon').label, 'Puts 2 basic lands with different names onto the battlefield tapped');
    });
});

describe('land classifier', () => {
    it('reads how lands enter and what they make', () => {
        like(land('Ancient Tomb'), { mana: 2, tap: MD.TAP.UNTAPPED }, 'Ancient Tomb');
        like(land('Simic Growth Chamber'), { mana: 2, tap: MD.TAP.TAPPED, bounce: true }, 'Simic Growth Chamber');
        like(land('Breeding Pool'), { mana: 1, tap: MD.TAP.UNTAPPED }, 'Breeding Pool');
        like(land('Command Tower'), { mana: 1, tap: MD.TAP.UNTAPPED }, 'Command Tower');
        like(land('Thornwood Falls'), { tap: MD.TAP.TAPPED }, 'Thornwood Falls');
        like(land('Evolving Wilds'), { tap: MD.TAP.TAPPED }, 'Evolving Wilds');
        like(land('Misty Rainforest'), { tap: MD.TAP.UNTAPPED }, 'Misty Rainforest');
        like(land('Botanical Sanctum'), { tap: MD.TAP.FAST }, 'Botanical Sanctum');
        like(land('Hinterland Harbor'), { tap: MD.TAP.CHECK, checkTypes: ['forest', 'island'] }, 'Hinterland Harbor');
        like(land('Mistrise Village'), { tap: MD.TAP.CHECK, checkTypes: ['mountain', 'forest'] }, 'Mistrise Village');
        like(land('Yavimaya Coast'), { mana: 1, tap: MD.TAP.UNTAPPED }, 'Yavimaya Coast');
    });

    it('knows "two or more opponents" depends on the format', () => {
        assert.equal(land('Rejuvenating Springs', { multiplayer: true }).tap, MD.TAP.UNTAPPED);
        assert.equal(land('Rejuvenating Springs', { multiplayer: false }).tap, MD.TAP.TAPPED);
    });
});

// ── Scripted games ───────────────────────────────────────────────────────────

const BASICS = {
    Forest: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', color_identity: ['G'] },
    Island: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', color_identity: ['U'] },
    'Colossal Dreadmaw': { name: 'Colossal Dreadmaw', mana_cost: '{4}{G}{G}', cmc: 6, type_line: 'Creature — Dinosaur', oracle_text: 'Trample' },
    'Treasure Test': { name: 'Treasure Test', mana_cost: '{1}', cmc: 1, type_line: 'Sorcery', oracle_text: 'Create two Treasure tokens.' }
};

function deckOf(counts) {
    const out = {};
    for (const [name, count] of Object.entries(counts)) out[name] = { ...(CARDS[name] ?? BASICS[name]), count };
    return out;
}

/** Take named copies out of a library's cards, in order. */
function picker(lib) {
    const pool = lib.cards.slice();
    return names => names.map(n => {
        const i = pool.findIndex(c => c.name === n);
        assert.ok(i >= 0, `no ${n} left`);
        return pool.splice(i, 1)[0];
    });
}

const rep = (name, n) => Array.from({ length: n }, () => name);
const SIXTY = FORMATS.constructed;
const EDH = FORMATS.commander;

describe('scripted goldfish games', () => {
    it('Sol Ring pays for itself: one mana on turn 1, four on turn 2', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 20, 'Sol Ring': 1, 'Colossal Dreadmaw': 10 }), { multiplayer: false });
        const take = picker(lib);
        const hand = take(['Forest', 'Forest', 'Sol Ring', ...rep('Colossal Dreadmaw', 4)]);
        const library = take(rep('Forest', 10));
        const g = MD.playScriptedGame(lib, { hand, library, format: SIXTY, onPlay: true });
        assert.deepEqual(g.mana.slice(1, 4), [1, 4, 5]);
        assert.deepEqual(g.log.turns[0].cast.map(c => c.name), ['Sol Ring']);
        const blank = MD.playScriptedGame(lib, { hand, library, format: SIXTY, onPlay: true, rampOn: false });
        assert.deepEqual(blank.mana.slice(1, 4), [1, 2, 3]);
    });

    it('a mana dork is summoning sick the turn it is cast', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 20, 'Llanowar Elves': 1, 'Colossal Dreadmaw': 10 }), { multiplayer: false });
        const take = picker(lib);
        const g = MD.playScriptedGame(lib, {
            hand: take(['Forest', 'Llanowar Elves', ...rep('Colossal Dreadmaw', 5)]),
            library: take(rep('Forest', 10)),
            format: SIXTY
        });
        assert.deepEqual(g.mana.slice(1, 3), [1, 3]);
    });

    it('untapped land ramp leaves mana to cast more ramp the same turn; tapped does not', () => {
        const run = spell => {
            const lib = MD.buildManaLibrary(deckOf({ Forest: 30, [spell]: 1, 'Three Visits': 1, 'Colossal Dreadmaw': 10 }));
            const take = picker(lib);
            return MD.playScriptedGame(lib, {
                hand: take(['Forest', spell, ...rep('Colossal Dreadmaw', 5)]),
                library: take(['Forest', 'Forest', 'Forest', 'Three Visits', ...rep('Forest', 15)]),
                format: EDH
            });
        };
        const claim = run('Skyshroud Claim');
        assert.deepEqual(claim.log.turns[3].cast.map(c => c.name), ['Skyshroud Claim', 'Three Visits']);
        assert.equal(claim.mana[4], 4);
        assert.equal(claim.mana[5], 8);

        const veg = run('Explosive Vegetation');
        assert.deepEqual(veg.log.turns[3].cast.map(c => c.name), ['Explosive Vegetation']);
        assert.equal(veg.mana[5], 7);
        assert.deepEqual(veg.log.turns[4].cast.map(c => c.name), ['Three Visits']);
    });

    it('plays a tapped land when the extra mana would go unused, and an untapped one when it matters', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 20, 'Thornwood Falls': 2, 'Llanowar Elves': 1, 'Colossal Dreadmaw': 10 }), { multiplayer: false });
        const take = picker(lib);
        const idle = MD.playScriptedGame(lib, {
            hand: take(['Forest', 'Thornwood Falls', ...rep('Colossal Dreadmaw', 5)]),
            library: take(rep('Forest', 8)),
            format: SIXTY
        });
        assert.deepEqual(idle.log.turns[0].lands, ['Thornwood Falls']);
        assert.deepEqual(idle.mana.slice(1, 3), [0, 2]);

        const busy = MD.playScriptedGame(lib, {
            hand: take(['Forest', 'Thornwood Falls', 'Llanowar Elves', ...rep('Colossal Dreadmaw', 4)]),
            library: take(rep('Forest', 8)),
            format: SIXTY
        });
        assert.deepEqual(busy.log.turns[0].lands, ['Forest']);
        assert.deepEqual(busy.log.turns[0].cast.map(c => c.name), ['Llanowar Elves']);
    });

    it('extra land drops apply the turn the permanent lands', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 40, 'Azusa, Lost but Seeking': 1, 'Colossal Dreadmaw': 10 }));
        const take = picker(lib);
        const g = MD.playScriptedGame(lib, {
            hand: take(['Azusa, Lost but Seeking', ...rep('Forest', 6)]),
            library: take(rep('Forest', 20)),
            format: EDH
        });
        assert.equal(g.log.turns[2].lands.length, 3, 'one drop, then two more after Azusa');
        assert.equal(g.mana[3], 3);
        assert.equal(g.mana[4], 8);
    });

    it('karoo lands bounce a land after you tap it, and never bounce themselves', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 20, 'Simic Growth Chamber': 1, 'Colossal Dreadmaw': 10 }), { multiplayer: false });
        const take = picker(lib);
        const g = MD.playScriptedGame(lib, {
            hand: take(['Forest', 'Simic Growth Chamber', ...rep('Colossal Dreadmaw', 5)]),
            library: take(rep('Forest', 8)),
            format: SIXTY
        });
        assert.deepEqual(g.log.turns[0].lands, ['Forest']);
        assert.deepEqual(g.log.turns[1].lands, ['Simic Growth Chamber']);
        assert.deepEqual(g.mana.slice(1, 4), [1, 1, 3]);
    });

    it('Treasure counts only when it is turned on, and stays until spent', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 20, 'Treasure Test': 1, 'Colossal Dreadmaw': 10 }), { multiplayer: false });
        const take = picker(lib);
        const hand = take(['Forest', 'Treasure Test', ...rep('Colossal Dreadmaw', 5)]);
        const library = take(rep('Forest', 8));
        assert.deepEqual(MD.playScriptedGame(lib, { hand, library, format: SIXTY }).mana.slice(1, 4), [1, 2, 3]);
        assert.deepEqual(MD.playScriptedGame(lib, { hand, library, format: SIXTY, treasure: true }).mana.slice(1, 4), [1, 4, 5]);
    });

    it('checks the commander’s colours, not just its mana value', () => {
        const blue = { name: 'Blue Tester', mana_cost: '{U}{U}', cmc: 2, type_line: 'Legendary Creature — Test', oracle_text: '', color_identity: ['U'] };
        const green = { ...blue, name: 'Green Tester', mana_cost: '{G}{G}', color_identity: ['G'] };
        for (const [commander, expected] of [[blue, 0], [green, 2]]) {
            const lib = MD.buildManaLibrary(deckOf({ Forest: 40, 'Colossal Dreadmaw': 20 }), { format: 'commander', commanders: [commander.name], commanderCards: [commander] });
            assert.equal(lib.target.kind, 'commander');
            const take = picker(lib);
            const g = MD.playScriptedGame(lib, { hand: take(rep('Forest', 7)), library: take(rep('Forest', 20)), format: EDH });
            assert.equal(g.targetTurn, expected, commander.name);
        }
    });

    it('checks every commander, and plays the land that casts the cheap one on curve', () => {
        const cheap = { name: 'Cheap Partner', mana_cost: '{G}', cmc: 1, type_line: 'Legendary Creature — Elf', oracle_text: '', color_identity: ['G'] };
        const dear = { name: 'Dear Partner', mana_cost: '{4}{U}{U}', cmc: 6, type_line: 'Legendary Creature — Sphinx', oracle_text: '', color_identity: ['U'] };
        const deck = { cardsByName: deckOf({ Forest: 30, 'Thornwood Falls': 2, 'Colossal Dreadmaw': 20 }), commanders: [{ name: cheap.name, card: cheap }, { name: dear.name, card: dear }], format: 'auto' };
        const lib = MD.buildManaLibrary(deck);
        const take = picker(lib);
        const g = MD.playScriptedGame(lib, {
            hand: take(['Forest', 'Thornwood Falls', ...rep('Colossal Dreadmaw', 5)]),
            library: take(rep('Forest', 20)),
            format: EDH
        });
        // Turn 1: the untapped Forest casts the one-drop commander, so it beats the tapped land.
        assert.deepEqual(g.log.turns[0].lands, ['Forest']);
        assert.deepEqual(g.targetTurns, [1, 0], 'no blue source: the Sphinx never comes down');
        assert.deepEqual(g.log.turns[0].castable, ['Cheap Partner']);
        assert.equal(g.targetTurn, 0, 'the primary target is the six-drop');
    });

    it('skips the first draw only on the play in two-player formats', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 30, 'Colossal Dreadmaw': 10 }), { multiplayer: false });
        const take = picker(lib);
        const hand = take(['Forest', 'Forest', ...rep('Colossal Dreadmaw', 5)]);
        const library = take(rep('Forest', 10));
        assert.equal(MD.playScriptedGame(lib, { hand, library, format: SIXTY, onPlay: true }).log.turns[0].drew, null);
        assert.equal(MD.playScriptedGame(lib, { hand, library, format: SIXTY, onPlay: false }).log.turns[0].drew, 'Forest');
        assert.equal(MD.playScriptedGame(lib, { hand, library, format: EDH, onPlay: true }).log.turns[0].drew, 'Forest');
    });
});

// ── Library and simulation ───────────────────────────────────────────────────

describe('library and target', () => {
    it('removes the commander from the bundled example and targets it', () => {
        const lib = MD.buildManaLibrary(DEFAULT_DECK_DATA);
        assert.ok(lib.commanders.includes('The Sixth Doctor'));
        assert.equal(lib.cards.length, 98, '100 cards less two commanders');
        assert.ok(!lib.cards.some(c => c.name === 'The Sixth Doctor' || c.name === 'Susan Foreman'));
        assert.equal(lib.target.kind, 'commander');
        assert.equal(lib.target.name, 'The Sixth Doctor');
        assert.equal(lib.target.mv, 6);
        assert.ok(lib.ramp.some(r => r.name === 'Explosive Vegetation' && r.info.modelled));
        assert.ok(lib.ramp.some(r => r.name === 'Bonny Pall, Clearcutter' && r.info.ramp && !r.info.modelled), 'ramp the model can’t simulate is listed, not counted');
        assert.ok(lib.ramp.some(r => r.name === 'Ugin, the Ineffable' && !r.info.ramp), 'a cost reducer is listed as not ramp');
        assert.ok(!lib.ramp.some(r => r.name === "Aminatou's Augury"), 'a land off the top of eight exiled cards is not ramp');
    });

    it('counts ramp by the same rule as every other page', () => {
        const lib = MD.buildManaLibrary(DEFAULT_DECK_DATA);
        const library = libraryOf(DEFAULT_DECK_DATA, { format: 'commander' });
        assert.equal(MD.rampTotal(lib), tagDeck(library.cards).counts.ramp);
        // Kamahl's Druidic Vow, Kodama of the East Tree and Omenpath Journey are ramp the model can't simulate; Open the Way it plays.
        assert.equal(MD.rampTotal(lib), 21);
        assert.equal(MD.countedRamp(lib), 16);
        assert.equal(MD.countedRamp(lib, { treasure: true }), 17);
        const r = MD.simulateManaDevelopment(lib, { format: EDH, games: 50 });
        assert.equal(r.rampCount + r.notCounted, MD.rampTotal(lib), 'counted + not counted is the ramp count');
        assert.equal(r.notRamp, 2, 'Thryx and Ugin, the Ineffable make spells cheaper');
    });

    it('with partners, races towards the more expensive commander and takes both identities', () => {
        const cheap = { name: 'Cheap Partner', mana_cost: '{G}', cmc: 1, type_line: 'Legendary Creature — Elf', oracle_text: '', color_identity: ['G'] };
        const dear = { name: 'Dear Partner', mana_cost: '{4}{U}{U}', cmc: 6, type_line: 'Legendary Creature — Sphinx', oracle_text: '', color_identity: ['U'] };
        const deck = { cardsByName: deckOf({ Forest: 40, 'Colossal Dreadmaw': 20 }), commanders: [{ name: cheap.name, card: cheap }, { name: dear.name, card: dear }], format: 'auto' };
        const lib = MD.buildManaLibrary(deck);
        assert.deepEqual([...lib.commanders], ['Cheap Partner', 'Dear Partner']);
        assert.equal(lib.target.kind, 'commander');
        assert.equal(lib.target.name, 'Dear Partner');
        assert.equal(lib.target.mv, 6);
        assert.deepEqual(lib.target.names, ['Cheap Partner', 'Dear Partner']);
        assert.deepEqual(lib.identity, ['U', 'G']);
        assert.equal(lib.cards.length, 60);
        // Every commander is a target of its own, in deck order.
        assert.deepEqual(lib.targets.map(t => [t.name, t.mv]), [['Cheap Partner', 1], ['Dear Partner', 6]]);
        assert.deepEqual(lib.missingCommanders, []);
        // Outside Commander there is no command zone, so no commander target.
        assert.equal(MD.buildManaLibrary(deck, { format: 'constructed' }).target.kind, 'top-end');
    });

    it('lists a commander without a card record as unchecked, never guesses its cost', () => {
        const dear = { name: 'Dear Partner', mana_cost: '{4}{U}{U}', cmc: 6, type_line: 'Legendary Creature — Sphinx', oracle_text: '', color_identity: ['U'] };
        const deck = { cardsByName: deckOf({ Forest: 40, 'Colossal Dreadmaw': 20 }), commanders: [{ name: 'Lost Partner', card: null }, { name: dear.name, card: dear }], format: 'auto' };
        const lib = MD.buildManaLibrary(deck);
        assert.deepEqual(lib.targets.map(t => t.name), ['Dear Partner']);
        assert.deepEqual(lib.missingCommanders, ['Lost Partner']);
        // No record for any commander: race the top end and say why.
        const none = MD.buildManaLibrary({ ...deck, commanders: [{ name: 'Lost Partner', card: null }] });
        assert.equal(none.target.kind, 'top-end');
        assert.deepEqual(none.missingCommanders, ['Lost Partner']);
        // Records passed by the page are matched by name, in any order.
        const passed = MD.buildManaLibrary(deck, { commanderCards: [dear, null] });
        assert.deepEqual(passed.missingCommanders, ['Lost Partner']);
        assert.equal(passed.target.name, 'Dear Partner');
    });

    it('the example deck: The Sixth Doctor and Susan Foreman, each a target', () => {
        const lib = MD.buildManaLibrary(DEFAULT_DECK_DATA);
        assert.deepEqual(lib.targets.map(t => [t.name, t.mv, t.cost]), [['The Sixth Doctor', 6, '{4}{G}{U}'], ['Susan Foreman', 2, '{1}{G}']]);
        assert.equal(lib.target.name, 'The Sixth Doctor', 'the most expensive leads');
    });

    it('falls back to the top end: the middle of the three most expensive spells', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 20, 'Colossal Dreadmaw': 4, 'Gilded Lotus': 1, 'Ugin, Eye of the Storms': 1, 'Sol Ring': 2 }));
        assert.equal(lib.target.kind, 'top-end');
        assert.deepEqual(lib.target.names, ['Ugin, Eye of the Storms', 'Colossal Dreadmaw', 'Gilded Lotus']);
        assert.equal(lib.target.name, 'Colossal Dreadmaw');
        assert.equal(lib.target.mv, 6);
    });

    it('deals London mulligans with the Opening Hands rule', () => {
        const lib = MD.buildManaLibrary(deckOf({ Forest: 60 }), { multiplayer: false });
        const dealt = MD.dealOpeningHand(lib.cards, mulberry32(1), { freeMulligan: false });
        // All lands never passes 2–4 lands: mulligan to four and keep.
        assert.equal(dealt.mulligans, 3);
        assert.equal(dealt.hand.length, 4);
        assert.equal(dealt.hand.length + dealt.library.length, 60);
    });
});

describe('simulation', () => {
    const lib = MD.buildManaLibrary(DEFAULT_DECK_DATA);
    const r = MD.simulateManaDevelopment(lib, { format: EDH, games: 2000 });

    it('is deterministic for a seed', () => {
        const again = MD.simulateManaDevelopment(lib, { format: EDH, games: 2000 });
        assert.deepEqual(again.mana, r.mana);
        assert.deepEqual(again.target, r.target);
        const other = MD.simulateManaDevelopment(lib, { format: EDH, games: 2000, seed: 7 });
        assert.notDeepEqual(other.reach[6], r.reach[6]);
    });

    it('reports ordered percentiles and monotone reach odds', () => {
        for (const row of [...r.mana, ...r.landsOnly]) {
            assert.ok(row.p10 <= row.p25 && row.p25 <= row.p50 && row.p50 <= row.p75 && row.p75 <= row.p90, `turn ${row.turn}`);
        }
        for (let t = 2; t < r.reach.length; t++) {
            for (let k = 0; k < r.reach[t].length; k++) assert.ok(r.reach[t][k] >= r.reach[t - 1][k] - 1e-12);
            for (let k = 1; k < r.reach[t].length; k++) assert.ok(r.reach[t][k] <= r.reach[t][k - 1] + 1e-12);
        }
        assert.equal(r.mana.length, MD.SHOWN_TURNS);
    });

    it('ramp never trails lands alone, and the commander comes down sooner', () => {
        r.mana.forEach((row, i) => assert.ok(row.p50 >= r.landsOnly[i].p50, `turn ${row.turn}`));
        assert.ok(r.mana[6].p50 > r.landsOnly[6].p50, 'four-mana ramp shows by turn 7');
        assert.ok(r.target.ramp.onCurve > r.target.lands.onCurve);
        assert.ok(r.target.turnsSaved > 0.5);
        assert.ok(r.target.ramp.median <= r.target.lands.median);
    });

    it('tracks which ramp gets cast, and keeps sample games', () => {
        const veg = r.ramp.find(x => x.name === 'Explosive Vegetation');
        assert.ok(veg.counted);
        assert.ok(veg.castBy4 > 0 && veg.castBy4 <= veg.seenBy4);
        assert.equal(veg.castBy3, 0, 'a four-mana spell can’t be cast by turn 3 without other ramp');
        assert.equal(r.samples.length, MD.SAMPLE_GAMES);
        assert.equal(r.samples[0].turns.length, MD.SIM_TURNS);
    });

    it('reports each commander and both together', () => {
        assert.deepEqual(r.targets.map(t => [t.name, t.primary]), [['The Sixth Doctor', true], ['Susan Foreman', false]]);
        const [doctor, susan] = r.targets;
        assert.deepEqual(doctor.ramp, r.target.ramp, 'the primary row is the headline target');
        assert.equal(susan.ramp.onCurveTurn, 2);
        assert.ok(susan.ramp.onCurve > 0.9, 'a two-drop with 37 lands');
        assert.equal(r.all.count, 2);
        assert.equal(r.all.ramp.onCurveTurn, 6);
        // Both castable by turn t can't beat either one alone.
        for (let t = 1; t <= MD.SIM_TURNS; t++) {
            assert.ok(r.all.ramp.castBy[t] <= Math.min(doctor.ramp.castBy[t], susan.ramp.castBy[t]) + 1e-12, `turn ${t}`);
        }
        assert.ok(r.all.turnsSaved > 0.5);
        assert.equal(r.samples[0].targetTurns.length, 2);
        const rows = MD.commanderRows(r);
        assert.deepEqual(rows.map(x => x.name), ['The Sixth Doctor', 'Susan Foreman', null]);
        assert.equal(rows[2].all, true);
        assert.equal(rows[2].onCurve, r.all.ramp.onCurve);
        assert.deepEqual(MD.commanderRows({ ...r, targets: [doctor], all: null }), [], 'one commander: no table');
    });

    it('counts spell Treasure only when asked', () => {
        const withTreasure = MD.simulateManaDevelopment(lib, { format: EDH, games: 200, treasure: true });
        assert.equal(withTreasure.rampCount, r.rampCount + 1, 'City of Death joins the count');
        assert.equal(MD.countedRamp(lib, { treasure: true }), MD.countedRamp(lib) + 1);
        assert.ok(withTreasure.ramp.find(x => x.name === 'City of Death').counted);
    });

    it('runs in slices with the same answer as one go', () => {
        const run = MD.createRun(lib, { format: EDH, games: 2000 });
        while (!MD.runBatch(run, 137)) { /* keep going */ }
        assert.deepEqual(MD.finishRun(run).mana, r.mana);
    });

    it('simulates bare type counts as lands only', () => {
        const counts = MD.buildCountsLibrary({ lands: 36, creatures: 63 });
        const res = MD.simulateManaDevelopment(counts, { format: EDH, games: 500 });
        assert.equal(res.placeholder, true);
        assert.equal(res.rampCount, 0);
        assert.equal(res.target, null);
        assert.match(MD.summarize(res).html, /no decklist/);
    });

    it('returns null for a deck too small to deal', () => {
        const tiny = MD.buildManaLibrary(deckOf({ Forest: 5 }));
        assert.equal(MD.simulateManaDevelopment(tiny, { format: SIXTY }), null);
    });

    it('plays 5,000 paired games quickly enough to slice', () => {
        const t0 = performance.now();
        MD.simulateManaDevelopment(lib, { format: EDH });
        assert.ok(performance.now() - t0 < budget(3000));
    });
});

// ── Words ────────────────────────────────────────────────────────────────────

describe('words', () => {
    it('percentile is nearest-rank, never the sampled maximum', () => {
        const hist = [0, 10, 80, 9, 1]; // 100 games, one outlier at 4
        assert.equal(MD.percentile(hist, 100, 0.1), 1);
        assert.equal(MD.percentile(hist, 100, 0.5), 2);
        assert.equal(MD.percentile(hist, 100, 0.9), 2);
        assert.equal(MD.percentile(hist, 100, 0.99), 3);
        assert.equal(MD.percentile(hist, 0, 0.5), null);
    });

    it('turn ranges and turn counts', () => {
        assert.equal(MD.turnRange(5, 5), 'turn 5');
        assert.equal(MD.turnRange(5, 6), 'turn 5 or 6');
        assert.equal(MD.turnRange(5, 7), 'turns 5–7');
        assert.equal(MD.turnRange(9, 13), 'turn 9 or later');
        assert.equal(MD.turnRange(13, 13), 'after turn 12');
        assert.equal(MD.turnsWord(0.1), 'less than a quarter of a turn');
        assert.equal(MD.turnsWord(0.6), 'about half a turn');
        assert.equal(MD.turnsWord(1.0), 'about 1 turn');
        assert.equal(MD.turnsWord(1.4), 'about 1.5 turns');
        assert.equal(MD.turnsWord(2.1), 'about 2 turns');
    });

    const result = (over = {}) => ({
        lands: 37, rampCount: 18, placeholder: false,
        mana: Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, p10: i, p25: i, p50: i + 2, p75: i + 2, p90: i + 3 })),
        target: { kind: 'commander', name: 'The Sixth Doctor', mv: 6, ramp: { p25: 5, p75: 6, median: 5, onCurve: 0.72 }, lands: { onCurve: 0.4 }, turnsSaved: 1.4 },
        ...over
    });

    it('builds the bottom line from the numbers', () => {
        const s = MD.summarize(result());
        assert.match(s.html, /With <strong>37<\/strong> lands and <strong>18<\/strong> ramp pieces/);
        assert.match(s.html, /<strong>5 mana on turn 4<\/strong>/);
        assert.match(s.html, /The Sixth Doctor<\/span> on <strong>turn 5 or 6<\/strong>/);
        assert.match(s.html, /ramp saves you <strong>about 1.5 turns<\/strong> over lands alone/);
        assert.equal(s.tone, 'good');
    });

    it('sets the tone from the on-curve chance and handles edge cases', () => {
        const t = result().target;
        assert.equal(MD.summarize(result({ target: { ...t, ramp: { ...t.ramp, onCurve: 0.5 } } })).tone, 'warn');
        assert.equal(MD.summarize(result({ target: { ...t, ramp: { ...t.ramp, onCurve: 0.2 } } })).tone, 'bad');
        assert.match(MD.summarize(result({ rampCount: 0 })).html, /found no ramp it can count/);
        assert.match(MD.summarize(result({ target: { ...t, turnsSaved: 0.1 } })).html, /barely changes/);
        assert.match(MD.summarize(result({ target: { ...t, kind: 'top-end', name: 'Craterhoof Behemoth', mv: 8 } })).html, /your top end \(.*Craterhoof Behemoth.*, 8 mana\)/);
        assert.match(MD.summarize(result({ target: { ...t, ramp: { ...t.ramp, median: 13, p25: 11, p75: 13 } } })).html, /can’t cast .* by <strong>turn 12<\/strong>/);
        assert.equal(MD.summarize(result({ target: null })).tone, 'flat');
        assert.equal(MD.summarize(null).tone, 'flat');
    });

    it('names every commander in the bottom line, cheapest first', () => {
        const base = result();
        const doctor = { ...base.target, primary: true };
        const susan = { kind: 'commander', name: 'Susan Foreman', mv: 2, ramp: { p25: 2, p75: 2, median: 2, onCurve: 0.96 }, lands: { onCurve: 0.96 }, turnsSaved: 0 };
        const both = result({ targets: [doctor, susan], all: { count: 2, mv: 6, ramp: { p25: 5, p75: 7, median: 5, onCurve: 0.3 }, lands: { onCurve: 0.1 }, turnsSaved: 2.4 } });
        const s = MD.summarize(both);
        assert.match(s.html, /can cast .*Susan Foreman.* on <strong>turn 2<\/strong> and .*The Sixth Doctor.* on <strong>turn 5 or 6<\/strong>/);
        assert.match(s.html, /ramp has both castable <strong>about 2.5 turns<\/strong> sooner than lands alone/);
        assert.equal(s.tone, 'bad', 'the tone is both on curve');
        const late = MD.summarize(result({ targets: [doctor, { ...susan, ramp: { ...susan.ramp, median: 13 } }], all: { ...both.all, count: 3, turnsSaved: 0.1 } }));
        assert.match(late.html, /Susan Foreman.* not until after <strong>turn 12<\/strong>/);
        assert.match(late.html, /barely changes when all 3 come down/);
    });

    it('describes a sample turn with card links', () => {
        const html = MD.describeTurn({ lands: ['Forest'], cast: [{ name: 'Cultivate', notes: ['Forest', 'Island to hand'] }] });
        assert.match(html, /data-card="Forest"/);
        assert.match(html, /data-card="Cultivate"/);
        assert.match(html, /→ Forest, Island to hand/);
        assert.match(MD.describeTurn({ lands: [], cast: [] }), /no land, no ramp/);
        assert.equal(MD.manaPips(COLOR_BIT.G | COLOR_BIT.U), '<span class="ms ms-u" aria-hidden="true">U</span><span class="ms ms-g" aria-hidden="true">G</span>');
    });
});

// ── Page ─────────────────────────────────────────────────────────────────────

describe('Mana Development page', () => {
    it('exports the calculator contract', () => {
        for (const fn of ['init', 'updateUI', 'calculate', 'getShareParams', 'applyShareParams']) {
            assert.equal(typeof Page[fn], 'function', fn);
        }
    });

    it('calculates the bundled deck: 5,000 games, The Sixth Doctor as the target', () => {
        const r = Page.calculate();
        assert.equal(r.games, MD.DEFAULT_GAMES);
        assert.equal(r.target.name, 'The Sixth Doctor');
        assert.equal(Page.calculate(), r, 'cached');
    });

    it('round-trips share params and ignores junk', () => {
        assert.deepEqual(Page.getShareParams(), {});
        Page.applyShareParams(new URLSearchParams('mddraw=yes&mdtreasure=2'));
        assert.deepEqual(Page.getSettings(), { onPlay: true, treasure: false });
        Page.applyShareParams(new URLSearchParams('mddraw=1&mdtreasure=1'));
        assert.deepEqual(Page.getShareParams(), { mddraw: 1, mdtreasure: 1 });
    });

    it('has the containers the module renders into, scoped styles and a complete guide', () => {
        for (const id of ['md-summary', 'md-facts', 'manadev-chart', 'md-grid', 'md-ramp', 'md-samples', 'md-reshuffle', 'md-treasure']) {
            assert.ok(template.includes(`id="${id}"`), id);
        }
        assert.ok(!/<h1/i.test(template), 'the shared header owns the title');
        const selectors = styles.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g).map(s => s.trim()).filter(s => s && !s.startsWith('@'));
        for (const sel of selectors) for (const part of sel.split(',')) assert.match(part.trim(), /^#manadev-tab\b/, part);
        assert.ok(!/#[0-9a-f]{3,6}\b/i.test(styles.replace(/#manadev-tab/g, '')), 'tokens only, no hex colours');
        for (const key of ['intro', 'howToRead', 'method', 'assumptions', 'tips', 'terms']) assert.ok(guide[key], key);
        for (const t of guide.terms) assert.ok(GLOSSARY[t], `unknown glossary term ${t}`);
    });
});
