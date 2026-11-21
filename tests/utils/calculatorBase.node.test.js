import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    invalidateRenders,
    isCalculatorActive,
    markRendered,
    needsRender,
    owesRender,
    registerCalculator,
    updateCalculatorIfActive
} from '../../js/utils/calculatorBase.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

const panels = new Map();

beforeEach(() => {
    panels.clear();
    global.document = {
        getElementById: id => panels.get(id) ?? null
    };
});

function panel(active) {
    return {
        classList: {
            contains: className => className === 'active' && active
        }
    };
}

describe('calculator render lifecycle', () => {
    it('recognizes only the visible calculator panel as active', () => {
        panels.set('wave-tab', panel(true));
        panels.set('surge-tab', panel(false));

        assert.equal(isCalculatorActive('wave'), true);
        assert.equal(isCalculatorActive('surge'), false);
        assert.equal(isCalculatorActive('missing'), false);
        assert.equal(isCalculatorActive(null), false);
    });

    it('renders the active calculator', () => {
        panels.set('wave-tab', panel(true));
        let renders = 0;

        const rendered = updateCalculatorIfActive('wave', () => { renders += 1; });

        assert.equal(rendered, true);
        assert.equal(renders, 1);
    });

    it('defers hidden calculator renders', () => {
        panels.set('wave-tab', panel(false));
        let renders = 0;

        const rendered = updateCalculatorIfActive('wave', () => { renders += 1; });

        assert.equal(rendered, false);
        assert.equal(renders, 0);
    });

    it('defensively ignores an invalid render callback', () => {
        panels.set('wave-tab', panel(true));
        assert.equal(updateCalculatorIfActive('wave', null), false);
    });

    it('defers deck-update renders until the calculator is active', async () => {
        panels.set('lifecycle-test-tab', panel(false));
        let renders = 0;
        const originalLands = DeckConfig.getDeckConfig().lands;

        registerCalculator({
            name: 'lifecycle-test',
            updateUI: () => { renders += 1; },
            inputs: []
        });

        DeckConfig.updateField('lands', originalLands + 1);
        await new Promise(resolve => setTimeout(resolve, 180));
        assert.equal(renders, 0, 'hidden calculator should not render');

        panels.set('lifecycle-test-tab', panel(true));
        DeckConfig.updateField('lands', originalLands);
        await new Promise(resolve => setTimeout(resolve, 180));
        assert.equal(renders, 1, 'active calculator should render');
    });
});

describe('revisit stamps', () => {
    it('renders a page the router has never rendered', () => {
        assert.equal(needsRender('never-rendered'), true);
    });

    it('skips a revisit when nothing the page shows has changed', () => {
        markRendered('quiet');
        assert.equal(needsRender('quiet'), false);
        assert.equal(needsRender('quiet'), false, 'asking does not change the answer');
    });

    it('renders every page again after shared state changes', () => {
        markRendered('first');
        markRendered('second');
        invalidateRenders();
        assert.equal(needsRender('first'), true);
        assert.equal(needsRender('second'), true);
        markRendered('first');
        assert.equal(needsRender('first'), false);
        assert.equal(needsRender('second'), true, 'each page is current only once it renders');
    });

    it('renders a page that wanted to render while it was hidden', () => {
        panels.set('wave-tab', panel(true));
        markRendered('wave');
        assert.equal(isCalculatorActive('wave'), true);
        assert.equal(needsRender('wave'), false, 'a visible page renders itself and owes nothing');

        panels.set('wave-tab', panel(false));
        let renders = 0;
        updateCalculatorIfActive('wave', () => { renders += 1; });
        assert.equal(renders, 0);
        assert.equal(needsRender('wave'), true, 'the skipped render is owed');

        markRendered('wave');
        assert.equal(needsRender('wave'), false, 'rendering pays it');
    });

    it('records misses reported directly (a chart that could not be built)', () => {
        markRendered('vortex');
        owesRender('vortex');
        assert.equal(needsRender('vortex'), true);
    });

    it('ignores a miss without a page name', () => {
        markRendered('portent');
        owesRender(null);
        owesRender('');
        owesRender(undefined);
        assert.equal(needsRender('portent'), false);
    });
});
