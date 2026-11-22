/**
 * Game Plan: the card rules, the plan schema and its link codec, exact
 * scripted games for every rule the user's two plans rely on, the
 * simulation's invariants and the words built from it.
 *
 * tests/fixtures/plan-cards.json is a Scryfall snapshot (name, cost, type,
 * oracle text, power) of the cards below, so rules are tested on the exact
 * wording players import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as Rules from '../../js/utils/planRules.js';
import * as Schema from '../../js/utils/planSchema.js';
import * as Engine from '../../js/utils/planEngine.js';
import * as GP from '../../js/utils/models/plan.js';
import { FORMATS } from '../../js/utils/format.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import { PLAN_PRESETS, presetEntry } from '../../js/data/plans/index.js';
import { budget, medianMs } from '../helpers/timing.js';

const CARDS = JSON.parse(readFileSync(new URL('../fixtures/plan-cards.json', import.meta.url), 'utf8'));
const { W, U, R, G } = Rules;
const DRAWS = FORMATS.commander; // everyone draws on turn one

function deckOf(list, commanders = []) {
    const cardsByName = {};
    for (const [name, count] of Object.entries(list)) {
        assert.ok(CARDS[name], `fixture missing: ${name}`);
        cardsByName[name] = { ...CARDS[name], count };
    }
    return { cardsByName, commanders: commanders.map(name => ({ name, card: CARDS[name] })), format: commanders.length ? 'commander' : 'constructed' };
}

const EVERYTHING = {
    Forest: 20, Plains: 10, Island: 6, 'Misty Rainforest': 1, 'Breeding Pool': 1, 'Evolving Wilds': 1,
    'Fanatic of Rhonas': 1, 'Whisperer of the Wilds': 1, 'Ilysian Caryatid': 1, 'Raucous Audience': 1, 'Bloom Tender': 1,
    'Priest of Titania': 1, 'Badgermole Cub': 1, 'Jadzia Dax, Living Legacy': 1, 'Karametra, God of Harvests': 1,
    'Susan Foreman': 1, 'Mind Stone': 1, 'Arcane Signet': 1, 'Sol Ring': 1, 'Grizzly Bears': 4, 'Colossal Dreadmaw': 2,
    'Serra Angel': 2, 'Ancestral Statue': 2, 'Explosive Vegetation': 2, 'Skyshroud Claim': 1, 'Elvish Archdruid': 1, 'Topiary Stomper': 1
};
/** Selvala in the command zone, everything else in the list. */
const SELVALA = Engine.buildPlanLibrary(deckOf(EVERYTHING, ['Selvala, Eager Trailblazer']), { format: 'commander' });
/** No command zone: Selvala and The Sixth Doctor are ordinary cards. */
const OPEN = Engine.buildPlanLibrary(deckOf({ ...EVERYTHING, 'Selvala, Eager Trailblazer': 1, 'The Sixth Doctor': 1 }), { format: 'constructed' });

const cast = group => ({ kind: 'cast', group });
const mana = atLeast => ({ kind: 'mana', atLeast });
const plan = (...steps) => ({ steps: steps.map(([turn, require]) => ({ turn, require })) });
const play = (lib, p, opts) => Engine.playScriptedPlanGame(lib, p, { format: DRAWS, ...opts });
const named = (board, name) => board.filter(p => p.name === name);

// ── Card rules ───────────────────────────────────────────────────────────────

describe('card rules: the registry', () => {
    it('has a named rule for every card the two plans are built on', () => {
        for (const name of ['Selvala, Eager Trailblazer', 'Fanatic of Rhonas', 'Whisperer of the Wilds', 'Ilysian Caryatid', 'Raucous Audience',
            'Bloom Tender', 'Priest of Titania', 'Badgermole Cub', 'Jadzia Dax, Living Legacy', 'Karametra, God of Harvests', 'The Sixth Doctor', 'Susan Foreman']) {
            const rule = Rules.namedRule(name);
            assert.ok(rule, `${name} has a rule`);
            assert.ok(rule.label, `${name} says what it does`);
        }
        assert.ok(Rules.ruleNames().includes('Selvala, Eager Trailblazer'));
        assert.equal(Rules.cardRule('fanatic of rhonas'), Rules.namedRule('Fanatic of Rhonas'), 'names match case-insensitively');
    });

    it('reads the same wording families from rules text on cards without a named rule', () => {
        const ferocious = Rules.detectCardRule({ name: 'Test Shaman', oracle_text: '{T}: Add {R}.\nFerocious — {T}: Add {R}{R}{R}. Activate only if you control a creature with power 4 or greater.' });
        assert.ok(ferocious?.detected);
        const game = big => ({ controlsPower: n => (big ? 4 : 1) >= n });
        assert.deepEqual(ferocious.mana(null, game(false)), Rules.out(1, R));
        assert.deepEqual(ferocious.mana(null, game(true)), Rules.out(3, R));

        const archdruid = Rules.detectCardRule(CARDS['Elvish Archdruid']);
        assert.deepEqual(archdruid.mana(null, { countSubtype: word => (word === 'elf' ? 3 : 0) }), Rules.out(3, G));

        // Every named card's text alone gives the same behaviour.
        for (const name of ['Selvala, Eager Trailblazer', 'Fanatic of Rhonas', 'Ilysian Caryatid', 'Raucous Audience', 'Bloom Tender',
            'Priest of Titania', 'Badgermole Cub', 'Jadzia Dax, Living Legacy', 'Karametra, God of Harvests', 'The Sixth Doctor']) {
            const detected = Rules.detectCardRule(CARDS[name]);
            assert.ok(detected, `${name}'s text is recognised`);
            for (const hook of ['mana', 'tapBoost', 'onMainPhase', 'onCast', 'onEnter', 'creature']) {
                assert.equal(typeof detected[hook], typeof Rules.namedRule(name)[hook], `${name}: ${hook}`);
            }
        }
        assert.equal(Rules.detectCardRule(CARDS['Grizzly Bears']), null);
        assert.equal(Rules.detectCardRule(null), null);
        assert.equal(Rules.cardRule(CARDS['Grizzly Bears']), null);
    });

    it('builds outputs from symbols and combines partial rules', () => {
        assert.deepEqual(Rules.symbols('{G}{G}{G}{G}'), Rules.out(4, G));
        assert.deepEqual(Rules.symbols('{C}{C}'), Rules.out(2, 0));
        assert.deepEqual(Rules.symbols('{G}{U}'), Rules.out(2, G | U));
        const seen = [];
        const combined = Rules.rule({ onCast: () => seen.push('a'), label: 'one' }, { onCast: () => seen.push('b'), label: 'two', haste: true });
        combined.onCast();
        assert.deepEqual(seen, ['a', 'b']);
        assert.equal(combined.label, 'one; two');
        assert.equal(combined.haste, true);
        assert.ok(Object.isFrozen(combined));
        assert.throws(() => Rules.defineCardRule('', {}), /card name/);
    });
});

// ── Schema and links ─────────────────────────────────────────────────────────

const WILD_SPLENDOR = plan(
    [2, cast({ is: 'mana', mv: [0, 2] })],
    [3, cast({ is: 'commander', names: ['Selvala, Eager Trailblazer'] })],
    [4, mana(8)],
    [4, { kind: 'package', options: [{ count: 2, group: { is: 'any', mv: [4, 4] } }, { count: 1, group: { is: 'any', mv: [7, 9] } }] }]
);
const DOCTOR = plan(
    [2, cast({ is: 'commander', names: ['Susan Foreman'] })],
    [4, cast({ is: 'landRamp', mv: [4, 4], lands: 2 })],
    [5, cast({ is: 'commander', names: ['The Sixth Doctor'] })],
    [6, { kind: 'cast', group: { is: 'historic' }, after: { is: 'commander', names: ['The Sixth Doctor'] } }]
);

describe('plan schema', () => {
    it('keeps valid steps and drops what can’t be checked', () => {
        const p = Schema.normalizePlan({ steps: [
            { turn: 99, require: mana(500) },
            { turn: 2, require: cast({ is: 'named', names: [] }) },
            { turn: 3, require: cast({ is: 'nonsense' }) },
            { turn: 3, require: { kind: 'package', options: [{ count: 9, group: { is: 'any', mv: [5, 2] } }] } },
            { require: { kind: 'teleport' } }
        ] });
        assert.deepEqual(p.steps, [
            { turn: Schema.MAX_TURN, require: { kind: 'mana', atLeast: Schema.MAX_MANA_TARGET } },
            { turn: 3, require: { kind: 'package', options: [{ count: Schema.MAX_COUNT, group: { is: 'any', mv: [5, 5] } }] } }
        ]);
        assert.deepEqual(Schema.normalizePlan(null), { v: 1, steps: [] });
        assert.deepEqual(Schema.normalizeGroup({ is: 'any', mv: [0, Schema.MAX_MV] }), { is: 'any' }, 'a full range is no range');
        assert.deepEqual(Schema.normalizeGroup({ is: 'named', names: [' Sol Ring ', 'sol ring', 'Mind Stone'] }), { is: 'named', names: ['Sol Ring', 'Mind Stone'] });
    });

    it('round-trips both plans through a compact, URL-safe link', () => {
        for (const p of [WILD_SPLENDOR, DOCTOR]) {
            const code = Schema.encodePlan(p);
            assert.match(code, /^[A-Za-z0-9*._-]+$/);
            assert.ok(code.length < 120, `compact: ${code}`);
            assert.deepEqual(Schema.decodePlan(code), Schema.normalizePlan(p));
            assert.equal(new URLSearchParams({ gp: code }).toString(), `gp=${code}`, 'nothing to escape');
        }
        assert.equal(Schema.encodePlan(WILD_SPLENDOR), '2cm.v0w2_3ck.nSelvala*2C*20Eager*20Trailblazer_4m8_4p2xa.v4w4-1xa.v7w9');
        const odd = plan([3, cast({ is: 'named', names: ['Kamahl’s Druidic Vow', 'Sea Gate Restoration // Sea Gate, Reborn', 'A-B_C.D*E'] })]);
        assert.deepEqual(Schema.decodePlan(Schema.encodePlan(odd)), Schema.normalizePlan(odd));
        assert.equal(Schema.encodePlan({ steps: [] }), '');
    });

    it('carries spend, ramp, copied and measure-only steps, and old links read as before', () => {
        const p = plan(
            [3, { kind: 'ramp', atLeast: 6 }],
            [4, { kind: 'spend', atLeast: 8, group: { is: 'any', mv: [4, Schema.MAX_MV] } }],
            [4, { kind: 'spend', atLeast: 9 }],
            [5, { kind: 'cast', group: { is: 'historic' }, paid: 4, copied: true, after: { is: 'commander', names: ['The Sixth Doctor'] } }]
        );
        p.steps.push({ turn: 5, info: true, require: cast({ is: 'commander', names: ['The Sixth Doctor'] }) });
        const code = Schema.encodePlan(p);
        assert.equal(code, '3r6_4s8-a.v4w20_4s9_5cP4Yh-k.nThe*20Sixth*20Doctor_i5ck.nThe*20Sixth*20Doctor');
        assert.deepEqual(Schema.decodePlan(code), Schema.normalizePlan(p));
        assert.equal(Schema.normalizePlan(p).steps[4].info, true);
        assert.deepEqual(Schema.normalizeRequirement({ kind: 'spend', atLeast: 8, group: { is: 'any' } }), { kind: 'spend', atLeast: 8 }, 'any spell is the default');
        assert.equal(Schema.normalizeRequirement({ kind: 'ramp' }), null);
        assert.deepEqual(Schema.normalizeRequirement({ kind: 'cast', group: { is: 'any' }, paid: 'x', copied: 'yes' }), { kind: 'cast', group: { is: 'any' } });
        for (const bad of ['3r0', '3r99', '4s8-zz', '4s8-a-a', '5cP99h', '5cPh', 'x5m3', 'ii5m3']) assert.equal(Schema.decodePlan(bad), null, bad);
        assert.deepEqual(p.steps.map(s => Schema.describeRequirement(s)), [
            'Ramp to 6+ mana for next turn', 'Spend 8+ mana on spells with MV 4+ from your hand', 'Spend 9+ mana on spells from your hand',
            'Copy a historic spell costing 4+ with The Sixth Doctor', 'Cast The Sixth Doctor'
        ]);
        assert.equal(Schema.describeRequirement({ require: { kind: 'cast', group: { is: 'any', mv: [4, 4] }, paid: 5 } }), 'Cast a 4-drop costing 5+');
        assert.deepEqual([Schema.stepSubject(p.steps[0]), Schema.stepSubject(p.steps[1])], ['ramp', 'spells with MV 4+']);
        assert.deepEqual(Schema.decodePlan(Schema.encodePlan(DOCTOR)), Schema.normalizePlan(DOCTOR), 'a plan without the new kinds encodes as it always did');
        assert.equal(GP.valueLabel(p.steps[1]), 'Mana spent on spells with MV 4+ on turn 4');
        assert.equal(GP.valueLabel(p.steps[0]), 'Mana ready for turn 4 at the end of turn 3');
        assert.equal(GP.valueLabel({ turn: 2, require: cast({ is: 'any' }) }), 'Mana value of the spell cast by turn 2');
        assert.equal(GP.valueLabel({ turn: 2, require: mana(3) }), '');
        assert.equal(GP.valueLabel(null), '');
    });

    it('says why a spend, ramp or copy step missed', () => {
        const p = plan([3, { kind: 'ramp', atLeast: 6 }], [4, { kind: 'spend', atLeast: 8, group: { is: 'any', mv: [4, 20] } }],
            [5, { kind: 'cast', group: { is: 'historic' }, paid: 4, copied: true }]);
        const text = (step, code, colour = 0) => GP.reasonText({ step, code, colour }, p);
        assert.equal(text(0, Engine.REASON.NO_CARD), 'no ramp by turn 3');
        assert.equal(text(0, Engine.REASON.LAND), 'a missed land drop by turn 3');
        assert.equal(text(0, Engine.REASON.MANA), 'too little mana to cast ramp on turn 3');
        assert.equal(text(0, Engine.REASON.COLOUR, G), 'no way to make {G} for ramp on turn 3');
        assert.equal(text(0, Engine.REASON.SHORT), 'ramp that left less than 6 mana for turn 4');
        assert.equal(text(1, Engine.REASON.NO_PACKAGE), 'too few spells with MV 4+ in hand to spend 8 on turn 4');
        assert.equal(text(1, Engine.REASON.FIT), '8+ mana on turn 4, but no spells with MV 4+ in hand that add up to 8');
        assert.equal(text(1, Engine.REASON.LAND), 'a missed land drop by turn 4');
        assert.equal(text(1, Engine.REASON.MANA), 'too little mana to spend 8 on turn 4');
        assert.equal(text(2, Engine.REASON.NO_CARD), 'no historic spell costing 4+ by turn 5');
        assert.equal(text(2, Engine.REASON.NO_COPY), 'nothing to copy a historic spell on turn 5');
    });

    it('rejects a damaged link whole', () => {
        for (const bad of ['', 'x', '2q8', '0m8', '11m8', '2cz', '2cm.v0w2-', '2cm.q1', '2pxa', '2p9xa', '2cn', '2cm_', '2cn.n*ZZ', '<script>', 'a'.repeat(2001),
            Array.from({ length: Schema.MAX_STEPS + 1 }, () => '2m3').join('_')]) {
            assert.equal(Schema.decodePlan(bad), null, bad.slice(0, 40));
        }
        assert.equal(Schema.decodePlan(null), null);
    });

    it('says each step in words', () => {
        const words = WILD_SPLENDOR.steps.map(s => Schema.describeRequirement(s));
        assert.deepEqual(words, ['Cast a mana 2-drop', 'Cast Selvala, Eager Trailblazer', 'Have 8+ mana', 'Cast two 4-drops or one 7–9-drop']);
        assert.deepEqual(DOCTOR.steps.map(s => Schema.describeRequirement(s)), [
            'Cast Susan Foreman', 'Cast a 4-mana two-land ramp spell', 'Cast The Sixth Doctor', 'Cast a historic spell after The Sixth Doctor is out'
        ]);
        const noun = group => Schema.groupNoun(group).one;
        assert.equal(noun({ is: 'any', mv: [8, Schema.MAX_MV] }), 'spell with MV 8+');
        assert.equal(Schema.groupNoun({ is: 'any', mv: [8, Schema.MAX_MV] }).many, 'spells with MV 8+');
        assert.equal(noun({ is: 'creature', mv: [6, 6] }), '6-drop creature');
        assert.equal(Schema.groupNoun({ is: 'sorcery' }).many, 'sorceries');
        assert.equal(noun({ is: 'mana', mv: [0, 5] }), 'mana source with MV 5 or less');
        assert.equal(noun({ is: 'commander' }), 'your commander');
        assert.equal(Schema.article('8-drop'), 'an');
        assert.equal(Schema.describeRequirement({ require: { kind: 'package', options: [{ count: 2, group: { is: 'named', names: ['Sol Ring', 'Mind Stone'] } }] } }),
            'Cast two of Sol Ring, Mind Stone');
        assert.equal(Schema.stepSubject(WILD_SPLENDOR.steps[3]), 'payoff');
        assert.equal(Schema.describeRequirement({}), '');
    });

    it('matches groups on the engine’s cards', () => {
        const card = name => Engine.findPlanCard(OPEN, name);
        const m = (group, name) => Schema.matchesGroup(card(name), group);
        assert.ok(m({ is: 'mana', mv: [0, 2] }, 'Fanatic of Rhonas'));
        assert.ok(m({ is: 'mana', mv: [0, 2] }, 'Jadzia Dax, Living Legacy'), 'start-of-turn mana counts');
        assert.ok(m({ is: 'mana' }, 'Badgermole Cub'), 'extra mana on every creature tap counts');
        assert.ok(!m({ is: 'mana', mv: [0, 2] }, 'Grizzly Bears'));
        assert.ok(m({ is: 'landRamp', lands: 2, mv: [4, 4] }, 'Explosive Vegetation'));
        assert.ok(!m({ is: 'landRamp', lands: 2 }, 'Topiary Stomper'), 'one land is not two');
        assert.ok(m({ is: 'historic' }, 'Mind Stone') && m({ is: 'historic' }, 'The Sixth Doctor') && !m({ is: 'historic' }, 'Grizzly Bears'));
        assert.ok(m({ is: 'named', names: ['grizzly bears'] }, 'Grizzly Bears'));
        assert.ok(m({ is: 'creature', mv: [6, 6] }, 'Colossal Dreadmaw'));
        assert.ok(!m({ is: 'any' }, 'Forest'), 'lands are never a group');
        assert.ok(m({ is: 'commander' }, 'Selvala, Eager Trailblazer') === false, 'not in the command zone here');
        assert.ok(Schema.matchesGroup(Engine.findPlanCard(SELVALA, 'Selvala, Eager Trailblazer'), { is: 'commander' }));
        assert.equal(Schema.compileGroup({ is: 'nope' })(card('Grizzly Bears')), false);
    });
});

// ── Scripted games: the rules, exactly ───────────────────────────────────────

describe('scripted games: Wild Splendor', () => {
    it('Selvala and Fanatic of Rhonas: turn 4 makes 4 lands + 4 + 2', () => {
        const r = play(SELVALA, plan([3, cast({ is: 'commander' })], [4, mana(10)]), {
            hand: ['Forest', 'Plains', 'Forest', 'Fanatic of Rhonas'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest']
        });
        assert.deepEqual(r.mana, [0, 1, 2, 4, 10, 11]);
        assert.deepEqual(r.stepTurns, [3, 4]);
        assert.equal(r.log.turns[1].cast[0].name, 'Fanatic of Rhonas');
        assert.deepEqual(r.log.turns[2].cast.map(c => [c.name, c.from, c.step]), [['Selvala, Eager Trailblazer', 'command', 0]]);
        assert.equal(r.log.turns[1].lands[0], 'Plains', 'the land drop brings the colour the next step needs');
    });

    it('Priest of Titania counts Selvala as an Elf', () => {
        const r = play(SELVALA, plan([3, cast({ is: 'commander' })], [4, mana(8)]), {
            hand: ['Forest', 'Plains', 'Forest', 'Priest of Titania'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest']
        });
        // Turn 4: 4 lands + Priest {G}{G} (two Elves) + Selvala 2 (powers 1 and 4).
        assert.deepEqual(r.mana, [0, 1, 2, 4, 8, 9]);
        assert.deepEqual(r.stepTurns, [3, 4]);
    });

    it('a creature cast makes a red Mercenary: a new power for Selvala and a new colour for Bloom Tender', () => {
        const r = play(OPEN, plan([1, cast({ is: 'creature' })]), {
            battlefield: ['Forest', 'Forest', 'Plains', 'Plains', 'Selvala, Eager Trailblazer', 'Bloom Tender'],
            hand: ['Grizzly Bears'], library: ['Forest', 'Forest', 'Forest', 'Forest']
        });
        // Before: 5 lands + Selvala 2 + Bloom Tender 2 (green, white) = 9. After paying 2: 3 lands +
        // Selvala 3 (powers 4, 1, 2) + Bloom Tender 3 (green, white, red) = 9 more.
        assert.equal(r.mana[1], 11);
        const token = named(r.board, 'Mercenary');
        assert.equal(token.length, 1);
        assert.deepEqual([token[0].token, token[0].power], [true, 1]);
        assert.match(r.log.turns[0].cast[0].notes.join(' '), /Mercenary token/);
    });

    it('Fanatic and Whisperer wait for power 4; Raucous Audience and Ilysian Caryatid add more with it', () => {
        const without = play(OPEN, plan([1, mana(1)]), {
            battlefield: ['Forest', 'Forest', 'Forest', 'Fanatic of Rhonas', 'Whisperer of the Wilds', 'Raucous Audience', 'Ilysian Caryatid'], hand: [], library: ['Island']
        });
        assert.equal(without.mana[1], 4 + 4, 'four lands and four dorks at one each');
        const withBig = play(OPEN, plan([1, mana(1)]), {
            battlefield: ['Forest', 'Forest', 'Forest', 'Fanatic of Rhonas', 'Whisperer of the Wilds', 'Raucous Audience', 'Ilysian Caryatid', 'Colossal Dreadmaw'], hand: [], library: ['Island']
        });
        assert.equal(withBig.mana[1], 4 + 4 + 2 + 2 + 2);
    });

    it('Badgermole Cub earthbends a land into a creature and adds {G} to every creature tapped for mana', () => {
        const r = play(OPEN, plan([4, mana(7)]), {
            hand: ['Forest', 'Forest', 'Forest', 'Badgermole Cub'], library: ['Forest', 'Fanatic of Rhonas', 'Forest', 'Forest', 'Forest']
        });
        // T3: 3 lands, one of them a creature (+{G}). T4: 4 lands +1, Fanatic {G} +1.
        assert.deepEqual(r.mana, [0, 1, 2, 4, 7, 8]);
        assert.deepEqual(r.stepTurns, [4]);
        const land = r.board.find(p => p.animated);
        assert.deepEqual([land.name, land.creature, land.power, land.counters], ['Forest', true, 1, 1]);
        assert.match(r.log.turns[1].cast[0].notes.join(' '), /earthbends Forest/);
    });

    it('Jadzia Dax gets a counter each turn, then adds {G} per counter', () => {
        const r = play(OPEN, plan([4, mana(6)]), {
            hand: ['Forest', 'Forest', 'Forest', 'Jadzia Dax, Living Legacy'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest']
        });
        assert.deepEqual(r.mana, [0, 1, 2, 3 + 1, 4 + 2, 5 + 3]);
        const jadzia = named(r.board, 'Jadzia Dax, Living Legacy')[0];
        assert.deepEqual([jadzia.counters, jadzia.power], [3, 3]);
        assert.match(r.log.turns[3].notes.join(' '), /counter 2, adds \{G\}\{G\}/);
    });

    it('Karametra finds a Forest or Plains, tapped, whenever you cast a creature — and is no creature yet', () => {
        const r = play(OPEN, plan([1, cast({ is: 'creature' })]), {
            battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Karametra, God of Harvests'],
            hand: ['Grizzly Bears'], library: ['Forest', 'Forest', 'Plains', 'Forest'], turns: 2
        });
        // Five lands, two land drops and the one Karametra found.
        assert.equal(r.board.filter(p => p.name === 'Forest' || p.name === 'Plains').length, 8);
        assert.match(r.log.turns[0].cast[0].notes.join(' '), /Karametra, God of Harvests: Forest \(tapped\)/);
        assert.equal(r.log.turns[1].drew, 'Forest', 'a search takes the deepest copy, so the next draw stays put');
        assert.equal(named(r.board, 'Karametra, God of Harvests')[0].creature, false, 'devotion 3 of 7');
    });

    it('can’t cast Selvala without {W}, and says so', () => {
        const r = play(SELVALA, plan([3, cast({ is: 'commander' })]), {
            hand: ['Forest', 'Forest', 'Forest', 'Fanatic of Rhonas'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest']
        });
        assert.equal(r.mana[3], 4);
        assert.deepEqual(r.stepTurns, [0]);
        assert.equal(r.reasons[0], Engine.REASON.COLOUR | (W << 8));
    });

    it('casts a package from hand in one turn, and holds its cards until then', () => {
        const two = play(OPEN, plan([1, { kind: 'package', options: [{ count: 2, group: { is: 'any', mv: [4, 4] } }] }]), {
            battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], hand: ['Ancestral Statue', 'Ancestral Statue'], library: ['Forest', 'Forest', 'Forest']
        });
        assert.deepEqual(two.stepTurns, [1]);
        assert.deepEqual(two.log.turns[0].cast.map(c => c.name), ['Ancestral Statue', 'Ancestral Statue']);

        const held = play(OPEN, plan([3, { kind: 'package', options: [{ count: 2, group: { is: 'landRamp', lands: 2 } }] }]), {
            battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], hand: ['Explosive Vegetation'], library: ['Forest', 'Explosive Vegetation', 'Forest', 'Forest', 'Forest']
        });
        assert.deepEqual(held.log.turns[0].cast, [], 'a payoff the package needs is not cast as ramp');
        assert.deepEqual(held.stepTurns, [2], 'two in hand by turn 2: both cast that turn');

        const short = play(OPEN, plan([1, { kind: 'package', options: [{ count: 2, group: { is: 'any', mv: [4, 4] } }] }]), {
            battlefield: ['Forest', 'Forest'], hand: ['Ancestral Statue'], library: ['Forest', 'Forest', 'Forest']
        });
        assert.equal(short.reasons[0], Engine.REASON.NO_PACKAGE);
    });
});

describe('scripted games: Doctor Whostoric', () => {
    it('The Sixth Doctor copies the first historic spell each turn: a copied Mind Stone makes mana too', () => {
        const r = play(OPEN, plan([1, { kind: 'cast', group: { is: 'historic' }, after: { is: 'named', names: ['The Sixth Doctor'] } }]), {
            battlefield: ['Island', 'Island', 'Forest', 'Forest', 'Forest', 'Forest', 'The Sixth Doctor'],
            hand: ['Mind Stone', 'Arcane Signet'], library: ['Forest', 'Forest', 'Forest', 'Forest']
        });
        const stones = named(r.board, 'Mind Stone');
        assert.equal(stones.length, 2);
        assert.equal(stones.filter(p => p.token).length, 1, 'the copy is a token');
        assert.equal(named(r.board, 'Arcane Signet').length, 1, 'only once each turn');
        assert.deepEqual(r.stepTurns, [1]);
        // 7 lands; spent 4; then 3 lands + two Mind Stones + Arcane Signet.
        assert.equal(r.mana[1], 4 + 3 + 2 + 1);
        assert.equal(r.mana[2], 8 + 2 + 1);
        assert.match(r.log.turns[0].cast[0].notes.join(' '), /The Sixth Doctor copies Mind Stone/);
    });

    it('a step that needs its card after another is out waits for it', () => {
        const r = play(OPEN, plan([3, { kind: 'cast', group: { is: 'historic' }, after: { is: 'named', names: ['The Sixth Doctor'] } }]), {
            battlefield: ['Forest', 'Forest'], hand: ['Mind Stone'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest']
        });
        assert.deepEqual(r.stepTurns, [0]);
        assert.equal(r.reasons[0], Engine.REASON.AFTER);
    });

    it('Susan Foreman taps for {G} from the command zone, and a fetchland finds the dual the hand needs', () => {
        const lib = Engine.buildPlanLibrary(deckOf({ Forest: 10, Island: 10, 'Misty Rainforest': 1, 'Breeding Pool': 1, 'Grizzly Bears': 4, 'Explosive Vegetation': 1 }, ['The Sixth Doctor', 'Susan Foreman']), { format: 'commander' });
        assert.deepEqual(lib.commanders.map(c => c.name), ['The Sixth Doctor', 'Susan Foreman']);
        const r = play(lib, plan([2, cast({ is: 'commander', names: ['Susan Foreman'] })]), {
            hand: ['Misty Rainforest', 'Forest'], library: ['Grizzly Bears', 'Breeding Pool', 'Island', 'Forest', 'Forest']
        });
        assert.deepEqual(r.log.turns[0].lands, ['Misty Rainforest → Breeding Pool (tapped)'], 'nothing to cast on turn 1: no life paid');
        assert.equal(r.life[1], 40 - 1, 'the fetchland’s 1 life only');
        assert.equal(r.log.turns[1].drew, 'Island', 'the fetched land left the library');
        assert.deepEqual(r.stepTurns, [2]);
        assert.equal(r.mana[3], 3 + 1, 'Susan taps for {G} the turn after');
    });
});

// ── Many games ───────────────────────────────────────────────────────────────

const RAMP_DECK = deckOf({
    Forest: 26, Plains: 12, 'Fanatic of Rhonas': 4, 'Priest of Titania': 3, 'Badgermole Cub': 2, 'Bloom Tender': 2, 'Raucous Audience': 2,
    'Whisperer of the Wilds': 2, 'Jadzia Dax, Living Legacy': 1, 'Karametra, God of Harvests': 1, 'Ancestral Statue': 12, 'Serra Angel': 10,
    'Colossal Dreadmaw': 10, 'Grizzly Bears': 12
}, ['Selvala, Eager Trailblazer']);
const RAMP_LIB = Engine.buildPlanLibrary(RAMP_DECK, { format: 'commander' });

describe('simulation', () => {
    const opts = { format: DRAWS, games: 1500 };
    const result = Engine.simulatePlan(RAMP_LIB, WILD_SPLENDOR, opts);

    it('is the same for the same seed and moves with another', () => {
        assert.deepEqual(Engine.simulatePlan(RAMP_LIB, WILD_SPLENDOR, opts).steps, result.steps);
        assert.notDeepEqual(Engine.simulatePlan(RAMP_LIB, WILD_SPLENDOR, { ...opts, seed: 7 }).steps.map(s => s.onTime), result.steps.map(s => s.onTime));
    });

    it('keeps its numbers consistent: on time ≤ within a turn, a funnel that only narrows, every miss explained once', () => {
        assert.equal(result.games, 1500);
        assert.ok(result.onTime > 0 && result.onTime <= result.late && result.late <= 1);
        let reach = 1;
        for (const s of result.steps) {
            assert.ok(s.reach <= reach + 1e-12 && s.onTime <= s.late);
            assert.ok(Math.abs(s.conditional * (reach) - s.reach) < 1e-9, 'conditional × previous reach = reach');
            reach = s.reach;
        }
        assert.ok(Math.abs(result.steps[result.steps.length - 1].reach - result.onTime) < 1e-12);
        const missed = result.reasons.reduce((n, r) => n + r.count, 0);
        assert.equal(missed, Math.round((1 - result.onTime) * result.games));
        assert.ok(result.reasons.every(r => r.step >= 0 && r.step < 4 && r.code > 0));
    });

    it('reports mana as percentiles only, on the plan’s key turn', () => {
        const k = result.keyMana;
        assert.equal(k.turn, 4);
        assert.equal(k.required, 8);
        assert.ok(k.p10 <= k.p25 && k.p25 <= k.p50 && k.p50 <= k.p75 && k.p75 <= k.p90);
        const max = k.hist.reduce((m, n, v) => (n ? v : m), 0);
        assert.ok(k.p90 < max, 'the top quoted number is not the best game');
        assert.equal(k.hist.reduce((a, b) => a + b, 0), result.games);
        assert.ok(Math.abs(k.meets - result.steps[2].onTime) < 0.02, 'eight mana on turn 4 ≈ the mana step');
        assert.equal(result.manaByTurn.length, result.lastTurn);
    });

    it('keeps four sample games with a turn-by-turn log', () => {
        assert.equal(result.samples.length, Engine.SAMPLE_GAMES);
        for (const g of result.samples) {
            assert.equal(g.turns.length, result.lastTurn);
            assert.ok(g.hand.length >= 4 && g.handLands <= g.hand.length);
            assert.equal(g.stepTurns.length, 4);
            assert.equal(typeof g.onTime, 'boolean');
        }
    });

    it('explains a plan the deck can’t start: no mana 2-drop at all', () => {
        const bare = Engine.buildPlanLibrary(deckOf({ Forest: 30, Plains: 10, 'Grizzly Bears': 59 }, ['Selvala, Eager Trailblazer']), { format: 'commander' });
        const r = Engine.simulatePlan(bare, WILD_SPLENDOR, { ...opts, games: 300 });
        assert.equal(r.onTime, 0);
        assert.equal(r.steps[0].onTime, 0);
        assert.deepEqual([r.reasons[0].step, r.reasons[0].code, r.reasons[0].share], [0, Engine.REASON.NO_CARD, 1]);
    });

    it('answers to the keep rule and, in 60 cards, to turn order', () => {
        const lands = Engine.simulatePlan(RAMP_LIB, WILD_SPLENDOR, { ...opts, keep: { kind: 'lands', minLands: 2, maxLands: 4 } });
        assert.ok(lands.mulliganRate < result.mulliganRate, 'needing the first step’s card mulligans more');
        const sixty = Engine.buildPlanLibrary(deckOf({ Forest: 24, 'Fanatic of Rhonas': 8, 'Grizzly Bears': 16, 'Colossal Dreadmaw': 12 }), { format: 'constructed' });
        const p = plan([2, cast({ is: 'mana', mv: [0, 2] })], [4, mana(6)]);
        const onPlay = Engine.simulatePlan(sixty, p, { format: FORMATS.constructed, onPlay: true, games: 800 });
        const onDraw = Engine.simulatePlan(sixty, p, { format: FORMATS.constructed, onPlay: false, games: 800 });
        assert.ok(onDraw.onTime > onPlay.onTime, 'an extra card helps');
        assert.equal(Engine.normalizeKeep({ minLands: 5, maxLands: 1 }).maxLands, 5);
    });

    it('plays a deck of bare counts with mana steps, and gives nothing for fewer than seven cards', () => {
        const counts = Engine.buildPlanCountsLibrary({ lands: 40, creatures: 60 });
        assert.equal(counts.placeholder, true);
        const r = Engine.simulatePlan(counts, GP.starterPlan(counts), { format: DRAWS, games: 200 });
        assert.ok(r.steps[0].onTime > 0.5);
        assert.equal(Engine.simulatePlan(Engine.buildPlanCountsLibrary({ lands: 3 }), WILD_SPLENDOR), null);
    });

    it('plays 1,000 games of the example Commander deck quickly', () => {
        const lib = Engine.buildPlanLibrary(DEFAULT_DECK_DATA, { format: 'commander' });
        const p = GP.starterPlan(lib);
        const ms = medianMs(() => Engine.simulatePlan(lib, p, { format: DRAWS, games: 1000 }), 3);
        assert.ok(ms < budget(250), `${ms.toFixed(0)} ms for 1,000 games`);
    });
});

// ── The page's words ─────────────────────────────────────────────────────────

describe('the model’s words', () => {
    const result = Engine.simulatePlan(RAMP_LIB, WILD_SPLENDOR, { format: DRAWS, games: 1000 });

    it('leads with the plan on time, one turn late and the usual miss', () => {
        const { html, tone } = GP.summarize(result, { deckName: 'Wild <Splendor>' });
        assert.match(html, /^Wild &lt;Splendor&gt; pulls off its plan on time in <strong>\d+%<\/strong> of games, and one turn late in <strong>\d+%<\/strong> more — the usual miss is .+\.$/);
        assert.equal(tone, GP.planTone(result.onTime));
        assert.deepEqual(GP.summarize(null).tone, 'flat');
        assert.match(GP.summarize({ ...result, steps: [] }).html, /Add a step/);
        assert.match(GP.summarize({ ...result, onTime: 1, late: 1, reasons: [] }, {}).html, /^This deck pulls off its plan on time in <strong>100%<\/strong> of games\.$/);
        assert.deepEqual([GP.planTone(0.6), GP.planTone(0.3), GP.planTone(0.1), GP.planTone(NaN)], ['good', 'warn', 'bad', 'flat']);
    });

    it('says why a game missed', () => {
        const text = (step, code, colour = 0) => GP.reasonText({ step, code, colour }, WILD_SPLENDOR);
        assert.equal(text(0, Engine.REASON.NO_CARD), 'no mana 2-drop by turn 2');
        assert.equal(text(1, Engine.REASON.COLOUR, W), 'no way to make {W} for Selvala, Eager Trailblazer on turn 3');
        assert.equal(text(1, Engine.REASON.MANA), 'too little mana for Selvala, Eager Trailblazer on turn 3');
        assert.equal(text(2, Engine.REASON.SHORT), 'less than 8 mana on turn 4');
        assert.equal(text(2, Engine.REASON.LAND), 'a missed land drop by turn 4');
        assert.equal(text(3, Engine.REASON.NO_PACKAGE), 'too few payoffs in hand on turn 4');
        assert.equal(text(3, Engine.REASON.OTHER), 'payoff not cast by turn 4');
        assert.equal(GP.reasonText({ step: 3, code: Engine.REASON.AFTER }, DOCTOR), 'The Sixth Doctor not out by turn 6');
        assert.match(GP.reasonText({ step: 1, code: Engine.REASON.COLOUR, colour: W }, WILD_SPLENDOR, { html: true }), /class="ms ms-w"/);
        assert.equal(GP.reasonText({ step: 9, code: 1 }, WILD_SPLENDOR), '');
        assert.equal(GP.stepTitle(WILD_SPLENDOR.steps[3]), 'Turn 4: cast two 4-drops or one 7–9-drop');
    });

    it('merges reasons with the same words and folds the tail', () => {
        const rows = GP.reasonRows(result, { limit: 3, html: false });
        assert.ok(rows.length <= 3);
        const total = rows.reduce((s, r) => s + r.share, 0);
        assert.ok(Math.abs(total - (1 - result.onTime)) < 1e-9);
        if (rows.length === 3) assert.equal(rows[2].text, 'other reasons');
        assert.deepEqual(GP.reasonRows(null), []);
    });

    it('builds the hero row and the key turn’s table without the sampled maximum', () => {
        const stats = GP.heroStats(result);
        assert.deepEqual(stats.map(s => s.label), ['Plan on time', 'Within one turn', 'Usual miss', 'Mana on turn 4']);
        assert.notEqual(stats[2].sub, 'Other reasons');
        const rows = GP.manaRows(result.keyMana.hist, result.games);
        assert.ok(rows[rows.length - 1].plus, 'the top 1% folds into one "N+" row');
        assert.ok(Math.abs(rows.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
        assert.deepEqual(GP.manaRows([], 0), []);
        assert.deepEqual(GP.heroStats({ steps: [] }), []);
    });
});

describe('starter plans', () => {
    it('builds the example deck’s plan from its cards: Susan, then ramp, the Doctor a turn early, the top end', () => {
        const lib = Engine.buildPlanLibrary(DEFAULT_DECK_DATA, { format: 'commander' });
        const words = GP.starterPlan(lib).steps.map(s => GP.stepTitle(s));
        assert.deepEqual(words, [
            'Turn 2: cast Susan Foreman',
            'Turn 4: cast a ramp spell with MV 4 or less',
            'Turn 5: cast The Sixth Doctor',
            'Turn 7: cast a spell with MV 8+'
        ]);
    });

    it('leads with a mana 2-drop when the deck has six or more, and plans bare counts by mana', () => {
        const words = GP.starterPlan(RAMP_LIB).steps.map(s => GP.stepTitle(s));
        assert.equal(words[0], 'Turn 2: cast a mana 2-drop');
        assert.equal(words[1], 'Turn 3: cast Selvala, Eager Trailblazer');
        const counts = GP.starterPlan(Engine.buildPlanCountsLibrary({ lands: 40, creatures: 60 }));
        assert.deepEqual(counts.steps.map(s => s.require.kind), ['mana', 'mana']);
        assert.equal(GP.starterPlan(null).steps.length, 2);
        const tiny = Engine.buildPlanLibrary(deckOf({ Forest: 7, 'Grizzly Bears': 3 }), { format: 'constructed' });
        assert.deepEqual(GP.starterPlan(tiny).steps, [{ turn: 4, require: { kind: 'mana', atLeast: 4 } }]);
    });
});

describe('presets', () => {
    it('matches a deck by commanders, link or name', () => {
        const list = [
            { id: 'a', commanders: ['Selvala, Eager Trailblazer'] },
            { id: 'b', commanders: ['The Sixth Doctor', 'Susan Foreman'] },
            { id: 'c', deckUrl: 'https://moxfield.com/decks/XYZ/' },
            { id: 'd', deckName: 'Sample green ramp' }
        ];
        assert.equal(GP.matchPreset(list, { commanders: [{ name: 'Susan Foreman' }, { name: 'The Sixth Doctor' }] })?.id, 'b');
        assert.equal(GP.matchPreset(list, { commanders: ['The Sixth Doctor'] }), null, 'every commander must be there');
        assert.equal(GP.matchPreset(list, { importUrl: 'https://moxfield.com/decks/xyz' })?.id, 'c');
        assert.equal(GP.matchPreset(list, { deckName: 'sample green ramp' })?.id, 'd');
        assert.equal(GP.matchPreset(list, {}), null);
        assert.equal(GP.matchPreset(null, null), null);
    });

    it('loads every catalog preset, and each carries a valid plan and its deck', async () => {
        assert.ok(PLAN_PRESETS.length >= 1);
        for (const entry of PLAN_PRESETS) {
            const mod = await entry.load();
            const preset = GP.readPreset(mod);
            assert.ok(preset, `${entry.id} is a valid preset`);
            assert.equal(preset.id, entry.id);
            assert.equal(preset.title, entry.title);
            assert.equal(preset.deckUrl, entry.deckUrl);
            assert.deepEqual(preset.commanders, [...entry.commanders]);
            assert.equal(mod.snapshot.name, entry.deckName);
            assert.deepEqual(GP.normalizePlan(mod.plan), preset.plan, 'the plan is already valid');
            const copies = Object.values(mod.snapshot.cardsByName).reduce((n, c) => n + c.count, 0);
            assert.equal(copies, mod.snapshot.actualCardCount);
            const lib = Engine.buildPlanLibrary(mod.snapshot, { format: mod.snapshot.format });
            const r = Engine.simulatePlan(lib, preset.plan, { format: FORMATS[mod.snapshot.format === 'auto' ? 'commander' : mod.snapshot.format], games: 300 });
            assert.ok(r.onTime > 0.05, `${entry.id}'s plan happens (${r.onTime})`);
            assert.equal(presetEntry(entry.id), entry);
        }
        assert.equal(presetEntry('nope'), null);
        assert.equal(GP.readPreset({ id: 'x', title: 'X', plan: { steps: [] }, snapshot: { cardsByName: {} } }), null, 'a preset needs a plan');
        assert.equal(GP.readPreset({ id: 'x', title: 'X', plan: WILD_SPLENDOR }), null, 'and a deck');
        assert.equal(GP.readPreset(null), null);
    });

    it('says what day each preset was measured, and reads only real calendar dates', async () => {
        for (const entry of PLAN_PRESETS) {
            const preset = GP.readPreset(await entry.load());
            assert.match(GP.longDate(preset.measuredOn), /^\d{1,2} [A-Z][a-z]+ 20\d\d$/, `${entry.id} says when it was measured`);
        }
        assert.equal(GP.longDate('2026-11-21'), '21 November 2026');
        assert.equal(GP.longDate('2027-01-05'), '5 January 2027');
        assert.equal(GP.longDate('2024-02-29'), '29 February 2024', 'a leap day');
        for (const junk of ['2026-02-30', '2026-13-01', '2026-00-10', '21/11/2026', '', null, 20261121]) assert.equal(GP.longDate(junk), '', String(junk));
        const mod = await PLAN_PRESETS[0].load();
        assert.equal(GP.readPreset({ ...mod, measuredOn: 'last week' }).measuredOn, null);
    });

    it('measures how far a deck is from a preset’s list, by name, commanders left out', async () => {
        const doctor = GP.readPreset(await presetEntry('doctor-whostoric').load());
        const own = { ...doctor.snapshot, cardsByName: { ...doctor.snapshot.cardsByName } };
        assert.deepEqual(GP.presetDeckDiff(doctor.snapshot, own), { missing: 0, extra: 0 }, 'its own list');

        // The commanders listed among the cards (some imports do) are still not the library.
        const sixth = doctor.snapshot.commanders[0].card;
        const listed = { ...own, cardsByName: { ...own.cardsByName, [sixth.name]: { ...sixth, count: 1 } } };
        assert.deepEqual(GP.presetDeckDiff(doctor.snapshot, listed), { missing: 0, extra: 0 });

        // One swap, one more copy of a basic, a name typed with a curly apostrophe.
        const names = Object.keys(own.cardsByName);
        const swapped = { ...own.cardsByName };
        delete swapped[names[0]];
        swapped['Llanowar Elves'] = { name: 'Llanowar Elves', count: 1, cmc: 1, type_line: 'Creature — Elf Druid' };
        assert.ok(names.includes('Forest') && names[0] !== 'Forest', 'the list has Forests');
        swapped.Forest = { ...swapped.Forest, count: swapped.Forest.count + 1 };
        const vow = names.find(n => n.includes("Kamahl's"));
        swapped[vow.replace("'", '’')] = { ...swapped[vow], name: vow.replace("'", '’') };
        delete swapped[vow];
        assert.deepEqual(GP.presetDeckDiff(doctor.snapshot, { ...own, cardsByName: swapped }), { missing: 1, extra: 2 });

        // The bundled example deck is an older version of the same deck.
        const old = GP.presetDeckDiff(doctor.snapshot, DEFAULT_DECK_DATA, { format: 'commander' });
        assert.ok(old.missing > 0 && old.missing === old.extra, `a swap of ${old.missing}`);
    });

    it('says which list the notes were measured on, and how far this deck is from it', () => {
        const preset = { deckUrl: 'https://moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg', measuredOn: '2026-11-21' };
        assert.deepEqual(GP.presetSource(preset, { missing: 0, extra: 0 }), {
            text: 'Measured on this list, as it was on Moxfield on 21 November 2026.',
            differs: false
        });
        const lead = 'These numbers were measured on the list that comes with this plan, as it was on Moxfield on 21 November 2026.';
        assert.deepEqual(GP.presetSource(preset, { missing: 16, extra: 16 }), {
            text: `${lead} The answer above is for this deck, which differs from that list by 16 cards.`,
            differs: true
        });
        assert.match(GP.presetSource(preset, { missing: 1, extra: 1 }).text, /by 1 card\.$/);
        assert.match(GP.presetSource(preset, { missing: 0, extra: 2 }).text, /which has 2 cards that list doesn’t\.$/);
        assert.match(GP.presetSource(preset, { missing: 1, extra: 0 }).text, /which lacks 1 of that list’s cards\.$/);
        assert.match(GP.presetSource(preset, { missing: 3, extra: 1 }).text, /which has 1 card that list doesn’t and lacks 3 of that list’s cards\.$/);
        assert.deepEqual(GP.presetSource(preset, null), { text: `${lead} The answer above is for this deck’s card counts.`, differs: true });
        assert.equal(GP.presetSource({ deckUrl: 'https://archidekt.com/decks/123/x' }, { missing: 0, extra: 0 }).text, 'Measured on this list, as it was on Archidekt.');
        assert.equal(GP.presetSource({ deckUrl: 'https://example.com/d', measuredOn: '2026-11-21' }, { missing: 0, extra: 0 }).text, 'Measured on this list, as it was on 21 November 2026.');
        assert.equal(GP.presetSource(null, { missing: 0, extra: 0 }).text, 'Measured on this list.');
    });
});
