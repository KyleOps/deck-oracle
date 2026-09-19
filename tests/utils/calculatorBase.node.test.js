import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isCalculatorActive,
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
