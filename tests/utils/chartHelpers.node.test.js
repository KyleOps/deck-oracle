import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * createOrUpdateChart() builds new charts after the next paint, once Chart.js
 * is here, and hands back a placeholder meanwhile. These tests drive frames by
 * hand: requestAnimationFrame queues, paint() runs the queue and lets the
 * follow-up task run.
 */

const elements = new Map();
const docListeners = {};
let tokens = { '--tx-dim': '#808b85' };
let frames = [];

global.document = {
    documentElement: {},
    getElementById: id => elements.get(id) ?? null,
    addEventListener: (type, fn) => { docListeners[type] = fn; }
};
global.getComputedStyle = () => ({ getPropertyValue: name => tokens[name] ?? '' });

class FakeChart {
    static built = [];
    static defaults = { font: {}, plugins: { legend: {}, tooltip: {} }, scales: { linear: {}, category: {} } };
    constructor(canvas, config) {
        this.canvas = canvas;
        this.config = config;
        this.data = config.data;
        this.options = config.options;
        this.updates = 0;
        this.destroyed = false;
        FakeChart.built.push(this);
    }
    update() { this.updates += 1; }
    destroy() { this.destroyed = true; }
}

const charts = await import('../../js/utils/chartHelpers.js');
const { createOrUpdateChart, chartEngineReady, withAlpha, getChartAnimationConfig, TX_CHART } = charts;
const { markRendered, needsRender } = await import('../../js/utils/calculatorBase.js');

function canvas(id, { width = 320, page = 'wave' } = {}) {
    const el = {
        id,
        width,
        getBoundingClientRect: () => ({ width: el.width }),
        closest: selector => (selector === '.tab-content' ? { id: `${page}-tab` } : null)
    };
    elements.set(id, el);
    return el;
}

const config = (data = [1, 2, 3]) => ({ type: 'line', data: { labels: ['a', 'b', 'c'], datasets: [{ data }] }, options: {} });

/** Draw a frame, then let the task queued after it run. */
async function paint() {
    frames.splice(0).forEach(cb => cb(0));
    await new Promise(resolve => setTimeout(resolve, 5));
}

beforeEach(async () => {
    global.Chart = FakeChart;
    global.requestAnimationFrame = cb => frames.push(cb);
    await paint(); // let the previous test's queued frames run
    elements.clear();
    FakeChart.built = [];
});

afterEach(() => {
    delete global.Chart;
    delete global.requestAnimationFrame;
});

describe('createOrUpdateChart', () => {
    it('returns null when the canvas is not in the page', () => {
        assert.equal(createOrUpdateChart(null, 'missing', config()), null);
    });

    it('builds a new chart after the next paint, not during the render', async () => {
        canvas('c1');
        const handle = createOrUpdateChart(null, 'c1', config());
        assert.ok(handle, 'a placeholder to pass back');
        assert.equal(FakeChart.built.length, 0, 'nothing built during the render');

        await paint();
        assert.equal(FakeChart.built.length, 1);
        const [chart] = FakeChart.built;
        assert.equal(chart.options.animation, false, 'the first draw is static');
        await paint();
        assert.deepEqual(chart.options.animation, getChartAnimationConfig().animation, 'later changes animate');

        const same = createOrUpdateChart(handle, 'c1', config([4, 5, 6]));
        assert.equal(same, chart, 'the placeholder stands for the chart it became');
        assert.equal(chart.updates, 1);
        assert.deepEqual(chart.data.datasets[0].data, [4, 5, 6]);
    });

    it('builds from the newest configuration when updated before the build', async () => {
        canvas('c2');
        const handle = createOrUpdateChart(null, 'c2', config([1]));
        assert.equal(createOrUpdateChart(handle, 'c2', config([2])), handle);
        await paint();
        assert.equal(FakeChart.built.length, 1);
        assert.deepEqual(FakeChart.built[0].data.datasets[0].data, [2]);
    });

    it('cancels the build when destroyed first, and destroys the chart after', async () => {
        canvas('c3');
        const cancelled = createOrUpdateChart(null, 'c3', config());
        cancelled.destroy();
        await paint();
        assert.equal(FakeChart.built.length, 0);

        const handle = createOrUpdateChart(null, 'c3', config());
        await paint();
        handle.destroy();
        assert.equal(FakeChart.built[0].destroyed, true);
        assert.notEqual(createOrUpdateChart(handle, 'c3', config()), handle, 'a destroyed placeholder starts over');
    });

    it('builds one chart per canvas when a caller loses its placeholder', async () => {
        canvas('c4');
        createOrUpdateChart(null, 'c4', config([1]));
        createOrUpdateChart(null, 'c4', config([2]));
        await paint();
        assert.equal(FakeChart.built.length, 1);
        assert.deepEqual(FakeChart.built[0].data.datasets[0].data, [2]);
    });

    it('waits for Chart.js, then builds once it has arrived', async () => {
        delete global.Chart;
        canvas('c5');
        const handle = createOrUpdateChart(null, 'c5', config());
        await paint();
        assert.equal(handle.chart, null, 'no engine, no chart yet');

        global.Chart = FakeChart;
        chartEngineReady();
        await paint();
        assert.equal(FakeChart.built.length, 1);
        assert.equal(handle.chart, FakeChart.built[0]);
        assert.equal(FakeChart.defaults.color, TX_CHART.dim, 'Chart.js is themed when it arrives');
    });

    it('leaves a chart whose page was left before the build for that page’s next visit', async () => {
        const el = canvas('c6', { width: 0, page: 'chimil' });
        markRendered('chimil');
        const handle = createOrUpdateChart(null, 'c6', config());
        await paint();
        assert.equal(FakeChart.built.length, 0, 'no size to draw at');
        assert.equal(needsRender('chimil'), true, 'the page owes a render');

        el.width = 320;
        markRendered('chimil');
        assert.equal(createOrUpdateChart(handle, 'c6', config()), handle, 'still waiting');
        await paint();
        assert.equal(handle.chart, FakeChart.built[0]);
    });

    it('rebuilds a chart for a new theme, keeping the old one on screen until then', async () => {
        canvas('c7');
        const first = createOrUpdateChart(null, 'c7', config());
        await paint();
        const old = first.chart;

        tokens = { ...tokens, '--tx-dim': '#5f6b64' };
        docListeners.themechange();
        assert.equal(TX_CHART.dim, '#5f6b64', 'the palette follows the theme');

        const rebuild = createOrUpdateChart(old, 'c7', config());
        assert.notEqual(rebuild, old);
        assert.equal(old.destroyed, false, 'still on screen');
        await paint();
        assert.equal(old.destroyed, true);
        assert.equal(rebuild.chart, FakeChart.built[1]);
        assert.equal(createOrUpdateChart(rebuild, 'c7', config()), FakeChart.built[1], 'current again: updated in place');
    });

    it('drops a rebuild whose canvas is gone, with the chart it was to replace', async () => {
        canvas('c12');
        const first = createOrUpdateChart(null, 'c12', config());
        await paint();
        const old = first.chart;
        tokens = { ...tokens, '--tx-dim': '#4a5550' };
        docListeners.themechange();
        createOrUpdateChart(old, 'c12', config());
        elements.delete('c12'); // the page re-rendered without its chart
        await paint();
        assert.equal(old.destroyed, true);
        assert.equal(FakeChart.built.length, 1, 'nothing new built');
    });

    it('does not rebuild charts when the palette did not change', async () => {
        canvas('c8');
        const handle = createOrUpdateChart(null, 'c8', config());
        await paint();
        docListeners.themechange();
        assert.equal(createOrUpdateChart(handle, 'c8', config()), handle.chart);
        assert.equal(FakeChart.built.length, 1);
    });

    it('builds at once where there are no frames (headless tests)', () => {
        delete global.requestAnimationFrame;
        canvas('c9');
        const chart = createOrUpdateChart(null, 'c9', config());
        assert.ok(chart instanceof FakeChart);
        canvas('c10', { width: 0 });
        assert.equal(createOrUpdateChart(null, 'c10', config()), null, 'a hidden canvas waits for a later render');
        delete global.Chart;
        assert.equal(createOrUpdateChart(null, 'c9', config()), null, 'no engine, no chart');
    });

    it('rebuilds a chart whose canvas was replaced', async () => {
        canvas('c11');
        const handle = createOrUpdateChart(null, 'c11', config());
        await paint();
        const old = handle.chart;
        canvas('c11'); // the page re-rendered its markup
        const next = createOrUpdateChart(old, 'c11', config());
        assert.equal(old.destroyed, true, 'its canvas is gone');
        await paint();
        assert.equal(next.chart, FakeChart.built[1]);
        assert.equal(next.chart.canvas, elements.get('c11'));
    });
});

describe('withAlpha', () => {
    it('applies an opacity to hex, rgb() and rgba() colours', () => {
        assert.equal(withAlpha('#55c97f', 0.1), 'rgba(85, 201, 127, 0.1)');
        assert.equal(withAlpha(' #FFFFFF ', 0.5), 'rgba(255, 255, 255, 0.5)');
        assert.equal(withAlpha('rgb(1, 2, 3)', 0.25), 'rgba(1, 2, 3, 0.25)');
        assert.equal(withAlpha('rgba(1,2,3,0.9)', 0.25), 'rgba(1, 2, 3, 0.25)');
    });

    it('returns anything else unchanged', () => {
        assert.equal(withAlpha('transparent', 0.5), 'transparent');
        assert.equal(withAlpha('#abc', 0.5), '#abc');
    });
});

describe('getChartAnimationConfig', () => {
    it('eases data changes and never animates a resize', () => {
        const animation = getChartAnimationConfig();
        assert.ok(animation.animation.duration > 0);
        assert.equal(animation.transitions.resize.animation.duration, 0);
        assert.notEqual(getChartAnimationConfig(), animation, 'a fresh object each call');
    });
});
