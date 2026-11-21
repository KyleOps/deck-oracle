/**
 * The two Game Plan presets, card by card: every board-dependent card in
 * Wild Splendor (Selvala, Eager Trailblazer) and Doctor Whostoric (The Sixth
 * Doctor + Susan Foreman) on an exact scripted game, and the 25 checkpoints a
 * card analyst computed by hand from the Oracle text and rulings.
 *
 * The checkpoints are on the play (no draw on turn 1), no mulligan. "avail"
 * is the mana you could make in your first main phase after the land drop,
 * before casting anything; "mana" is everything made that turn (spent plus
 * what was left). Each scripted library is the listed draws, a few spells
 * that change nothing, then the rest of the deck — what searches find.
 * Where the engine plays a land in another order than the analyst, the
 * comment says why its line is at least as good.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as Engine from '../../js/utils/planEngine.js';
import * as Rules from '../../js/utils/planRules.js';
import * as GP from '../../js/utils/models/plan.js';
import * as Splendor from '../../js/data/plans/wild-splendor.js';
import * as Doctor from '../../js/data/plans/doctor-whostoric.js';

const WS = Engine.buildPlanLibrary(Splendor.snapshot, { format: 'commander' });
const DW = Engine.buildPlanLibrary(Doctor.snapshot, { format: 'commander' });
/** Spells that change nothing in the turns a checkpoint plays (sorceries and big cards: never cast, never a land). */
const WS_FILL = ['Season of Gathering', 'Lurking Predators', 'Selvala\'s Stampede', 'Genesis Storm', 'Branching Timeline', 'Planetarium of Wan Shi Tong',
    'Ezuri\'s Predation', 'Last March of the Ents', 'Overwhelming Splendor', 'Return to the Light Realms'];
const DW_FILL = ['Expropriate', 'Blatant Thievery', 'Mind\'s Dilation', 'Omniscience', 'Aminatou\'s Augury', 'Extract Power',
    'Abstract Performance', 'One with the Multiverse', 'Portent of Calamity', 'Genesis Storm'];
const SPEND = 2;     // Wild Splendor's step 3: spend 8+ on spells with MV 4+
const LITERAL = 3;   // its information step: two 4-drops or one 7–9-drop
const RAMP = 1;      // Doctor Whostoric's step 2: ramp to 6+ for turn 4
const DOCTOR = 2;
const COPY = 3;
const BY_T5 = 4;     // information: the Doctor by turn 5

/** The rest of a deck after the cards a scenario names. */
function rest(lib, used) {
    const left = new Map();
    for (const c of lib.cards) left.set(c.name, (left.get(c.name) ?? 0) + 1);
    for (const n of used) {
        const card = Engine.findPlanCard(lib, n);
        assert.ok(card, `in the deck: ${n}`);
        left.set(card.name, left.get(card.name) - 1);
        assert.ok(left.get(card.name) >= 0, `too many ${n}`);
    }
    return [...left].flatMap(([n, k]) => Array(Math.max(0, k)).fill(n));
}

/** A checkpoint: the hand, the draws in order, then four fillers and the rest of the deck. */
function checkpoint(lib, plan, hand, draws, turns) {
    const named = new Set([...hand, ...draws].map(n => Engine.findPlanCard(lib, n)?.name));
    const fill = (lib === WS ? WS_FILL : DW_FILL).filter(n => !named.has(n)).slice(0, 4);
    const r = Engine.playScriptedPlanGame(lib, plan, { hand, library: [...draws, ...fill, ...rest(lib, [...hand, ...draws, ...fill])], turns });
    return { ...r, fill };
}

const casts = (r, turn) => r.log.turns[turn - 1].cast.map(c => c.name);
const paid = (r, turn) => r.log.turns[turn - 1].cast.map(c => c.paid);
const plan = (...steps) => ({ steps: steps.map(([turn, require]) => ({ turn, require })) });
const named = (...names) => ({ kind: 'cast', group: { is: 'named', names } });
const mana = atLeast => ({ kind: 'mana', atLeast });
const play = (lib, p, opts) => Engine.playScriptedPlanGame(lib, p, opts);
const on = (r, name) => r.board.filter(p => p.name === name);

// ── Wild Splendor: the 13 checkpoints ────────────────────────────────────────

describe('Wild Splendor checkpoints (hand-computed)', () => {
    const ws = (hand, draws) => checkpoint(WS, Splendor.plan, hand, draws, 4);

    it('WS-1 Fanatic of Rhonas: 10 on turn 4; Damage Control Crew first makes it 11', () => {
        const r = ws(['Temple Garden', 'Forest', 'Plains', 'Fanatic of Rhonas', 'Apex Devastator', 'Thorn Mammoth', 'Damage Control Crew'],
            ['Plains', 'Elesh Norn, Grand Cenobite', 'Highcliff Felidar']);
        assert.deepEqual(r.avail.slice(1), [0, 2, 4, 10]);
        assert.equal(r.log.turns[0].lands[0], 'Temple Garden (tapped)', 'nothing to cast on turn 1: no life paid');
        assert.deepEqual(r.stepTurns.slice(0, 3), [2, 3, 4]);
        // The sequenced line beats Apex Devastator's 10: the Crew's power 3 and a Mercenary lift Selvala to 3.
        assert.deepEqual(casts(r, 4).sort(), ['Damage Control Crew', 'Thorn Mammoth']);
        assert.equal(r.stepValues[SPEND], 11);
        assert.equal(r.life.at(-1), 40);
    });

    it('WS-2 Whisperer of the Wilds: power 0 is a power — 8 raw, 10 spent after the Crew', () => {
        const r = ws(['Plains', 'Plains', 'Savannah', 'Whisperer of the Wilds', 'Captain Marvel, Shooting Star', 'Damage Control Crew', 'Icetill Explorer'],
            ['Ohran Frostfang', 'Plains', 'Lurking Predators']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 8]);
        assert.equal(r.stepTurns[SPEND], 4);
        // The analyst's line spends 8 (Crew + Icetill); the engine finds Crew + Lurking Predators, 10.
        assert.equal(casts(r, 4)[0], 'Damage Control Crew', 'the creature first, before Selvala taps');
        assert.equal(r.stepValues[SPEND], 10);
    });

    it('WS-3 Badgermole Cub: earthbends the Plains, 9 on turn 4 — a 7-drop is short of 8', () => {
        const r = ws(['Plains', 'Forest', 'Plains', 'Badgermole Cub', 'Elesh Norn, Grand Cenobite', 'Karametra, God of Harvests', 'Lurking Predators'],
            ['Kodama of the East Tree', 'Season of Gathering', 'Plains']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 9]);
        const land = r.board.find(p => p.animated);
        assert.deepEqual([land.name, land.counters], ['Plains', 1], 'a 1/1 (3/3 once Elesh Norn is out)');
        assert.deepEqual(casts(r, 4), ['Elesh Norn, Grand Cenobite']);
        assert.equal(r.stepTurns[SPEND], 0, '7 mana of threats: under the 8+ rule');
        assert.equal(r.stepTurns[LITERAL], 4, 'the literal "one 7–9-drop" happens');
    });

    it('WS-4 The Mind Stone: 6 raw on turn 4; two 4-drops only by sequencing, Arid Mesa again from the graveyard', () => {
        const r = ws(['Plains', 'Plains', 'Forest', 'The Mind Stone', 'Damage Control Crew', 'Icetill Explorer', 'Ori, Plate Stacker'],
            ['Arid Mesa', 'Vaultborn Tyrant', 'Season of Gathering']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 6]);
        assert.deepEqual(casts(r, 4), ['Damage Control Crew', 'Icetill Explorer']);
        assert.equal(r.stepTurns[SPEND], 4);
        assert.equal(r.stepTurns[LITERAL], 4, 'two 4-drops');
        assert.match(r.log.turns[3].lands.join(' '), /from the graveyard: Arid Mesa/);
        assert.equal(r.life.at(-1), 38, 'two cracks of the same fetchland');
    });

    it('WS-5 Jadzia Dax: {G} then {G}{G} at main phase; Restoration Seminar has no target', () => {
        const r = ws(['Plains', 'Forest', 'Savannah', 'Plains', 'Jadzia Dax, Living Legacy', 'Highcliff Felidar', 'The Earth King'],
            ['Avacyn, Angel of Hope', 'Restoration Seminar', 'Cityscape Leveler']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 8]);
        assert.equal(on(r, 'Jadzia Dax, Living Legacy')[0].power, 2, 'power 0 → 1 → 2');
        assert.equal(r.stepTurns[SPEND], 4);
        assert.ok(!casts(r, 4).includes('Restoration Seminar'));
        assert.ok(r.hand.includes('Restoration Seminar'));
    });

    it('WS-6 Priest of Titania counts Selvala; 8 on turn 4', () => {
        const r = ws(['Plains', 'Forest', 'Command Tower', 'Priest of Titania', 'Bloom Tender', 'Avacyn, Angel of Hope', 'Through the Forest Gate'],
            ['Ohran Frostfang', 'Wooded Foothills', 'Elesh Norn, Grand Cenobite']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 8]);
        assert.deepEqual(casts(r, 2), ['Priest of Titania']);
        assert.equal(r.stepTurns[SPEND], 4);
        assert.equal(r.life.at(-1), 39, 'Wooded Foothills');
    });

    it('WS-7 Bloom Tender: 1 on turn 3, 2 with Selvala, 3 after a red Mercenary — two 4-drops or better', () => {
        const r = ws(['Plains', 'Forest', 'Savannah', 'Plains', 'Bloom Tender', 'Damage Control Crew', 'Torsten, Founder of Benalia'],
            ['Genesis Storm', 'Captain Kathryn Janeway', 'Lumra, Bellow of the Woods']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 8]);
        assert.equal(casts(r, 4)[0], 'Damage Control Crew');
        assert.equal(r.stepTurns[SPEND], 4);
        assert.ok(r.stepValues[SPEND] >= 8);
    });

    it('WS-8 no 2-drop: the plan fails at its first step; Selvala comes on turn 4', () => {
        const r = ws(['Temple Garden', 'Forest', 'Savannah', 'Plains', 'Elesh Norn, Grand Cenobite', 'Thorn Mammoth', 'Damage Control Crew'],
            ['Ohran Frostfang', 'Highcliff Felidar', 'Plains']);
        assert.deepEqual(r.avail.slice(1), [0, 2, 3, 4]);
        assert.deepEqual(r.stepTurns.slice(0, 3), [0, 4, 0]);
        assert.equal(r.reasons[0], Engine.REASON.NO_CARD);
        assert.deepEqual(casts(r, 4), ['Selvala, Eager Trailblazer'], 'the late commander first; threats held');
    });

    it('WS-9 no white source: Selvala is uncastable (analyst 1/2/4/4; the engine 0/2/3/5)', () => {
        const r = ws(['Forest', 'Boseiju, Who Endures', 'Shifting Woodland', 'Fanatic of Rhonas', 'Dawnglade Regent', 'Vaultborn Tyrant', 'Lumra, Bellow of the Woods'],
            ['Thorn Mammoth', 'Evendo, Waking Haven', 'Planetarium of Wan Shi Tong']);
        // The engine plays Shifting Woodland tapped on turn 1 and Evendo (tapped) on turn 3, when
        // nothing can be cast either way: one more mana on turn 4 than the analyst's order.
        assert.deepEqual(r.avail.slice(1), [0, 2, 3, 5]);
        assert.deepEqual(r.stepTurns.slice(0, 2), [2, 0]);
        assert.equal(r.reasons[1], Engine.REASON.COLOUR | (Rules.W << 8));
    });

    it('WS-10 a tapped land on turn 1 and turn 4, untapped on 2 and 3: 9 on turn 4', () => {
        const r = ws(['Lush Portico', 'Mistveil Plains', 'Forest', 'Fanatic of Rhonas', 'Elesh Norn, Grand Cenobite', 'Archon of Valor\'s Reach', 'Avacyn, Angel of Hope'],
            ['Damage Control Crew', 'Plains', 'Ori, Plate Stacker']);
        assert.deepEqual(r.avail.slice(1), [0, 2, 4, 9]);
        assert.deepEqual(r.log.turns.map(e => e.lands[0]), ['Lush Portico (tapped)', 'Forest', 'Plains', 'Mistveil Plains (tapped)']);
        assert.equal(r.stepTurns[SPEND], 4);
    });

    it('WS-11 fetchlands find the Forest Plains duals (analyst 1/2/4/8; the engine 0/2/4/8)', () => {
        const r = ws(['Flooded Strand', 'Marsh Flats', 'Plains', 'Ilysian Caryatid', 'Serra\'s Emissary', 'Kodama of the East Tree', 'Genesis Wave'],
            ['Torsten, Founder of Benalia', 'Windswept Heath', 'Through the Forest Gate']);
        // Turn 1's crack takes Canopy Vista tapped (nothing to cast) and keeps Savannah for turn 2.
        assert.deepEqual(r.avail.slice(1), [0, 2, 4, 8]);
        assert.match(r.log.turns[0].lands[0], /^Flooded Strand → (Canopy Vista|Lush Portico) \(tapped\)$/);
        assert.equal(r.life.at(-1), 37, 'three fetchlands, no shock paid');
        assert.equal(r.stepTurns[SPEND], 4);
    });

    it('WS-12 Yavimaya makes the Plains tap for {G}; Witch Enchanter then Janeway', () => {
        const r = ws(['Plains', 'Plains', 'Yavimaya, Cradle of Growth', 'Raucous Audience', 'Dawnglade Regent', 'Witch Enchanter // Witch-Blessed Meadow', 'Captain Kathryn Janeway'],
            ['Highcliff Felidar', 'Plains', 'Curious Colossus']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 8]);
        assert.deepEqual(casts(r, 4), ['Witch Enchanter // Witch-Blessed Meadow', 'Captain Kathryn Janeway']);
        assert.deepEqual([r.stepTurns[SPEND], r.stepTurns[LITERAL]], [4, 4]);
    });

    it('WS-13 The Great Henge costs 5 with Selvala and taps at once: 7 left for Thorn Mammoth', () => {
        const r = ws(['Plains', 'Forest', 'Savannah', 'Fanatic of Rhonas', 'The Great Henge', 'Icetill Explorer', 'Thorn Mammoth'],
            ['Plains', 'Lumra, Bellow of the Woods', 'Ori, Plate Stacker']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 10]);
        assert.deepEqual(casts(r, 4), ['The Great Henge', 'Thorn Mammoth']);
        assert.deepEqual(paid(r, 4), [5, 7]);
        assert.equal(on(r, 'Thorn Mammoth')[0].counters, 1, 'the Henge’s +1/+1 counter');
        assert.equal(r.stepValues[SPEND], 12);
    });
});

// ── Doctor Whostoric: the 12 checkpoints ─────────────────────────────────────

describe('Doctor Whostoric checkpoints (hand-computed)', () => {
    const dw = (hand, draws, turns = 5) => checkpoint(DW, Doctor.plan, hand, draws, turns);

    it('DW-1 Skyshroud Claim: two untapped Forest cards; the Doctor on 4, Ugin copied on 5', () => {
        const r = dw(['Forest', 'Island', 'Forest', 'Skyshroud Claim', 'Ugin, the Spirit Dragon', 'Karn Liberated', 'Leader, Super-Genius'],
            ['Forest', 'Koma, Cosmos Serpent', 'Island', 'Nezahal, Primal Tide']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 7, 8]);
        assert.deepEqual(r.stepTurns, [2, 3, 4, 5, 4]);
        assert.match(r.log.turns[2].cast[0].notes.join(' '), /Tropical Island/);
        // The analyst pays 2 for Breeding Pool (+2 that turn); with nothing to spend it on the engine doesn't (+1).
        assert.equal(r.mana[3], 5);
        assert.deepEqual(casts(r, 5), ['Ugin, the Spirit Dragon']);
        assert.equal(r.stepValues[COPY], 8);
        assert.equal(on(r, 'Ugin, the Spirit Dragon').length, 2, 'the copy is a token Ugin');
    });

    it('DW-2 Explosive Vegetation; Hedge Maze waits for turn 4, when the Doctor fits anyway', () => {
        const r = dw(['Forest', 'Forest', 'Island', 'Explosive Vegetation', 'Koma, Cosmos Serpent', 'Nezahal, Primal Tide', 'Mind\'s Dilation'],
            ['Hedge Maze', 'Abstract Performance', 'Forest', 'Expropriate']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 6, 8]);
        assert.equal(r.log.turns[3].lands[0], 'Hedge Maze (tapped)');
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 3, 4, 5]);
    });

    it('DW-3 Arixmethes taps for {G}{U} from the next turn; Mosswort Bridge’s hideaway moves the top four', () => {
        const r = dw(['Breeding Pool', 'Forest', 'Island', 'Arixmethes, Slumbering Isle', 'Kogla, the Titan Ape', 'Karn Liberated', 'Tishana, Voice of Thunder'],
            ['Mosswort Bridge', 'Expropriate', 'Forest', 'Omniscience']);
        assert.deepEqual(r.avail.slice(1), [0, 2, 4, 6, 8]);
        assert.equal(r.log.turns[0].lands[0], 'Breeding Pool (tapped)');
        assert.equal(r.log.turns[4].drew, r.fill[3], 'the four cards after the turn-4 draw went to the bottom or exile');
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 3, 4, 5]);
        assert.equal(on(r, 'Arixmethes, Slumbering Isle')[0].creature, false);
    });

    it('DW-4 Crystal Skull needs {U}{U}; Ugin, Eye of the Storms copied gives 6 back', () => {
        const r = dw(['Island', 'Forest', 'Island', 'Crystal Skull, Isu Spyglass', 'Ugin, Eye of the Storms', 'Gandalf, Shadow\'s Foe', 'Bonny Pall, Clearcutter'],
            ['Forest', 'Imoti, Celebrant of Bounty', 'Forest', 'Omniscience']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 6, 7]);
        assert.deepEqual(casts(r, 5), ['Ugin, Eye of the Storms'], 'the copy that makes mana wins a tie with Gandalf');
        assert.equal(r.mana[5], 7 + 6);
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 3, 4, 5]);
    });

    it('DW-5 Omenpath Journey: a land at each end step; Sea Gate stays tapped when its mana isn’t needed', () => {
        const r = dw(['Forest', 'Forest', 'Island', 'Omenpath Journey', 'Prime Speaker Zegana', 'Nissa, Ascended Animist', 'Aesi, Tyrant of Gyre Strait'],
            ['Leader, Super-Genius', 'Island', 'Sea Gate Restoration // Sea Gate, Reborn', 'Blatant Thievery']);
        // The analyst's 8 pays 3 life for Sea Gate; 7 casts the same spells, so the engine keeps the life.
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 6, 7]);
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 3, 4, 5]);
        assert.equal(r.life.at(-1), 40);
    });

    it('DW-6 late ramp: Map the Frontier on 4, the Doctor on 5, Groundchuck & Dirtbag copied on 6', () => {
        const r = dw(['Forest', 'Island', 'Forest', 'Leader, Super-Genius', 'The Theorist, Jace Beleren', 'Staff of Eden, Vault\'s Key', 'Kogla, the Titan Ape'],
            ['Abstract Performance', 'Island', 'Map the Frontier', 'Forest', 'Groundchuck & Dirtbag'], 6);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 5, 8, 8]);
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 4, 5, 6]);
        assert.deepEqual(casts(r, 6), ['Groundchuck & Dirtbag'], 'the copy that doubles land mana');
    });

    it('DW-7 no ramp: the Doctor on 5 off five land drops, the copy on 6', () => {
        const r = dw(['Forest', 'Island', 'Forest', 'Island', 'Forest', 'Karn Liberated', 'Nezahal, Primal Tide'],
            ['Tishana, Voice of Thunder', 'Blatant Thievery', 'Expropriate', 'Koma, Cosmos Serpent', 'Island'], 6);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 5, 6, 7]);
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 4, 5, 6], 'ramp to 6 is met by land drops a turn late');
        assert.equal(r.reasons[RAMP], Engine.REASON.NO_CARD);
    });

    it('DW-8 no {G} on turn 2: Susan on 3, Skyshroud Claim on 4, the Doctor on 5', () => {
        const r = dw(['Island', 'Island', 'Explosive Vegetation', 'Skyshroud Claim', 'Koma, Cosmos Serpent', 'Karn Liberated', 'Ugin, the Spirit Dragon'],
            ['Sunken Palace', 'Forest', 'Forest', 'Expropriate'], 6);
        assert.deepEqual(r.avail.slice(1), [1, 1, 3, 5, 8, 8]);
        assert.equal(r.log.turns[1].lands[0], 'Sunken Palace (tapped)');
        assert.deepEqual(casts(r, 4), ['Skyshroud Claim'], 'the untapped ramp first');
        assert.deepEqual(r.stepTurns.slice(0, 4), [3, 4, 5, 6]);
    });

    it('DW-9 Reach the Horizon takes a Forest and an Island, never two Forests', () => {
        const r = dw(['Forest', 'Forest', 'Forest', 'Reach the Horizon', 'Koma, Cosmos Serpent', 'Beorn the Fierce', 'Ugin, the Spirit Dragon'],
            ['Forest', 'Nezahal, Primal Tide', 'Island', 'Leader, Super-Genius']);
        assert.deepEqual(r.avail.slice(1), [1, 2, 4, 7, 8]);
        assert.deepEqual(r.log.turns[2].cast[0].notes.slice().sort(), ['Forest (tapped)', 'Island (tapped)']);
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 3, 4, 5]);
        assert.deepEqual(casts(r, 5), ['Ugin, the Spirit Dragon']);
    });

    it('DW-10 two tapped lands delay the ramp to turn 4 and the Doctor to 5', () => {
        const r = dw(['Hedge Maze', 'Sunken Palace', 'Forest', 'Ranger\'s Path', 'Karn Liberated', 'Nezahal, Primal Tide', 'Kogla, the Titan Ape'],
            ['Tishana, Voice of Thunder', 'Koma, Cosmos Serpent', 'Island', 'Forest'], 6);
        assert.deepEqual(r.avail.slice(1, 6), [0, 2, 3, 5, 8]);
        assert.deepEqual(r.stepTurns.slice(0, 4), [2, 4, 5, 6]);
    });

    it('DW-11 Kamahl’s Druidic Vow copied at X=6: six lands and three legends, untapped', () => {
        const r = play(DW, plan([1, { kind: 'cast', group: { is: 'historic' }, paid: 4, copied: true }]), {
            battlefield: ['The Sixth Doctor', 'Susan Foreman', 'Forest', 'Forest', 'Forest', 'Island', 'Island', 'Island', 'Forest'],
            hand: ['Kamahl\'s Druidic Vow'],
            library: ['Forest', 'Kogla, the Titan Ape', 'Island', 'Expropriate', 'Leader, Super-Genius', 'Tropical Island',
                'Forest', 'Apex Devastator', 'Mindslaver', 'Island', 'Blatant Thievery', 'Breeding Pool', ...DW_FILL],
            turns: 1
        });
        const cast = r.log.turns[0].cast[0];
        assert.deepEqual([cast.name, cast.x, cast.paid], ['Kamahl\'s Druidic Vow', 6, 8]);
        assert.equal(r.stepTurns[0], 1);
        // The copy resolves first: the top six, then the original's six.
        assert.match(cast.notes[0], /^X=6: Forest, Kogla, the Titan Ape, Island, Leader, Super-Genius, Tropical Island$/);
        assert.match(cast.notes[2], /^X=6: Forest, Mindslaver, Island, Breeding Pool$/);
        const lands = r.board.filter(p => ['Forest', 'Island', 'Tropical Island', 'Breeding Pool'].includes(p.name)).length;
        assert.equal(lands, 7 + 6);
        assert.deepEqual(r.graveyard.slice().sort(), ['Apex Devastator', 'Blatant Thievery', 'Expropriate', 'Kamahl\'s Druidic Vow']);
        for (const legend of ['Kogla, the Titan Ape', 'Leader, Super-Genius', 'Mindslaver']) assert.equal(on(r, legend).length, 1, legend);
    });

    it('DW-12 U.S.S. Voyager reveals until two lands (tapped); copied, two more', () => {
        const t3 = checkpoint(DW, Doctor.plan, ['Forest', 'Island', 'Forest', 'U.S.S. Voyager, Lone Wanderer', 'Karn Liberated', 'Nezahal, Primal Tide', 'Kogla, the Titan Ape'],
            ['Forest', 'Tishana, Voice of Thunder', 'Ugin, the Spirit Dragon', 'Island', 'Koma, Cosmos Serpent', 'Forest', 'Leader, Super-Genius'], 4);
        assert.match(t3.log.turns[2].cast[0].notes[0], /Voyager, Lone Wanderer: Island, Forest \(tapped\)$/);
        assert.equal(t3.avail[4], 7);
        assert.deepEqual(t3.stepTurns.slice(0, 3), [2, 3, 4]);
        const copied = play(DW, plan([1, { kind: 'cast', group: { is: 'historic' }, paid: 4, copied: true }]), {
            battlefield: ['The Sixth Doctor', 'Susan Foreman', 'Forest', 'Forest', 'Island', 'Island'],
            hand: ['U.S.S. Voyager, Lone Wanderer'],
            library: ['Ugin, the Spirit Dragon', 'Island', 'Koma, Cosmos Serpent', 'Forest', 'Kogla, the Titan Ape', 'Forest', 'Island', ...DW_FILL],
            turns: 1
        });
        assert.equal(on(copied, 'U.S.S. Voyager, Lone Wanderer').length, 2);
        assert.equal(copied.board.filter(p => p.name === 'Forest' || p.name === 'Island').length, 4 + 4);
    });
});

// ── Every other card rule the presets rely on ────────────────────────────────

describe('preset card rules', () => {
    it('reads the presets’ lands: battle lands, verges, shocks, colourless lands, Yavimaya, hideaway', () => {
        const r = play(WS, plan([1, mana(1)]), { hand: ['Ba Sing Se', 'Canopy Vista', 'Plains', 'Shifting Woodland', 'Plains'], library: WS_FILL, turns: 5 });
        assert.deepEqual(r.log.turns.map(e => e.lands[0]), ['Canopy Vista (tapped)', 'Ba Sing Se (tapped)', 'Plains', 'Shifting Woodland', 'Plains'],
            'no basics yet: Canopy Vista and Ba Sing Se tapped; Canopy Vista is a Forest for Shifting Woodland');
        const verge = play(DW, plan([1, mana(1)]), { battlefield: ['Willowrush Verge'], hand: [], library: DW_FILL, turns: 1 });
        assert.equal(verge.hand.length, 0);
        assert.deepEqual(verge.stepTurns, [1]);
        assert.equal(Engine.findPlanCard(DW, 'Willowrush Verge').mask, Rules.U, '{G} only with a Forest or an Island');
        const susan = play(DW, plan([1, { kind: 'cast', group: { is: 'commander', names: ['Susan Foreman'] } }]), { battlefield: ['Willowrush Verge', 'Island'], library: DW_FILL, turns: 1 });
        assert.deepEqual(susan.stepTurns, [1], 'an Island turns the Verge’s {G} on');
        const colourless = play(WS, plan([3, { kind: 'cast', group: { is: 'mana', mv: [0, 2] } }]), {
            hand: ['Talon Gates of Madara', 'Lazotep Quarry', 'Urza\'s Cave', 'Fanatic of Rhonas'], library: WS_FILL, turns: 3 });
        assert.deepEqual(colourless.avail.slice(1), [1, 2, 3], 'Urza’s Cave is no free fetchland');
        assert.deepEqual(colourless.stepTurns, [0], 'no {G}');
        const yavimaya = play(WS, plan([2, { kind: 'cast', group: { is: 'mana', mv: [0, 2] } }]), {
            hand: ['Plains', 'Yavimaya, Cradle of Growth', 'Fanatic of Rhonas', 'Urza\'s Cave'], library: WS_FILL, turns: 3 });
        assert.deepEqual(yavimaya.stepTurns, [2]);
        assert.deepEqual(casts(yavimaya, 3), ['Selvala, Eager Trailblazer'], 'every land is a Forest: Urza’s Cave pays {G}');
        const hide = play(WS, plan([1, mana(1)]), { hand: ['Mosswort Bridge'], library: ['Avacyn, Angel of Hope', 'Ori, Plate Stacker', 'Thorn Mammoth', 'Elesh Norn, Grand Cenobite', 'Plains', 'Forest'], turns: 2 });
        assert.equal(hide.log.turns[1].drew, 'Plains');
        assert.match(hide.log.turns[0].notes[0], /hideaway: Avacyn, Angel of Hope exiled, 3 to the bottom/);
    });

    it('plays modal double-faced cards: land-only faces as lands, the others only to save a land drop', () => {
        const garden = Engine.findPlanCard(WS, 'Disciple of Freyalise');
        assert.deepEqual([garden.land, garden.mdfc, garden.mask], [true, true, Rules.G]);
        assert.ok(Engine.findPlanCard(DW, 'Sea Gate Restoration').land && Engine.findPlanCard(DW, 'Sink into Stupor').land);
        const witch = play(WS, plan([3, { kind: 'cast', group: { is: 'commander' } }]), {
            hand: ['Forest', 'Plains', 'Witch Enchanter // Witch-Blessed Meadow', 'Fanatic of Rhonas'], library: ['Thorn Mammoth', 'Ori, Plate Stacker', ...WS_FILL], turns: 3 });
        assert.equal(witch.log.turns[2].lands[0], 'Witch Enchanter as Witch-Blessed Meadow');
        assert.deepEqual([witch.stepTurns[0], witch.life.at(-1)], [3, 37], 'paid 3 life: Selvala on turn 3');
        const tangled = play(WS, plan([2, { kind: 'cast', group: { is: 'mana', mv: [0, 2] } }]), {
            hand: ['Forest', 'Plains', 'Tangled Florahedron // Tangled Vale', 'Fanatic of Rhonas'], library: ['Thorn Mammoth', 'Ori, Plate Stacker', 'Avacyn, Angel of Hope', ...WS_FILL], turns: 3 });
        assert.deepEqual(casts(tangled, 2), ['Fanatic of Rhonas'], 'the better dork first');
        assert.equal(tangled.log.turns[2].lands[0], 'Tangled Florahedron as Tangled Vale (tapped)');
    });

    it('Doctor Whostoric’s ramp: Skyshroud Claim untapped, Omenpath Journey at each end step, Arixmethes a land', () => {
        const claim = play(DW, plan([1, mana(1)]), { battlefield: ['Forest', 'Forest', 'Island', 'Island'], hand: ['Skyshroud Claim', 'Leader, Super-Genius'], library: [...DW_FILL, 'Forest', 'Tropical Island', 'Breeding Pool', 'Hedge Maze'], turns: 1 });
        assert.deepEqual(casts(claim, 1), ['Skyshroud Claim', 'Susan Foreman'], 'two untapped lands pay for Susan at once');
        const omen = play(DW, plan([1, mana(1)]), { battlefield: ['Forest', 'Forest', 'Island', 'Island'], hand: ['Omenpath Journey'], library: [...DW_FILL, 'Tropical Island', 'Breeding Pool', 'Command Tower', 'Yavimaya, Cradle of Growth', 'Boseiju, Who Endures', 'Forest', 'Island'], turns: 3 });
        assert.match(omen.log.turns[0].cast[0].notes[0], /exiles Tropical Island, Breeding Pool, Command Tower, Yavimaya, Cradle of Growth, Boseiju, Who Endures/);
        assert.deepEqual(omen.avail.slice(1), [4, 5, 7], 'one land at each of your end steps, tapped');
        const arix = play(DW, plan([1, mana(1)]), { battlefield: ['Forest', 'Island', 'Forest'], hand: ['Arixmethes, Slumbering Isle', 'Forest'], library: DW_FILL, turns: 2 });
        assert.deepEqual(arix.avail.slice(1), [4, 6]);
        const vow = play(DW, plan([1, mana(1)]), { battlefield: ['Forest', 'Forest', 'Forest', 'Forest'], hand: ['Kamahl\'s Druidic Vow'], library: ['Forest', 'Island', ...DW_FILL], turns: 1 });
        assert.ok(vow.hand.includes('Kamahl\'s Druidic Vow'), 'a legendary sorcery needs a legend: Susan comes first, then 2 mana is X=0');
        const skull = play(DW, plan([1, mana(1)]), { battlefield: ['Island', 'Island', 'Forest', 'Forest', 'Crystal Skull, Isu Spyglass'], library: ['Yavimaya, Cradle of Growth', ...DW_FILL], turns: 1 });
        assert.equal(skull.log.turns[0].lands[0], 'from the top: Yavimaya, Cradle of Growth', 'Crystal Skull: a historic land from the top');
    });

    it('copies, cost reductions and land doublers', () => {
        const ugin = play(DW, plan([1, { kind: 'cast', group: { is: 'historic' }, paid: 4, copied: true }]), {
            battlefield: ['The Sixth Doctor', 'Forest', 'Forest', 'Forest', 'Island', 'Island', 'Island', 'Forest'], hand: ['Ugin, Eye of the Storms', 'Karn Liberated'], library: DW_FILL, turns: 1 });
        assert.deepEqual([ugin.avail[1], ugin.mana[1]], [7, 13], 'each Ugin’s 0: {C}{C}{C}');
        const ineffable = play(DW, plan([1, named('Karn Liberated')]), { battlefield: ['Ugin, the Ineffable', 'Forest', 'Forest', 'Forest', 'Island', 'Island'], hand: ['Karn Liberated'], library: DW_FILL, turns: 1 });
        assert.deepEqual([ineffable.stepTurns[0], paid(ineffable, 1)[0]], [1, 5], 'colourless spells cost {2} less');
        const doublers = play(DW, plan([1, mana(1)]), { battlefield: ['Groundchuck & Dirtbag', 'Vorinclex, Voice of Hunger', 'Forest', 'Island', 'Tropical Island'], library: DW_FILL, turns: 1 });
        assert.equal(doublers.avail[1], 9, 'each land: its mana, one more of its type, and {G}');
        const resurgent = play(WS, plan([1, mana(1)]), { battlefield: ['Forest', 'Plains', 'Savannah', 'Zendikar Resurgent', 'Fanatic of Rhonas'], library: WS_FILL, turns: 1 });
        assert.equal(resurgent.avail[1], 3 * 2 + 1);
        const aesi = play(DW, plan([1, { kind: 'cast', group: { is: 'historic' }, paid: 4, copied: true }]), {
            battlefield: ['The Sixth Doctor', 'Forest', 'Forest', 'Forest', 'Island', 'Island', 'Island'], hand: ['Aesi, Tyrant of Gyre Strait', 'Forest', 'Island', 'Forest', 'Island'], library: DW_FILL, turns: 1 });
        assert.equal(aesi.log.turns[0].lands.length, 3, 'a copied Aesi: two more land drops');
        const henge = play(WS, plan([1, named('The Great Henge')]), { battlefield: ['Forest', 'Forest', 'Plains', 'Plains', 'Savannah', 'Selvala, Eager Trailblazer'], hand: ['The Great Henge'], library: WS_FILL, turns: 1 });
        assert.deepEqual([paid(henge, 1)[0], henge.mana[1]], [5, 6 + 2], '{7}{G}{G} less Selvala’s 4, then {G}{G} at once');
    });

    it('extra land drops: Icetill Explorer from the graveyard, Captain Janeway’s explore', () => {
        const icetill = play(WS, plan([1, named('Icetill Explorer')]), { battlefield: ['Forest', 'Forest', 'Plains', 'Plains'], hand: ['Icetill Explorer', 'Arid Mesa'], library: [...WS_FILL, 'Plains', 'Savannah'], turns: 1 });
        assert.deepEqual(icetill.log.turns[0].lands, ['Arid Mesa → Savannah', 'from the graveyard: Arid Mesa → Plains']);
        assert.equal(icetill.life[1], 38);
        assert.ok(icetill.graveyard.includes(WS_FILL[0]), 'landfall: mill one');
        const janeway = play(WS, plan([1, named('Captain Kathryn Janeway')]), { battlefield: ['Forest', 'Forest', 'Plains', 'Plains'], hand: ['Captain Kathryn Janeway'], library: ['Plains', 'Thorn Mammoth', ...WS_FILL], turns: 1 });
        assert.match(janeway.log.turns[0].cast[0].notes[0], /explores: Plains to hand/);
        assert.deepEqual(janeway.log.turns[0].lands, ['Plains'], 'and the extra land drop plays it');
    });

    it('creatures that bring lands: Karametra, Silverback Elder, The Earth King, Lumra, Lt. Arex, Kodama, Torsten', () => {
        const karametra = play(WS, plan([1, named('Thorn Mammoth')]), { battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Plains', 'Forest', 'Karametra, God of Harvests'], hand: ['Thorn Mammoth'], library: [...WS_FILL, 'Plains', 'Savannah'], turns: 1 });
        assert.match(karametra.log.turns[0].cast[0].notes[0], /Karametra, God of Harvests: Savannah \(tapped\)/);
        const elder = play(WS, plan([1, named('Thorn Mammoth')]), { battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Plains', 'Forest', 'Silverback Elder'], hand: ['Thorn Mammoth'], library: ['Thorn Mammoth', 'Ori, Plate Stacker', 'Plains', ...WS_FILL], turns: 1 });
        assert.match(elder.log.turns[0].cast[0].notes[0], /Silverback Elder: Plains \(tapped\)/);
        const king = play(WS, plan([1, named('The Earth King')]), { battlefield: ['Forest', 'Forest', 'Plains', 'Plains', 'Selvala, Eager Trailblazer'], hand: ['The Earth King'], library: [...WS_FILL, 'Plains', 'Forest'], turns: 1 });
        assert.equal(on(king, 'Bear').length, 1);
        assert.match(king.log.turns[0].notes.join(' '), /The Earth King: 1 basic land \(tapped\) after attacking/, 'Selvala attacks; the Bear is summoning sick');
        const lumra = play(WS, plan([1, named('Lumra, Bellow of the Woods')]), { battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Plains'], hand: ['Lumra, Bellow of the Woods', 'Arid Mesa'], library: ['Plains', 'Forest', 'Thorn Mammoth', 'Savannah', ...WS_FILL], turns: 1 });
        assert.match(lumra.log.turns[0].cast[0].notes[0], /Arid Mesa, Plains, Forest back \(tapped\)/);
        assert.equal(on(lumra, 'Lumra, Bellow of the Woods')[0].power, 10, 'power = lands you control');
        const arex = play(DW, plan([1, named('Lt. Arex, Ever-Adapting')]), { battlefield: ['Forest', 'Forest', 'Forest', 'Island', 'Island', 'Island', 'Tropical Island'], hand: ['Lt. Arex, Ever-Adapting', 'Forest'], library: ['Island', 'Breeding Pool', 'Expropriate', ...DW_FILL], turns: 1 });
        assert.match(arex.log.turns[0].cast[0].notes[0], /draws 3, 2 lands from hand \(tapped\)/);
        assert.equal(on(arex, 'Lt. Arex, Ever-Adapting')[0].power, 4, 'differently named lands');
        const kodama = play(WS, plan([1, mana(1)]), { battlefield: ['Forest', 'Forest', 'Kodama of the East Tree'], hand: ['Plains', 'Forest'], library: WS_FILL, turns: 1 });
        assert.match(kodama.log.turns[0].notes.join(' '), /Kodama of the East Tree: Forest from hand/);
        const torsten = play(WS, plan([1, named('Torsten, Founder of Benalia')]), { battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Plains', 'Savannah'], hand: ['Torsten, Founder of Benalia'], library: ['Plains', 'Thorn Mammoth', 'Season of Gathering', 'Forest', 'Lurking Predators', 'Ori, Plate Stacker', 'Genesis Storm', 'Branching Timeline'], turns: 1 });
        assert.match(torsten.log.turns[0].cast[0].notes[0], /4 cards to hand/);
    });

    it('payoffs whose text changes the turn: Genesis Wave at the X paid, Web of Life’s convoke, Elesh Norn, Restoration Seminar, Growing Rites', () => {
        const spend8 = plan([1, { kind: 'spend', atLeast: 8, group: { is: 'any', mv: [4, 20] } }]);
        const wave = play(WS, spend8, { battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Plains', 'Forest', 'Forest'], hand: ['Genesis Wave'], library: ['Plains', 'Fanatic of Rhonas', 'Thorn Mammoth', 'Forest', 'Season of Gathering', ...WS_FILL], turns: 1 });
        assert.deepEqual([wave.log.turns[0].cast[0].x, wave.stepValues[0], wave.stepTurns[0]], [5, 8, 1]);
        assert.match(wave.log.turns[0].cast[0].notes[0], /X=5: Plains, Fanatic of Rhonas, Forest/);
        assert.equal(wave.mana[1], 10, 'the two lands enter untapped');
        const web = play(WS, spend8, { battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Plains', 'Damage Control Crew', 'Ohran Frostfang'], hand: ['Web of Life and Destiny'], library: WS_FILL, turns: 1 });
        assert.deepEqual([web.avail[1], web.stepTurns[0]], [6, 1], 'two creatures convoke the last {2}');
        const norn = play(WS, plan([1, mana(1)]), { battlefield: ['Plains', 'Fanatic of Rhonas', 'Bloom Tender', 'Elesh Norn, Grand Cenobite'], library: WS_FILL, turns: 1 });
        assert.deepEqual(norn.board.filter(p => p.creature).map(p => [p.name, p.power]), [
            ['Fanatic of Rhonas', 3], ['Bloom Tender', 3], ['Elesh Norn, Grand Cenobite', 4], ['Selvala, Eager Trailblazer', 6]
        ], 'every other creature +2, Norn herself not');
        const seminar = play(WS, plan([1, named('Restoration Seminar')]), { battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Forest', 'Forest', 'Forest'], hand: ['Restoration Seminar'], library: WS_FILL, turns: 1 });
        assert.deepEqual(seminar.stepTurns, [0]);
        const rites = play(WS, plan([1, named('Growing Rites of Itlimoc')]), { battlefield: ['Forest', 'Forest', 'Forest', 'Plains', 'Fanatic of Rhonas', 'Bloom Tender', 'Priest of Titania', 'Raucous Audience'], hand: ['Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun'], library: ['Plains', 'Thorn Mammoth', 'Ori, Plate Stacker', 'Forest', ...WS_FILL], turns: 2 });
        assert.match(rites.log.turns[0].cast[0].notes[0], /Ori, Plate Stacker to hand|Thorn Mammoth to hand/);
        assert.match(rites.log.turns[0].notes.join(' '), /transforms into Itlimoc/);
        // Turn 2: 4 lands + Fanatic 4 + Bloom Tender 2 + Priest 3 (Bloom Tender and Selvala are Elves) + Raucous 2
        // + Selvala 3 (powers 1, 2, 4) + Itlimoc 5 (a {G} per creature).
        assert.equal(rites.avail[2], 4 + 4 + 2 + 3 + 2 + 3 + 5);
    });
});

// ── The presets as a whole ───────────────────────────────────────────────────

describe('the presets', () => {
    it('names a rule for every board-dependent card in both lists', () => {
        for (const name of ['Selvala, Eager Trailblazer', 'Fanatic of Rhonas', 'Whisperer of the Wilds', 'Ilysian Caryatid', 'Raucous Audience', 'Bloom Tender',
            'Priest of Titania', 'Badgermole Cub', 'Jadzia Dax, Living Legacy', 'Tangled Florahedron', 'Bramble Familiar', 'Trailtracker Scout', 'The Mind Stone',
            'The Great Henge', 'Genesis Wave', 'Icetill Explorer', 'Captain Kathryn Janeway', 'The Earth King', 'Karametra, God of Harvests', 'Elesh Norn, Grand Cenobite',
            'Restoration Seminar', 'Witch Enchanter', 'Disciple of Freyalise', 'Canopy Vista', 'Ba Sing Se', 'Hushwood Verge', 'Temple Garden', 'Yavimaya, Cradle of Growth',
            'The Sixth Doctor', 'Susan Foreman', 'Arixmethes, Slumbering Isle', 'Crystal Skull, Isu Spyglass', 'U.S.S. Voyager, Lone Wanderer', 'Omenpath Journey',
            'Kamahl\'s Druidic Vow', 'Reach the Horizon', 'Skyshroud Claim', 'Ugin, Eye of the Storms', 'Ugin, the Ineffable', 'Groundchuck & Dirtbag',
            'Vorinclex, Voice of Hunger', 'Aesi, Tyrant of Gyre Strait', 'Breeding Pool', 'Willowrush Verge', 'Sea Gate Restoration', 'Sink into Stupor']) {
            assert.ok(Rules.namedRule(name)?.label, name);
        }
    });

    it('simulates both: the user’s rules, with the measures beside them', () => {
        const ws = Engine.simulatePlan(WS, Splendor.plan, { format: { freeMulligan: true, firstPlayerDraws: true }, games: 600 });
        assert.equal(ws.steps.length, 3);
        assert.equal(ws.info.length, 1);
        assert.ok(ws.steps[0].onTime > 0.7 && ws.steps[1].onTime > 0.55 && ws.onTime > 0.2 && ws.onTime < 0.5, `${ws.onTime}`);
        assert.ok(ws.info[0].onTime > ws.onTime, 'the literal "one 7–9-drop" counts 7-drops the 8+ rule doesn’t');
        assert.ok(ws.steps[2].values.games === 600);
        const dw = Engine.simulatePlan(DW, Doctor.plan, { format: { freeMulligan: true, firstPlayerDraws: true }, games: 600 });
        assert.equal(dw.steps.length, 4);
        assert.ok(dw.onTime > 0.55 && dw.onTime < 0.85, `${dw.onTime}`);
        assert.ok(dw.info[0].onTime > dw.steps[DOCTOR].onTime, 'the Doctor by turn 5 is likelier than on turn 4');
        assert.ok(dw.steps[COPY].values.p50 >= 6, 'the copied spell is a real threat');
        assert.equal(BY_T5, 4);
        assert.match(GP.valueLabel(Doctor.plan.steps[COPY]), /Mana value of the spell copied by turn 5/);
    });
});
