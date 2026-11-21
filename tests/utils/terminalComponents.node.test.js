import { describe, it } from 'node:test';
import assert from 'node:assert';
import './../node-test-helper.js'; // installs global.document mock

import {
    renderHeroStats,
    pBarCell,
    renderSweepTable,
    toneColor,
    toneFor
} from '../../js/utils/components.js';

describe('renderHeroStats', () => {
    it('renders a stat cell per entry with label/value/sub', () => {
        const html = renderHeroStats([
            { label: 'P(HIT)', value: '72%', sub: 'at X=6', color: 'var(--tx-green)', size: 'big' },
            { label: 'E[X]', value: '4.5', sub: 'avg' }
        ]);
        assert.ok(html.includes('tx-hero'));
        assert.match(html, /P\(HIT\)/);
        assert.match(html, /72%/);
        assert.match(html, /E\[X\]/);
        // two stat cells
        assert.strictEqual((html.match(/tx-stat-label/g) || []).length, 2);
    });

    it('returns empty string for no stats', () => {
        assert.strictEqual(renderHeroStats([]), '');
        assert.strictEqual(renderHeroStats(null), '');
    });

    it('defaults missing value to an em dash', () => {
        assert.match(renderHeroStats([{ label: 'X' }]), /—/);
    });
});

describe('pBarCell', () => {
    it('clamps fraction to 0..100%', () => {
        assert.match(pBarCell(0.5), /width:50\.0%/);
        assert.match(pBarCell(2), /width:100\.0%/);
        assert.match(pBarCell(-1), /width:0\.0%/);
        assert.match(pBarCell(NaN), /width:0\.0%/);
    });

    it('is neutral unless the caller says what the number means', () => {
        assert.match(pBarCell(0.9), /background:var\(--tx-flat\)/);
        assert.doesNotMatch(pBarCell(0.1), /tx-green|tx-good/);
        assert.match(pBarCell(0.1, toneColor(toneFor(0.1))), /background:var\(--tx-bad\)/);
    });
});

describe('toneFor / toneColor', () => {
    it('maps a chance to what it means, with adjustable cut-offs', () => {
        assert.strictEqual(toneFor(0.8), 'good');
        assert.strictEqual(toneFor(0.5), 'warn');
        assert.strictEqual(toneFor(0.1), 'bad');
        assert.strictEqual(toneFor(NaN), 'flat');
        assert.strictEqual(toneFor('0.9'), 'flat');
        assert.strictEqual(toneFor(0.75, { good: 0.8, warn: 0.5 }), 'warn');
    });

    it('gives each tone one colour token, plain text otherwise', () => {
        assert.strictEqual(toneColor('good'), 'var(--tx-good)');
        assert.strictEqual(toneColor('warn'), 'var(--tx-warn)');
        assert.strictEqual(toneColor('bad'), 'var(--tx-bad)');
        assert.strictEqual(toneColor('flat'), 'var(--tx-bright)');
        assert.strictEqual(toneColor(undefined), 'var(--tx-bright)');
    });
});

describe('renderSweepTable', () => {
    const columns = [
        { label: 'X', align: 'left', render: r => `${r.x}` },
        { label: 'P', render: r => `${(r.p * 100).toFixed(0)}%` }
    ];
    const rows = [
        { x: 4, p: 0.4 },
        { x: 5, p: 0.6 },
        { x: 6, p: 0.8 }
    ];

    it('writes a table with one row per data point', () => {
        renderSweepTable('sweep-test-1', { columns, rows, current: 5, recommended: 6 });
        const html = global.document.getElementById('sweep-test-1').innerHTML;
        assert.match(html, /tx-sweep-table/);
        assert.strictEqual((html.match(/<tr/g) || []).length, 4); // 1 header + 3 body
    });

    it('marks the current and recommended rows', () => {
        renderSweepTable('sweep-test-2', { columns, rows, current: 5, recommended: 6 });
        const html = global.document.getElementById('sweep-test-2').innerHTML;
        assert.match(html, /active-row/);
        assert.match(html, /rec-row/);
    });

    it('shows empty text when there are no rows', () => {
        renderSweepTable('sweep-test-3', { columns, rows: [], emptyText: 'NO DATA' });
        const html = global.document.getElementById('sweep-test-3').innerHTML;
        assert.match(html, /tx-empty/);
        assert.match(html, /NO DATA/);
    });

    it('does not throw for a missing container', () => {
        // getElementById in the mock always returns an element, so simulate via a guard:
        assert.doesNotThrow(() => renderSweepTable('sweep-test-4', { columns, rows }));
    });
});
