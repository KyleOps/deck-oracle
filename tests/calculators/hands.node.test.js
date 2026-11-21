import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';

import * as Hands from '../../js/calculators/hands.js';
import { template, styles, guide } from '../../js/views/hands.js';
import { GLOSSARY } from '../../js/data/glossary.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import { landDistribution, landsInRangeChance, DEFAULT_RULE } from '../../js/utils/handLab.js';

// Module state persists across tests, so these run in order on the built-in
// example deck (a 99-card Commander list that includes its commander).

describe('Opening Hands calculator', () => {
    it('exports the calculator contract', () => {
        for (const fn of ['init', 'updateUI', 'calculate', 'getShareParams', 'applyShareParams']) {
            assert.strictEqual(typeof Hands[fn], 'function', fn);
        }
    });

    it('deals from the library without the commander', () => {
        const r = Hands.calculate();
        const lands = Object.values(DEFAULT_DECK_DATA.cardsByName).filter(c => c.category === 'lands').reduce((s, c) => s + c.count, 0);
        assert.strictEqual(r.N, DEFAULT_DECK_DATA.actualCardCount - 1);
        assert.strictEqual(r.L, lands);
    });

    it('reports the exact keepable chance for the default lands-only rule', () => {
        const r = Hands.calculate();
        assert.strictEqual(r.exact, true);
        assert.strictEqual(r.keepable, landsInRangeChance(r.N, r.L, DEFAULT_RULE));
        assert.deepStrictEqual(r.dist, landDistribution(r.N, r.L));
        assert.ok(Math.abs(r.averageLands - (7 * r.L) / r.N) < 1e-12);
    });

    it('simulates 10,000 games with the Commander free mulligan, quickly', () => {
        const r = Hands.calculate();
        assert.strictEqual(r.sim.games, 10000);
        const total = Object.values(r.sim.keptAt).reduce((s, n) => s + n, 0);
        assert.strictEqual(total, 10000);
        // A free first mulligan keeps far more sevens than the first-hand keepable share
        assert.ok(r.sim.keptAt[7] / r.sim.games > r.keepable);
        assert.ok(r.ms < 250, `simulation took ${r.ms.toFixed(1)}ms`);
    });

    it('caches per deck and rule', () => {
        assert.strictEqual(Hands.calculate(), Hands.calculate());
    });

    it('has no share params at the defaults', () => {
        assert.deepStrictEqual(Hands.getShareParams(), {});
    });

    it('applies share params, clamping and rejecting junk', () => {
        Hands.applyShareParams(new URLSearchParams('hmin=abc&hmax=-2&hplay=9'));
        assert.deepStrictEqual(Hands.getSettings().rule, { ...DEFAULT_RULE });

        Hands.applyShareParams(new URLSearchParams('hmin=3&hmax=12&hplay=2&hdraw=1'));
        assert.deepStrictEqual(Hands.getSettings(), { rule: { minLands: 3, maxLands: 7, playBy: 2 }, onPlay: false });
        assert.deepStrictEqual(Hands.getShareParams(), { hmin: 3, hmax: 7, hplay: 2, hdraw: 1 });
    });

    it('re-answers when the rule changes, and the play rule makes it simulated', () => {
        const r = Hands.calculate();
        assert.strictEqual(r.exact, false);
        assert.strictEqual(r.keepable, r.sim.firstKeepable);
        assert.ok(r.keepable <= r.exactKeepable + 0.02, 'adding a requirement cannot make more hands keepable');
        assert.strictEqual(r.exactKeepable, landsInRangeChance(r.N, r.L, { minLands: 3, maxLands: 7 }));
    });

    it('min above max drags max up', () => {
        Hands.applyShareParams(new URLSearchParams('hmin=5&hmax=2&hplay=0'));
        assert.deepStrictEqual(Hands.getSettings().rule, { minLands: 5, maxLands: 5, playBy: 0 });
        Hands.applyShareParams(new URLSearchParams('hmin=2&hmax=4&hplay=0'));
        assert.deepStrictEqual(Hands.getSettings().rule, { ...DEFAULT_RULE });
    });
});

describe('Opening Hands view', () => {
    it('has every container the calculator renders into', () => {
        for (const id of ['hl-summary', 'hl-toolbar', 'hl-prompt', 'hl-cards', 'hl-field', 'hl-field-head', 'hl-lane',
            'hl-readout', 'hl-min-lands', 'hl-max-lands', 'hl-play-hint', 'hl-order-group', 'hl-format', 'hl-stats', 'hl-stats-meta']) {
            assert.ok(template.includes(`id="${id}"`), id);
        }
        assert.ok(!/<h1/i.test(template), 'the shared header owns the title');
        assert.ok(!/style="/.test(template), 'no inline layout styles');
    });

    it('scopes its styles to the page and uses tokens only', () => {
        // Every selector, including the first one inside an @media / @container block
        const rules = styles.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[{}])\s*([^{}@;]+)\{/g) ?? [];
        assert.ok(rules.length > 50, 'found the rules');
        for (const r of rules) {
            const selector = r.replace(/^[{}]/, '').replace(/\{$/, '').trim();
            if (/^(from|to|\d+%)$/.test(selector)) continue; // keyframe steps
            selector.split(',').forEach(s => assert.ok(s.trim().startsWith('#hands-tab'), `unscoped selector: ${s.trim()}`));
        }
        assert.ok(!/#[0-9a-f]{3,8}\b(?![\w-])/i.test(styles.replace(/#hands-tab/g, '')), 'no literal hex colours');
        assert.match(styles, /prefers-reduced-motion/);
    });

    it('has a complete guide whose terms exist in the glossary', () => {
        for (const field of ['intro', 'howToRead', 'method', 'assumptions', 'tips', 'terms']) {
            assert.ok(guide[field] && guide[field].length > 0, field);
        }
        guide.terms.forEach(t => assert.ok(GLOSSARY[t], `unknown glossary term ${t}`));
    });
});
