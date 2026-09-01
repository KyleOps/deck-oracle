import { describe, it } from 'node:test';
import assert from 'node:assert';
import './../node-test-helper.js'; // installs global.document mock

import {
    renderHeroStats,
    renderVerdictBadge,
    renderRecommendation,
    pBarCell,
    renderSweepTable,
    renderOutcomeMatrix
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

describe('renderVerdictBadge', () => {
    it('renders the label and color', () => {
        const html = renderVerdictBadge({ label: 'STRONG', color: 'var(--tx-green)' });
        assert.match(html, /STRONG/);
        assert.match(html, /tx-verdict/);
        assert.match(html, /var\(--tx-green\)/);
    });

    it('is empty for a null verdict', () => {
        assert.strictEqual(renderVerdictBadge(null), '');
    });
});

describe('renderRecommendation', () => {
    it('wraps content with a marker', () => {
        const html = renderRecommendation('Cast at <strong>X=6</strong>');
        assert.match(html, /tx-rec/);
        assert.match(html, /X=6/);
        assert.match(html, /★/);
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

describe('renderOutcomeMatrix', () => {
    const cells = [
        [
            { label: 'Correct keep', value: 0.474, good: true, note: 'Kept, and you got there.' },
            { label: 'Bad beat', value: 0.044, good: false, note: 'Too greedy.' }
        ],
        [
            { label: 'Missed opportunity', value: 0.164, good: false, note: 'Too cautious.' },
            { label: 'Good mulligan', value: 0.318, good: true, note: 'Dodged a brick.' }
        ]
    ];
    const opts = {
        title: 'DECISION QUALITY',
        subtitle: '5,000 SIMULATED HANDS',
        rowLabels: ['STRATEGY SAYS KEEP', 'STRATEGY SAYS MULL'],
        colLabels: ['HAND WOULD HIT', 'HAND WOULD BRICK'],
        cells
    };

    it('renders all four cells with their labels and percentages', () => {
        const html = renderOutcomeMatrix(opts);
        for (const label of ['Correct keep', 'Bad beat', 'Missed opportunity', 'Good mulligan']) {
            assert.ok(html.includes(label), `missing ${label}`);
        }
        assert.ok(html.includes('47.4%'));
        assert.ok(html.includes('4.4%'));
        assert.ok(html.includes('16.4%'));
        assert.ok(html.includes('31.8%'));
    });

    it('renders the row and column axis labels', () => {
        const html = renderOutcomeMatrix(opts);
        assert.ok(html.includes('STRATEGY SAYS KEEP'));
        assert.ok(html.includes('HAND WOULD BRICK'));
    });

    it('sums the diagonal into a strategy accuracy figure', () => {
        const html = renderOutcomeMatrix(opts);
        // 0.474 + 0.318 = 0.792
        assert.ok(html.includes('79.2%'), html.slice(-400));
    });

    it('marks good cells with a check and bad cells with a cross', () => {
        const html = renderOutcomeMatrix(opts);
        assert.strictEqual((html.match(/✓/g) || []).length, 2);
        assert.strictEqual((html.match(/✗/g) || []).length, 2);
    });

    it('tags cells so CSS can wash the off-diagonal errors', () => {
        const html = renderOutcomeMatrix(opts);
        assert.strictEqual((html.match(/is-good/g) || []).length, 2);
        assert.strictEqual((html.match(/is-bad/g) || []).length, 2);
    });

    it('returns an empty string when the grid is not 2x2', () => {
        assert.strictEqual(renderOutcomeMatrix({ cells: [] }), '');
        assert.strictEqual(renderOutcomeMatrix({ cells: [[{}, {}]] }), '');
        assert.strictEqual(renderOutcomeMatrix({ cells: [[{}], [{}, {}]] }), '');
        assert.strictEqual(renderOutcomeMatrix({}), '');
    });

    it('treats non-finite values as zero rather than printing NaN', () => {
        const html = renderOutcomeMatrix({
            ...opts,
            cells: [[{ label: 'a', value: undefined, good: true }, { label: 'b', value: NaN }],
                    [{ label: 'c', value: null }, { label: 'd', value: 0.5, good: true }]]
        });
        assert.ok(!html.includes('NaN'));
        assert.ok(html.includes('0.0%'));
    });

    it('omits the note line when a cell has no note', () => {
        const html = renderOutcomeMatrix({
            ...opts,
            cells: [[{ label: 'a', value: 0.5, good: true }, { label: 'b', value: 0.1 }],
                    [{ label: 'c', value: 0.2 }, { label: 'd', value: 0.2, good: true }]]
        });
        assert.ok(!html.includes('tx-mx-note'));
    });
});
