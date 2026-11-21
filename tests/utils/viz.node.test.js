import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    allocate, pmfQuantiles, sampleQuantiles, niceStep, binDots, dotPlot, describeDots,
    heatStrip, heatLevel, bulletChart, dumbbell, vizTable
} from '../../js/utils/viz.js';

const HEX = /#[0-9a-f]{3,8}\b/i;
const count = (html, needle) => html.split(needle).length - 1;

describe('allocate', () => {
    it('always hands out exactly the total', () => {
        assert.deepStrictEqual(allocate([1, 1, 1], 100), [34, 33, 33]);
        assert.strictEqual(allocate([0.123, 0.456, 0.421], 100).reduce((a, b) => a + b, 0), 100);
        assert.deepStrictEqual(allocate([0, 0], 100), [0, 0]);
        assert.deepStrictEqual(allocate([], 100), []);
    });

    it('never gives a part more than its share rounded up', () => {
        const weights = [3.4, 2.6, 0.2, 3.8];
        const parts = allocate(weights, 10);
        parts.forEach((n, i) => assert.ok(n <= Math.ceil(weights[i])));
    });
});

describe('pmfQuantiles', () => {
    it('places each dot at the middle of its 1% slice', () => {
        const dots = pmfQuantiles([0.25, 0.5, 0.25], 100);
        assert.strictEqual(dots.length, 100);
        assert.strictEqual(dots.filter(v => v === 0).length, 25);
        assert.strictEqual(dots.filter(v => v === 1).length, 50);
        assert.strictEqual(dots.filter(v => v === 2).length, 25);
    });

    it('accepts {value, p} pairs and unnormalised weights', () => {
        const dots = pmfQuantiles([{ value: 10, p: 3 }, { value: 2.5, p: 1 }], 4);
        assert.deepStrictEqual(dots, [2.5, 10, 10, 10]);
    });

    it('never plots the extreme tail as a dot', () => {
        // 0.1% chance of 99: below one dot's worth, so no dot shows it.
        const pmf = new Array(100).fill(0);
        pmf[1] = 0.999;
        pmf[99] = 0.001;
        assert.ok(!pmfQuantiles(pmf, 100).includes(99));
    });

    it('is empty for an empty distribution', () => {
        assert.deepStrictEqual(pmfQuantiles([], 100), []);
        assert.deepStrictEqual(pmfQuantiles([0, 0], 100), []);
    });
});

describe('sampleQuantiles', () => {
    it('reads nearest-rank percentiles, never the sampled maximum', () => {
        const samples = Array.from({ length: 1000 }, (_, i) => i);
        const dots = sampleQuantiles(samples, 100);
        assert.strictEqual(dots.length, 100);
        assert.strictEqual(dots[0], 5);
        assert.strictEqual(dots[99], 995);
        assert.ok(dots.every((v, i) => i === 0 || v >= dots[i - 1]));
    });
});

describe('niceStep', () => {
    it('rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
        assert.strictEqual(niceStep(0.3), 0.5);
        assert.strictEqual(niceStep(1.1), 2);
        assert.strictEqual(niceStep(2.2), 2.5);
        assert.strictEqual(niceStep(7), 10);
        assert.strictEqual(niceStep(0), 1);
    });
});

describe('binDots', () => {
    it('gives small whole-number ranges one column per value', () => {
        const bins = binDots([0, 1, 1, 3].map(value => ({ value })));
        assert.strictEqual(bins.discrete, true);
        assert.deepStrictEqual(bins.columns.map(c => c.dots.length), [1, 2, 0, 1]);
    });

    it('makes the threshold a column boundary so no column mixes outcomes', () => {
        const dots = Array.from({ length: 100 }, (_, i) => ({ value: i * 0.73, tone: i * 0.73 >= 10.25 ? 'good' : 'bad' }));
        const bins = binDots(dots, { threshold: 10.25, maxColumns: 24 });
        assert.strictEqual(bins.discrete, false);
        assert.ok(bins.columns.length <= 24);
        assert.strictEqual(bins.columns[bins.thresholdIndex].start, 10.25);
        for (const col of bins.columns) {
            const tones = new Set(col.dots.map(d => d.tone));
            assert.ok(tones.size <= 1, `column ${col.start} mixes tones`);
        }
        assert.strictEqual(bins.columns.reduce((s, c) => s + c.dots.length, 0), 100);
    });

    it('stacks misses under hits inside a column', () => {
        const bins = binDots([{ value: 2, tone: 'good' }, { value: 2, tone: 'bad' }, { value: 2, tone: 'good' }]);
        assert.deepStrictEqual(bins.columns[0].dots.map(d => d.tone), ['bad', 'good', 'good']);
    });

    it('extends the axis to show a threshold beyond every dot', () => {
        const bins = binDots([{ value: 1 }, { value: 2 }], { threshold: 6 });
        assert.strictEqual(bins.thresholdIndex, 5);
        assert.strictEqual(bins.columns.length, 6);
    });
});

describe('dotPlot', () => {
    const dots = pmfQuantiles([0.3, 0.2, 0.2, 0.2, 0.1], 100).map(value => ({ value, tone: value >= 2 ? 'good' : 'bad' }));
    const html = dotPlot({
        dots,
        label: 'Out of 100 casts',
        threshold: 2,
        thresholdLabel: '2+ pays for itself',
        legend: [{ tone: 'good', label: 'pay for themselves' }, { tone: 'bad', label: 'fall short' }],
        unit: 'cast',
        table: { head: ['Value', 'Casts'], rows: [['0', '30']] }
    });

    it('draws exactly one dot per outcome slice', () => {
        assert.strictEqual(count(html, 'class="viz-dot is-'), 100 + 2, '100 plotted + 2 legend swatches');
    });

    it('is an accessible image with the exact numbers alongside', () => {
        assert.match(html, /role="img" aria-label="Out of 100 casts"/);
        assert.match(html, /<details class="viz-table">/);
        assert.match(html, /data-tip="0: 30 of 100 casts"/);
    });

    it('counts each tone in the legend and marks the threshold', () => {
        assert.match(html, /<strong>50<\/strong> pay for themselves/);
        assert.match(html, /<strong>50<\/strong> fall short/);
        assert.match(html, /class="viz-dots-line"/);
        assert.match(html, /2\+ pays for itself/);
    });

    it('uses tokens, never literal colours', () => {
        assert.doesNotMatch(html, HEX);
    });

    it('renders nothing without dots', () => {
        assert.strictEqual(dotPlot({ dots: [] }), '');
    });

    it('escapes text it is given', () => {
        const out = dotPlot({ dots: [{ value: 1 }], label: 'a "quoted" <b>label</b>', xLabel: '<i>x</i>' });
        assert.ok(!out.includes('<b>label</b>'));
        assert.ok(!out.includes('<i>x</i>'));
    });
});

describe('describeDots', () => {
    it('summarises the picture in words built from the same dots', () => {
        const dots = pmfQuantiles([0.3, 0.2, 0.2, 0.2, 0.1], 100).map(value => ({ value, tone: value >= 2 ? 'good' : 'bad' }));
        const text = describeDots(dots, { unit: 'cast', legend: [{ tone: 'good', label: 'pay for themselves' }, { tone: 'bad', label: 'fall short' }] });
        assert.strictEqual(text, 'Out of 100 casts: 50 pay for themselves, 50 fall short. Typical result 2; 8 in 10 between 0 and 4.');
    });
});

describe('heatStrip', () => {
    it('marks cells by meaning and says every value', () => {
        const html = heatStrip({
            label: 'Card by turn',
            cells: [
                { label: 'T1', value: null },
                { label: 'T2', value: 0.62, tone: 'bad', current: true },
                { label: 'T3', value: 0.85, tone: 'warn' },
                { label: 'T4', value: 0.93, tone: 'good' }
            ]
        });
        assert.match(html, /role="img" aria-label="Card by turn: T1 not yet, T2 62%, T3 85%, T4 93%"/);
        assert.match(html, /is-bad is-current/);
        assert.strictEqual(count(html, 'viz-strip-cell'), 4);
        assert.doesNotMatch(html, HEX);
    });
});

describe('heatLevel', () => {
    it('maps chance to a 0..1 intensity that never decreases', () => {
        assert.strictEqual(heatLevel(0), 0);
        assert.strictEqual(heatLevel(0.01), 0);
        assert.strictEqual(heatLevel(1), 1);
        let prev = 0;
        for (let p = 0; p <= 1; p += 0.05) {
            const v = heatLevel(p);
            assert.ok(v >= prev);
            prev = v;
        }
        assert.strictEqual(heatLevel(NaN), 0);
    });
});

describe('bulletChart', () => {
    it('places the value and the guideline band on the scale', () => {
        const html = bulletChart({ label: 'Ramp', value: 12, min: 0, max: 20, range: [8, 14], status: 'in range', tone: 'good', rangeTip: 'A community guideline' });
        assert.match(html, /viz-bullet-band" style="left:40.00%;width:30.00%"/);
        assert.match(html, /viz-bullet-mark" style="left:60.00%"/);
        assert.match(html, /aria-label="Ramp: 12; typical 8 to 14 \(a guideline\); in range"/);
        assert.match(html, /tone-good/);
        assert.doesNotMatch(html, HEX);
    });

    it('clamps values past the scale and flags them', () => {
        const html = bulletChart({ label: 'x', value: 50, min: 0, max: 20 });
        assert.match(html, /is-over" style="width:100.00%"/);
    });
});

describe('dumbbell', () => {
    it('fills the better end for the stated direction', () => {
        const html = dumbbell({ a: 0.7, b: 0.8, min: 0, max: 1, better: 'higher', label: 'Keepable', format: v => `${Math.round(v * 100)}%` });
        assert.match(html, /aria-label="Keepable: A 70%, B 80% — B is better"/);
        assert.match(html, /is-b is-better/);
        assert.match(html, /is-a is-worse/);
    });

    it('treats lower-is-better metrics the other way round', () => {
        const html = dumbbell({ a: 2.9, b: 3.4, min: 0, max: 6, better: 'lower' });
        assert.match(html, /is-a is-better/);
    });

    it('stays neutral without a direction or when equal', () => {
        assert.doesNotMatch(dumbbell({ a: 1, b: 2, min: 0, max: 4 }), /is-better/);
        assert.doesNotMatch(dumbbell({ a: 2, b: 2, min: 0, max: 4, better: 'higher' }), /is-better/);
    });
});

describe('vizTable', () => {
    it('renders a closed details table with row headers', () => {
        const html = vizTable({ head: ['Value', 'Chance'], rows: [['1', '50%']] });
        assert.match(html, /<details class="viz-table">/);
        assert.match(html, /<th scope="row">1<\/th><td class="num">50%<\/td>/);
        assert.strictEqual(vizTable({ rows: [] }), '');
    });
});
