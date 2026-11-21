// The X-spell page kit in bigSpells.js — what Genesis Wave and Kamahl's
// Druidic Vow share (and Portent and Primal Surge use where it fits) — against
// a small fake DOM and a fake Chart.js. The pages' own output is checked in
// the browser; this is each helper's contract.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const elements = new Map();
const listeners = new Map();

/** An element by id: value, innerHTML, hidden, listeners, child buttons. */
function el(id, props = {}) {
    const node = {
        id,
        value: '',
        innerHTML: '',
        hidden: false,
        width: 320,
        children: [],
        getBoundingClientRect: () => ({ width: node.width }),
        addEventListener: (type, fn) => listeners.set(`${id}:${type}`, fn),
        querySelectorAll: () => node.children,
        focus: () => { node.focused = true; },
        ...props
    };
    elements.set(id, node);
    return node;
}

function button(dataset) {
    const classes = new Set();
    const attrs = {};
    return {
        dataset,
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: c => classes.has(c) },
        setAttribute: (k, v) => { attrs[k] = v; },
        attrs
    };
}

const paybackKeys = [{ hidden: false }];
global.document = {
    documentElement: {},
    activeElement: null,
    getElementById: id => elements.get(id) ?? null,
    querySelectorAll: selector => (selector.endsWith('[data-payback-key]') ? paybackKeys : []),
    addEventListener: () => {}
};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });

class FakeChart {
    static built = [];
    static defaults = { font: {}, plugins: { legend: {}, tooltip: {} }, scales: { linear: {}, category: {} } };
    constructor(canvas, config) {
        this.canvas = canvas;
        this.config = config;
        this.data = config.data;
        this.options = config.options;
        this.destroyed = false;
        FakeChart.built.push(this);
    }
    update() {}
    destroy() { this.destroyed = true; }
}
global.Chart = FakeChart;

const {
    PAYBACK_LEGEND, bindBigSpellControls, castImage, paybackChart, paybackSampleHTML, readValueInput, readXSpell,
    renderEmptyAnswer, renderXSweep, setXInputs, syncDotsView, valueBandsTable
} = await import('../../js/utils/bigSpells.js');
const { TX_CHART } = await import('../../js/utils/chartHelpers.js');
const { ON_STACK, buildWaveLibrary } = await import('../../js/utils/models/wave.js');
const { DEFAULT_DECK_DATA } = await import('../../js/utils/defaultDeckData.js');

beforeEach(() => {
    elements.clear();
    listeners.clear();
    FakeChart.built = [];
    paybackKeys[0].hidden = false;
});

describe('X control and value inputs', () => {
    it('sets both halves of the X control', () => {
        const slider = el('wave-xSlider');
        const box = el('wave-xValue');
        setXInputs('wave', 12);
        assert.equal(slider.value, 12);
        assert.equal(box.value, 12);
        assert.doesNotThrow(() => setXInputs('missing', 3));
    });

    it('reads a value input clamped to 0–20, or the fallback', () => {
        assert.equal(readValueInput('wave-land-value', 1), 1, 'not mounted');
        el('wave-land-value', { value: '2.5' });
        assert.equal(readValueInput('wave-land-value', 1), 2.5);
        elements.get('wave-land-value').value = '99';
        assert.equal(readValueInput('wave-land-value', 1), 20);
        elements.get('wave-land-value').value = '-3';
        assert.equal(readValueInput('wave-land-value', 1), 0);
        elements.get('wave-land-value').value = 'lots';
        assert.equal(readValueInput('wave-land-value', 1), 1);
    });
});

describe('readXSpell', () => {
    const opts = { onStack: ON_STACK, build: buildWaveLibrary, maxX: 30, defaultX: 7 };

    it('reads the library without the cast copy, and the X chosen within it', () => {
        const r = readXSpell('wave', DEFAULT_DECK_DATA, opts);
        assert.equal(r.x, 7, 'the default before the page is mounted');
        assert.equal(r.maxX, 30);
        assert.equal(r.deckSize, r.library.deckSize);
        assert.ok(r.cards.length > 0);
        assert.ok(r.deckKey.length > 0 && !r.deckKey.startsWith('counts:'));

        el('wave-xValue', { value: '25' });
        assert.equal(readXSpell('wave', DEFAULT_DECK_DATA, opts).x, 25);
        assert.equal(readXSpell('wave', DEFAULT_DECK_DATA, { ...opts, maxX: 12 }).x, 12, 'X never passes the limit');
    });

    it('keys a counts-only deck on its counts, and takes another library shape', () => {
        const counts = { lands: 10, creatures: 5, instants: 5, cardsByName: {} };
        const r = readXSpell('wave', counts, opts);
        assert.equal(r.cards.length, 0);
        assert.match(r.deckKey, /^counts:/);
        assert.equal(r.x, Math.min(7, r.deckSize));

        const masks = readXSpell('portent', counts, {
            ...opts, build: () => [1, 2, 4], size: list => list.length, countsKey: list => `m:${list.join('')}`
        });
        assert.deepEqual([masks.deckSize, masks.maxX, masks.x, masks.deckKey], [3, 3, 3, 'm:124']);
    });
});

describe('page states and wiring', () => {
    it('renders the empty answer and clears the dots', () => {
        const stats = el('wave-stats');
        const dots = el('wave-dots', { innerHTML: '<svg></svg>' });
        renderEmptyAnswer('wave', 'Add cards to your deck.');
        assert.match(stats.innerHTML, /Add cards to your deck\./);
        assert.equal(dots.innerHTML, '');
        assert.doesNotThrow(() => renderEmptyAnswer('vow', 'Nothing here.'), 'pages without dots');
    });

    it('presses the dots view shown and hides the switch without values', () => {
        const view = el('surge-dots-view');
        view.children = [button({ dotsView: 'permanents' }), button({ dotsView: 'value' })];
        syncDotsView('surge', 'value', true);
        assert.equal(view.hidden, false);
        assert.deepEqual(view.children.map(b => b.attrs['aria-pressed']), ['false', 'true']);
        syncDotsView('surge', 'permanents', false);
        assert.equal(view.hidden, true);
        assert.ok(view.children[0].classList.has('active'));
    });

    it('binds presets, value inputs, reshuffle, cast and the dots switch', () => {
        const calls = [];
        el('wave-presets');
        el('wave-land-value');
        el('wave-reshuffle-btn');
        el('wave-cast-btn');
        el('wave-cast');
        el('wave-dots-view');
        bindBigSpellControls('wave', {
            update: () => calls.push('update'),
            setX: x => calls.push(`x=${x}`),
            values: ['wave-land-value', 'wave-not-here'],
            reshuffle: () => calls.push('reshuffle'),
            cast: () => calls.push('cast'),
            dotsView: v => calls.push(`view=${v}`)
        });
        listeners.get('wave-presets:click')({ target: { closest: () => ({ dataset: { x: '10' } }) } });
        listeners.get('wave-land-value:input')();
        listeners.get('wave-reshuffle-btn:click')();
        listeners.get('wave-cast-btn:click')();
        listeners.get('wave-cast:cast-closed')();
        listeners.get('wave-dots-view:click')({ target: { closest: () => ({ dataset: { dotsView: 'value' } }) } });
        listeners.get('wave-dots-view:click')({ target: { closest: () => null } });
        assert.deepEqual(calls, ['x=10', 'update', 'reshuffle', 'cast', 'view=value']);
        assert.ok(elements.get('wave-cast-btn').focused, 'focus returns to Cast it');
    });

    it('binds only what a page has', () => {
        el('portent-reshuffle-btn');
        let reshuffled = false;
        bindBigSpellControls('portent', { update: () => {}, reshuffle: () => { reshuffled = true; } });
        assert.ok(!listeners.has('portent-cast-btn:click'));
        listeners.get('portent-reshuffle-btn:click')();
        assert.ok(reshuffled);
    });

    it('finds a cast card’s image by name', () => {
        assert.match(castImage('Sol Ring'), /^https:\/\//);
    });
});

describe('paybackSampleHTML', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `Card ${i}`, type: 'land', state: i % 2 ? 'miss' : 'hit' }));

    it('scores what went into play against the mana spent', () => {
        const html = paybackSampleHTML({
            index: 1, rows, maxRows: 3, hitUnit: 'permanent',
            put: { manaValue: 6, lands: 2, cards: 3 }, settings: { landValue: 1, cardValue: 0.25 }, threshold: 8,
            lead: '<strong>3 permanents</strong>'
        });
        assert.match(html, /Shuffle 2/);
        assert.match(html, /Pays for itself/);
        assert.match(html, /tone-good/);
        assert.match(html, /\+ 2 more cards \(1 permanent\)/, 'hidden rows, and the hits among them');
        assert.match(html, /<strong>3 permanents<\/strong> · value <strong>8\.8<\/strong> of 8 needed/);
        assert.equal((html.match(/class="bs-card /g) ?? []).length, 3);
    });

    it('falls short, with nothing hidden', () => {
        const html = paybackSampleHTML({
            index: 0, rows: rows.slice(0, 2), maxRows: 3, hitUnit: 'hit',
            put: { manaValue: 1, lands: 0, cards: 1 }, settings: { landValue: 1, cardValue: 0 }, threshold: 9, lead: 'x'
        });
        assert.match(html, /Falls short/);
        assert.doesNotMatch(html, /more card/);
    });
});

describe('renderXSweep', () => {
    const results = {
        1: { mana: 4, hits: 0.5, seen: 1, payback: { paybackProbability: 0.1 } },
        2: { mana: 5, hits: 1.25, seen: 2, payback: { paybackProbability: 0.95 } },
        3: { mana: 6, hits: 2, seen: 0, payback: { paybackProbability: 0.5 } }
    };
    const opts = {
        x: 2, recommended: 3, results, maxX: 30, tableMax: 20, hits: r => r.hits, seen: r => r.seen,
        columns: [{ label: 'Hits', render: row => String(row.r.hits) }]
    };

    it('lists every X with the page’s columns, the change and the payback chance', () => {
        const table = el('t');
        renderXSweep('t', opts);
        assert.match(table.innerHTML, /<th class="ta-l">X<\/th><th class="">Mana<\/th><th class="">Hits<\/th><th class="">Change<\/th><th class="ta-l">Hit rate<\/th><th class="">Pays for itself<\/th>/);
        assert.equal((table.innerHTML.match(/<tr class/g) ?? []).length, 3);
        assert.match(table.innerHTML, /class="active-row"/);
        assert.match(table.innerHTML, /class="rec-row"/);
        assert.match(table.innerHTML, /\+0\.75/);
        assert.match(table.innerHTML, />—</, 'no change for the first X');
        assert.match(table.innerHTML, /95%/);
    });

    it('stops at the table limit and says — without payback', () => {
        const table = el('t');
        renderXSweep('t', { ...opts, tableMax: 2, hasPayback: false });
        assert.equal((table.innerHTML.match(/<tr class/g) ?? []).length, 2);
        assert.doesNotMatch(table.innerHTML, /95%/);
    });
});

describe('valueBandsTable', () => {
    const pmf = [{ value: 3, p: 0.2 }, { value: 10, p: 0.3 }, { value: 12.5, p: 0.1 }, { value: 50, p: 0.4 }];

    it('bands values from the threshold up, with the rest in the last band', () => {
        const table = valueBandsTable(pmf, { threshold: 10, step: 10, bands: 3 });
        assert.deepEqual(table.head, ['Value put into play', 'Chance']);
        assert.deepEqual(table.rows, [
            ['Under 10 (falls short)', '20%'],
            ['10 to under 20', '40%'],
            ['20 to under 30', '0%'],
            ['30 to under 40', '0%'],
            ['40 or more', '40%']
        ]);
    });

    it('formats band edges and drops empty bands', () => {
        const table = valueBandsTable(pmf, { threshold: 0, step: 2.5, bands: 1, format: v => v.toFixed(2) });
        assert.deepEqual(table.rows.map(r => r[0]), ['0.00 to under 2.50', '2.50 or more']);
    });
});

describe('paybackChart', () => {
    const spec = {
        points: [1, 2, 3],
        current: 2,
        bars: { label: 'Permanents', data: [1, 2, 3] },
        payback: [10, 50, 90],
        xTitle: 'X',
        yTitle: 'Permanents',
        title: x => `X=${x}`
    };

    it('highlights the current point and draws the payback line on the right axis', () => {
        el('wave-chart');
        const chart = paybackChart(null, 'wave', { ...spec, onPick: x => { chart.picked = x; } });
        assert.ok(chart instanceof FakeChart);
        const [bars, line] = chart.data.datasets;
        assert.deepEqual(bars.backgroundColor, [bars.backgroundColor[0], TX_CHART.amber, bars.backgroundColor[2]]);
        assert.notEqual(bars.backgroundColor[0], TX_CHART.amber);
        assert.deepEqual(line.pointRadius, [2, 5, 2]);
        assert.deepEqual(line.data, [10, 50, 90]);
        assert.equal(line.hidden, false);
        assert.equal(chart.options.scales.y2.display, true);
        assert.equal(chart.$hasPayback, true);
        assert.equal(paybackKeys[0].hidden, false);

        chart.options.onClick(null, [{ index: 2 }]);
        assert.equal(chart.picked, 3, 'a click picks the point under it');
        const target = { style: {} };
        chart.options.onHover({ native: { target } }, [{}]);
        assert.equal(target.style.cursor, 'pointer');

        const { title, label } = chart.options.plugins.tooltip.callbacks;
        assert.equal(title([{ label: '3' }]), 'X=3');
        assert.equal(label({ datasetIndex: 0, parsed: { y: 2.25 } }), 'Permanents: 2.3');
        assert.equal(label({ datasetIndex: 1, parsed: { y: 50 } }), 'Pays for itself: 50%');
    });

    it('hides the line and its legend key without payback, rebuilding when that changes', () => {
        el('surge-chart');
        const first = paybackChart(null, 'surge', spec);
        assert.equal(first.options.onClick, undefined, 'no picking unless asked');
        const second = paybackChart(first, 'surge', { ...spec, payback: null, barLabel: () => 'custom' });
        assert.ok(first.destroyed, 'the right axis went away: a new chart');
        assert.notEqual(second, first);
        assert.deepEqual(second.data.datasets[1].data, [null, null, null]);
        assert.equal(second.data.datasets[1].hidden, true);
        assert.equal(second.options.scales.y2.display, false);
        assert.equal(paybackKeys[0].hidden, true);
        assert.equal(second.options.plugins.tooltip.callbacks.label({ datasetIndex: 0, parsed: { y: 1 } }), 'custom');
    });

    it('returns no chart without a canvas', () => {
        assert.equal(paybackChart(null, 'missing', spec), null);
    });

    it('labels casts that paid for themselves and fell short', () => {
        assert.deepEqual(PAYBACK_LEGEND.map(l => l.tone), ['good', 'bad']);
    });
});
