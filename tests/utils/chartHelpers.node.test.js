import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getChartAnimationConfig, withAlpha } from '../../js/utils/chartHelpers.js';

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
        const config = getChartAnimationConfig();
        assert.ok(config.animation.duration > 0);
        assert.equal(config.transitions.resize.animation.duration, 0);
        assert.notEqual(getChartAnimationConfig(), config, 'a fresh object each call');
    });
});
