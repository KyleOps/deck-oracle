import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALCULATORS, getCalculator } from '../../js/utils/calculatorRegistry.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('calculator registry', () => {
    it('provides one complete entry for every calculator tab', () => {
        const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
        const tabNames = [...html.matchAll(/class="tx-tab[^"]*"[^>]*data-tab="([^"]+)"/g)]
            .map(match => match[1])
            .sort();
        const registryNames = Object.keys(CALCULATORS).sort();

        assert.deepEqual(registryNames, tabNames);
    });

    it('exposes the lifecycle functions required by the app shell', () => {
        Object.entries(CALCULATORS).forEach(([key, calculator]) => {
            assert.equal(typeof calculator.name, 'string', `${key} needs a display name`);
            assert.equal(typeof calculator.group, 'string', `${key} needs a group`);
            assert.equal(typeof calculator.module.init, 'function', `${key} needs init()`);
            assert.equal(typeof calculator.module.updateUI, 'function', `${key} needs updateUI()`);
        });
    });

    it('starts with the active tab button and panel in sync', () => {
        const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
        const activeButton = html.match(/class="tx-tab active"[^>]*data-tab="([^"]+)"/)?.[1];
        const activePanel = html.match(/id="([^"]+)-tab" class="tab-content active"/)?.[1];

        assert.equal(activeButton, 'wildpair');
        assert.equal(activePanel, activeButton);
    });

    it('returns null for unknown calculator names', () => {
        assert.equal(getCalculator('wave'), CALCULATORS.wave);
        assert.equal(getCalculator('unknown'), null);
    });
});
