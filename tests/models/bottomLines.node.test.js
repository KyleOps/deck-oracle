// Every branch of the big-spell bottom lines, and the small model helpers the
// pages lean on (cached distributions, settings, stand-in libraries).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { summarize as waveLine } from '../../js/utils/models/wave.js';
import { summarize as vowLine } from '../../js/utils/models/vow.js';
import { summarize as portentLine } from '../../js/utils/models/portent.js';
import {
    cachedValuePmf, surgeFromCounts, surgeFromList, surgeResult, surgeSettings, surgeValuePmf
} from '../../js/utils/models/surge.js';
import { sampleCast, DAMAGE_CARDS } from '../../js/utils/models/mara.js';

const payback = p => ({ paybackProbability: p });

describe('Genesis Wave and the Vow: what follows the payback chance', () => {
    const wave = { deckSize: 90, x: 6, mana: 9, revealed: 6, expectedPermanents: 4, low: 3, high: 5, mvKnown: true, maxX: 30 };
    const vow = { deckSize: 90, x: 6, mana: 8, seen: 6, copies: 1, expectedHits: 3, expectedLands: 2, expectedLegends: 1, legendsKnown: true, maxX: 30 };

    it('points to the X that pays back 3 times in 4', () => {
        assert.match(waveLine({ ...wave, payback: payback(0.5), reliableX: 9 }).html, /At <strong>X=9<\/strong> it pays for itself 3 times in 4/);
        assert.match(vowLine({ ...vow, payback: payback(0.5), reliableX: 9 }).html, /At <strong>X=9<\/strong> it pays for itself 3 times in 4/);
    });

    it('says when no X ever does', () => {
        assert.match(waveLine({ ...wave, payback: payback(0.2), reliableX: null }).html, /never pays back 3 times in 4, even at X=30/);
        assert.match(vowLine({ ...vow, payback: payback(0.2), reliableX: null }).html, /never pays back 3 times in 4, even at X=30/);
    });

    it('adds nothing more below the bar when a smaller X was already reliable', () => {
        const line = waveLine({ ...wave, payback: payback(0.6), reliableX: 4 }).html;
        assert.match(line, /pays for itself <strong>60%<\/strong> of the time\.$/);
    });
});

describe('Portent: what follows the free-spell chance', () => {
    const base = { x: 7, mana: 8, prob: 0.7, cards: 4, maxX: 30, typesInDeck: 6 };
    it('covers every place the reliable X can be', () => {
        assert.match(portentLine({ ...base, reliableX: null }).html, /stays under 9 in 10/);
        assert.match(portentLine({ ...base, reliableX: 10 }).html, /near-lock \(9 in 10\) at <strong>X=10/);
        assert.match(portentLine({ ...base, reliableX: 5 }).html, /X=5 is already 9 in 10 — 2 mana cheaper/);
        assert.match(portentLine({ ...base, reliableX: 7 }).html, /cheapest X that makes it 9 in 10/);
    });
});

describe('Primal Surge helpers', () => {
    it('clamps and rounds the value model to quarter-mana steps', () => {
        assert.deepStrictEqual(surgeSettings({ threshold: '12.3', landValue: '-4', cardValue: '99' }), { threshold: 12.25, landValue: 0, cardValue: 20 });
        assert.deepStrictEqual(surgeSettings({ threshold: 'junk' }), { threshold: 10, landValue: 1, cardValue: 0.25 });
    });

    it('counts one instant or sorcery as the Surge being cast when only counts are known', () => {
        const config = surgeFromCounts({ instants: 3, sorceries: 2, lands: 40 }, 99, surgeSettings());
        assert.deepStrictEqual([config.deckSize, config.nonPermanents, config.permanents, config.lands, config.mvKnown], [98, 4, 94, 40, false]);
        assert.strictEqual(surgeResult(config).payback, null, 'no mana values, no payback');
        assert.strictEqual(surgeFromCounts({}, 60).surgeOnStack, false);
        assert.strictEqual(surgeResult(surgeFromCounts({}, 0)), null);
    });

    it('caches the value distribution per deck, stops and values', () => {
        const cards = [
            { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 4 },
            { name: 'Bear', type_line: 'Creature — Bear', cmc: 2, count: 3 },
            { name: 'Opt', type_line: 'Instant', cmc: 1, count: 2 }
        ];
        const config = surgeFromList(cards, { settings: surgeSettings() });
        const pmf = cachedValuePmf(config);
        assert.deepStrictEqual(pmf, surgeValuePmf(config.permanentCards, config.nonPermanents, config.settings));
        assert.strictEqual(cachedValuePmf(config), pmf);
        assert.ok(Math.abs(pmf.reduce((s, e) => s + e.p, 0) - 1) < 1e-9);
    });
});

describe('Mara sample casts', () => {
    const card = (name, cmc, land = false) => ({ name, cmc, land });

    it('shows the run to the first spell and the top four from one shuffle', () => {
        const library = [card('Forest', 0, true), card('Island', 0, true), card('Bolt', 1), card('Giant', 6), card('Opt', 1)];
        const cast = sampleCast(library);
        assert.ok(cast.spell && !cast.spell.land, 'a spell was found');
        assert.strictEqual(cast.spellRun.at(-1), cast.spell);
        assert.ok(cast.spellRun.slice(0, -1).every(c => c.land), 'only lands come before it');
        assert.strictEqual(cast.top.length, DAMAGE_CARDS);
    });

    it('finds nothing in a library of lands', () => {
        const cast = sampleCast([card('Forest', 0, true), card('Island', 0, true)]);
        assert.strictEqual(cast.spell, null);
        assert.strictEqual(cast.spellRun.length, 2);
    });
});
