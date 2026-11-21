import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import LZString from 'lz-string';
import '../node-test-helper.js';
import { isAllowedDeckUrl, boundedNumber, applyPageParams, pageShareParams, PACKED_PARAMS } from '../../js/utils/share.js';
import { packRequirements, unpackRequirements } from '../../js/utils/mulliganModel.js';
import { CALCULATORS } from '../../js/utils/calculatorRegistry.js';
import { fuzzyScore } from '../../js/shell/palette.js';

describe('share link validation', () => {
    it('accepts only https Moxfield and Archidekt deck links', () => {
        assert.ok(isAllowedDeckUrl('https://moxfield.com/decks/abc'));
        assert.ok(isAllowedDeckUrl('https://www.archidekt.com/decks/123'));
        assert.equal(isAllowedDeckUrl('http://moxfield.com/decks/abc'), false);
        assert.equal(isAllowedDeckUrl('https://moxfield.com.evil.example/decks/abc'), false);
        assert.equal(isAllowedDeckUrl('javascript:alert(1)'), false);
        assert.equal(isAllowedDeckUrl('not a url'), false);
    });

    it('bounds numeric parameters', () => {
        assert.equal(boundedNumber('8', { min: 0, max: 30 }), 8);
        assert.equal(boundedNumber('8.5', { min: 0, max: 30 }), 8);
        assert.equal(boundedNumber('0.25', { min: 0, max: 1, float: true }), 0.25);
        assert.equal(boundedNumber('31', { min: 0, max: 30 }), null);
        assert.equal(boundedNumber('-1', { min: 0, max: 30 }), null);
        assert.equal(boundedNumber('abc', { min: 0, max: 30 }), null);
        assert.equal(boundedNumber(null, { min: 0, max: 30 }), null);
    });

    it('names the LZ-String-packed parameters, so the app loads it before applying a link', () => {
        assert.deepEqual([...PACKED_PARAMS], ['mullTypes']);
        assert.ok(Object.isFrozen(PACKED_PARAMS));
    });
});

describe('mulligan requirements in links (mullTypes)', () => {
    const rows = [
        { id: 1, name: 'Lands', count: 37, required: 3, byTurn: 3 },
        { id: 2, name: 'Ramp & “draw”', count: 12, required: 1, byTurn: 3 }
    ];

    it('round-trips the rows', () => {
        const packed = packRequirements(rows, LZString);
        assert.match(packed, /^[A-Za-z0-9+\-$]+$/, 'URL-safe');
        assert.deepEqual(unpackRequirements(packed, LZString), rows);
        assert.equal(packRequirements(rows, undefined), null, 'no codec yet: nothing to pack');
    });

    it('still reads links made with a colour per row (before 3.2)', () => {
        const legacy = LZString.compressToEncodedURIComponent(JSON.stringify([[1, 'Lands', 37, 3, 3, '55c97f'], [2, 'Ramp', 12, 1, 3, '']]));
        assert.deepEqual(unpackRequirements(legacy, LZString), [
            { id: 1, name: 'Lands', count: 37, required: 3, byTurn: 3 },
            { id: 2, name: 'Ramp', count: 12, required: 1, byTurn: 3 }
        ]);
    });

    it('rejects tampered rows', () => {
        const pack = data => LZString.compressToEncodedURIComponent(JSON.stringify(data));
        assert.equal(unpackRequirements(pack([[1, 'X', 999, 1, 1]]), LZString), null, 'count out of range');
        assert.equal(unpackRequirements(pack([[1, 'X', 1, 1, 21]]), LZString), null, 'turn out of range');
        assert.equal(unpackRequirements(pack([[1, 'X'.repeat(61), 1, 1, 1]]), LZString), null, 'name too long');
        assert.equal(unpackRequirements(pack([[1, 'X', 1, 1, 1, 'red;background:url(x)']]), LZString), null, 'not a colour');
        assert.equal(unpackRequirements(pack({ rows: [] }), LZString), null, 'not a list');
        assert.equal(unpackRequirements(pack(['row']), LZString), null, 'not a row');
        assert.equal(unpackRequirements('garbage', LZString), null);
        assert.equal(unpackRequirements(pack([[1, 'X', 1, 1, 1]]), undefined), null, 'no codec');
    });
});

/**
 * Every input a share link has ever carried. Links already shared use these
 * names, ids and bounds: they must keep working (each page declares its own
 * as `shareInputs`).
 */
const LEGACY_INPUTS = [
    { tab: 'portent', param: 'portentX', id: 'portent-xSlider', min: 0, max: 20 },
    { tab: 'wave', param: 'waveX', id: 'wave-xSlider', min: 0, max: 30 },
    { tab: 'wave', param: 'waveLand', id: 'wave-land-value', min: 0, max: 20, float: true },
    { tab: 'wave', param: 'waveCard', id: 'wave-card-value', min: 0, max: 20, float: true },
    { tab: 'vow', param: 'vowX', id: 'vow-xSlider', min: 0, max: 30 },
    { tab: 'vow', param: 'vowLand', id: 'vow-land-value', min: 0, max: 20, float: true },
    { tab: 'vow', param: 'vowCard', id: 'vow-card-value', min: 0, max: 20, float: true },
    { tab: 'vortex', param: 'vortexCMC', id: 'vortex-cmcSlider', min: 5, max: 15 },
    { tab: 'rashmi', param: 'rashmiCMC', id: 'rashmi-cmcSlider', min: 0, max: 15 },
    { tab: 'lumra', param: 'lumraGY', id: 'lumra-gySlider', min: 0, max: 30 },
    { tab: 'lumra', param: 'lumraMult', id: 'lumra-multSlider', min: 1, max: 10 },
    { tab: 'lumra', param: 'lumraFetch', id: 'lumra-fetchLands', min: 0, max: 100 },
    { tab: 'lumra', param: 'lumraTurn', id: 'lumra-turnSlider', min: 1, max: 20 },
    { tab: 'chimil', param: 'chimilTurns', id: 'chimil-turnsSlider', min: 1, max: 20 },
    { tab: 'wildpair', param: 'wpTotal', id: 'wildpair-totalSlider', min: 0, max: 40 },
    { tab: 'surge', param: 'surgeThreshold', id: 'surge-payback-threshold', min: 0.25, max: 100, float: true },
    { tab: 'surge', param: 'surgeLand', id: 'surge-land-value', min: 0, max: 20, float: true },
    { tab: 'surge', param: 'surgeCard', id: 'surge-card-value', min: 0, max: 20, float: true },
    { tab: 'mulligan', param: 'mullSims', id: 'mulligan-sample-count', min: 1, max: 10000 },
    { tab: 'mulligan', param: 'mullPenalty', id: 'mull-penalty', min: 0, max: 100, float: true },
    { tab: 'mulligan', param: 'mullThreshold', id: 'mull-threshold', min: 0, max: 100, float: true }
];

const modules = {};
const views = {};
for (const tab of new Set(LEGACY_INPUTS.map(i => i.tab))) {
    modules[tab] = await import(`../../js/calculators/${tab}.js`);
    views[tab] = await import(`../../js/views/${tab}.js`);
}

/** Inputs by id that record what a link set, and the events it fired. */
function fakeInputs() {
    const inputs = new Map();
    document.getElementById = id => {
        if (!inputs.has(id)) inputs.set(id, { id, value: '', events: [], dispatchEvent(e) { this.events.push(e.type); } });
        return inputs.get(id);
    };
    return inputs;
}

describe('legacy share inputs: every old parameter still restores its input', () => {
    let inputs;
    beforeEach(() => { inputs = fakeInputs(); });

    for (const legacy of LEGACY_INPUTS) {
        const { tab, param, id, min, max, float = false } = legacy;
        it(`${param} → #${id} (${tab})`, () => {
            const module = modules[tab];
            const declared = module.shareInputs.find(s => s.param === param);
            assert.ok(declared, `${tab} declares ${param}`);
            assert.deepEqual({ ...declared, float: declared.float ?? false }, { param, id, min, max, float });
            assert.ok(CALCULATORS[tab], `${tab} is a page`);
            assert.match(views[tab].template, new RegExp(`id="${id}"`), `the ${tab} view has #${id}`);

            const inRange = float ? (min + max) / 2 : Math.floor((min + max) / 2);
            applyPageParams(new URLSearchParams({ [param]: String(inRange), tab }), { shareInputs: module.shareInputs }, tab);
            assert.equal(inputs.get(id).value, inRange, 'sets the input');
            assert.deepEqual(inputs.get(id).events, ['input', 'change'], 'and tells the page, as if typed');

            inputs.get(id).value = 'untouched';
            applyPageParams(new URLSearchParams({ [param]: String(max + 1) }), { shareInputs: module.shareInputs }, tab);
            assert.equal(inputs.get(id).value, 'untouched', 'out of range: ignored');

            inputs.get(id).value = String(inRange);
            assert.ok(pageShareParams({ shareInputs: module.shareInputs }, tab).some(([k, v]) => k === param && v === String(inRange)),
                'and a link made on the page carries it');
        });
    }

    it('no page declares an input it never had, and no parameter twice', () => {
        const declared = Object.entries(modules).flatMap(([tab, m]) => m.shareInputs.map(s => `${tab}:${s.param}`));
        assert.deepEqual(declared.sort(), LEGACY_INPUTS.map(i => `${i.tab}:${i.param}`).sort());
        const params = declared.map(d => d.split(':')[1]);
        assert.equal(new Set(params).size, params.length);
    });
});

describe('page parameters', () => {
    it('add the page’s own settings after its inputs, skipping empty ones', () => {
        fakeInputs();
        document.getElementById('x-in').value = '7';
        document.getElementById('x-empty').value = '';
        const module = {
            shareInputs: [{ param: 'in', id: 'x-in', min: 0, max: 9 }, { param: 'empty', id: 'x-empty', min: 0, max: 9 }],
            getShareParams: () => ({ draw: 1, none: null, blank: '', zero: 0 })
        };
        assert.deepEqual(pageShareParams(module), [['in', '7'], ['draw', '1'], ['zero', '0']]);
        assert.deepEqual(pageShareParams(null), []);
        assert.deepEqual(pageShareParams({ getShareParams: () => { throw new Error('broken'); } }), [], 'a broken page adds nothing');
    });

    it('hand the page its parameters after the inputs, and survive a page that throws', () => {
        fakeInputs();
        const seen = [];
        applyPageParams(new URLSearchParams('in=3&draw=1'), {
            shareInputs: [{ param: 'in', id: 'x-in', min: 0, max: 9 }],
            applyShareParams: params => seen.push(params.get('draw'), document.getElementById('x-in').value)
        });
        assert.deepEqual(seen, ['1', 3]);
        assert.doesNotThrow(() => applyPageParams(new URLSearchParams('draw=1'), { applyShareParams: () => { throw new Error('bad'); } }));
        assert.doesNotThrow(() => applyPageParams(new URLSearchParams('draw=1'), null));
    });
});

describe('command palette fuzzy search', () => {
    it('ranks exact and prefix matches above subsequences', () => {
        const exact = fuzzyScore('genesis wave', 'Genesis Wave');
        const prefix = fuzzyScore('gen', 'Genesis Wave');
        const word = fuzzyScore('wave', 'Genesis Wave');
        const subseq = fuzzyScore('gw', 'Genesis Wave');
        assert.ok(exact > prefix && prefix > word && word > subseq && subseq > 0);
    });

    it('rejects strings that do not contain the query in order', () => {
        assert.equal(fuzzyScore('xyz', 'Genesis Wave'), 0);
        assert.equal(fuzzyScore('wg', 'Wild'), 0);
        assert.ok(fuzzyScore('', 'anything') > 0);
    });
});
