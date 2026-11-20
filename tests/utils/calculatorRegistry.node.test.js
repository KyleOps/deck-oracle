import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../node-test-helper.js';
import {
    CALCULATORS, CALCULATOR_ORDER, GROUPS, DEFAULT_TAB, getCalculator, getGroup, loadCalculator, getLoadedModule
} from '../../js/utils/calculatorRegistry.js';
import { CARD_META } from '../../js/data/cards.js';
import { TRIGGER_CARDS } from '../../js/utils/deckRadar.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const METHODS = ['exact', 'simulation', 'exact + simulation', 'deck search'];

describe('calculator registry', () => {
    it('gives every entry complete navigation metadata', () => {
        const groupKeys = GROUPS.map(g => g.key);
        Object.entries(CALCULATORS).forEach(([key, c]) => {
            assert.equal(typeof c.name, 'string', `${key} needs a name`);
            assert.match(c.short, /^[A-Z]{2,3}$/, `${key} needs a 2–3 letter code`);
            assert.ok(groupKeys.includes(c.group), `${key} has an unknown group`);
            assert.ok(c.question?.endsWith('?'), `${key} needs a question`);
            assert.ok(c.summary?.length > 20, `${key} needs a summary`);
            assert.ok(METHODS.includes(c.method), `${key} has an unknown method`);
            assert.equal(typeof c.load, 'function', `${key} needs a module loader`);
            assert.equal(typeof c.view, 'function', `${key} needs a view loader`);
        });
    });

    it('has a module file, a view file and card art for every entry', () => {
        Object.entries(CALCULATORS).forEach(([key, c]) => {
            assert.ok(existsSync(path.join(projectRoot, `js/calculators/${key}.js`)), `missing js/calculators/${key}.js`);
            assert.ok(existsSync(path.join(projectRoot, `js/views/${key}.js`)), `missing js/views/${key}.js`);
            if (c.card) assert.ok(CARD_META[c.card], `${key} references unknown card ${c.card}`);
        });
    });

    it('uses unique short codes', () => {
        const codes = Object.values(CALCULATORS).map(c => c.short);
        assert.equal(new Set(codes).size, codes.length);
    });

    it('lists every calculator exactly once in navigation order, grouped', () => {
        assert.deepEqual([...CALCULATOR_ORDER].sort(), Object.keys(CALCULATORS).sort());
        const groupsInOrder = CALCULATOR_ORDER.map(k => CALCULATORS[k].group);
        const firstSeen = [...new Set(groupsInOrder)];
        assert.deepEqual(firstSeen, GROUPS.map(g => g.key).filter(k => firstSeen.includes(k)));
    });

    it('starts on the deck overview', () => {
        assert.equal(DEFAULT_TAB, 'overview');
        assert.ok(CALCULATORS[DEFAULT_TAB]);
    });

    it('registers every card calculator with the deck radar', () => {
        Object.entries(CALCULATORS)
            .filter(([, c]) => c.cardInDeck)
            .forEach(([key]) => assert.ok(TRIGGER_CARDS[key], `${key} is missing from TRIGGER_CARDS`));
    });

    it('returns null for unknown names, including prototype keys', () => {
        assert.equal(getCalculator('wave'), CALCULATORS.wave);
        assert.equal(getCalculator('unknown'), null);
        assert.equal(getCalculator('toString'), null);
        assert.equal(getGroup('engines').label, 'Engines');
        assert.equal(getGroup('nope'), null);
    });

    it('loads a calculator lazily and exposes its lifecycle', async () => {
        assert.equal(getLoadedModule('lands'), null);
        const record = await loadCalculator('lands');
        assert.equal(typeof record.module.init, 'function');
        assert.equal(typeof record.module.updateUI, 'function');
        assert.equal(typeof record.template, 'string');
        assert.ok(record.template.length > 0);
        assert.equal(getLoadedModule('lands'), record.module);
        // Second load is the cached record
        assert.equal(await loadCalculator('lands'), record);
    });

    it('rejects unknown calculators', async () => {
        await assert.rejects(() => loadCalculator('nope'), /Unknown calculator/);
    });
});
