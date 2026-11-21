import { describe, it } from 'node:test';
import assert from 'node:assert';
import './../node-test-helper.js'; // installs global.document mock

import {
    renderHeroStats,
    pBarCell,
    renderSweepTable
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
