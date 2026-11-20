import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { drawTypeMin } from '../../js/utils/hypergeometric.js';
import { MAX_TURN, MAX_NEED } from '../../js/utils/drawOdds.js';
import * as Odds from '../../js/calculators/odds.js';
import { guide, template, styles } from '../../js/views/odds.js';

const FIRST_CARD = 'Aesi, Tyrant of Gyre Strait';

function reset() {
    DeckConfig.resetForTests();
    Odds.applyShareParams(new URLSearchParams('turn=3&draw=0&g1=1~~r:ramp'));
}

describe('Draw Odds calculator', () => {
    Odds.init();

    beforeEach(reset);

    it('focusCard preselects group A as that one card', () => {
        Odds.focusCard('aesi, tyrant of gyre strait');
        const s = Odds.getState();
        assert.strictEqual(s.groups.length, 1);
        assert.deepStrictEqual(s.groups[0].cards, [FIRST_CARD]);
        assert.strictEqual(s.groups[0].need, 1);

        const { result, library } = Odds.calculate();
        // The commander starts in the command zone: a 98-card library.
        assert.strictEqual(library.size, 98);
        assert.strictEqual(result.groups.length, 1);
        result.turns.forEach(t => {
            assert.ok(Math.abs(t.all - drawTypeMin(98, 1, t.seen, 1)) < 1e-12);
        });
        assert.strictEqual(result.turns.length, MAX_TURN + 1);
    });

    it('focusCard ignores junk', () => {
        Odds.focusCard('');
        Odds.focusCard(null);
        assert.strictEqual(Odds.getState().groups[0].key, 'ramp');
    });

    it('share params round-trip', () => {
        Odds.applyShareParams(new URLSearchParams(`turn=6&g1=2~Two%20lands~t:lands&g2=1~~r:wipe&g3=1~Big%20guys~c:${encodeURIComponent(FIRST_CARD)}`));
        const params = Odds.getShareParams();
        assert.deepStrictEqual(params, {
            turn: 6,
            g1: '2~Two lands~t:lands',
            g2: '1~~r:wipe',
            g3: `1~Big guys~c:${FIRST_CARD}`
        });
        const before = Odds.getState();
        reset();
        Odds.applyShareParams(new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])));
        assert.deepStrictEqual(Odds.getState().groups, before.groups);
        assert.strictEqual(Odds.getState().turn, 6);
    });

    it('matches shared card names to the deck', () => {
        Odds.applyShareParams(new URLSearchParams(`g1=1~~c:${encodeURIComponent('AESI, TYRANT OF GYRE STRAIT')}|Black%20Lotus`));
        const g = Odds.getState().groups[0];
        assert.deepStrictEqual(g.cards, [FIRST_CARD, 'Black Lotus']);
        // Cards not in the deck stay visible but never count.
        const { result } = Odds.calculate();
        assert.strictEqual(result.groups[0].copies, 1);
    });

    it('validates and clamps hostile params', () => {
        Odds.applyShareParams(new URLSearchParams('turn=99&g1=99~~r:ramp'));
        assert.strictEqual(Odds.getState().turn, MAX_TURN);
        assert.strictEqual(Odds.getState().groups[0].need, MAX_NEED);

        Odds.applyShareParams(new URLSearchParams('turn=-4&g1=%3Cscript%3E&g2=1~~r:delete&g4=1~~r:wipe'));
        const s = Odds.getState();
        assert.strictEqual(s.turn, MAX_TURN); // unchanged
        assert.strictEqual(s.groups.length, 1); // bad groups and g4 ignored
        assert.strictEqual(s.groups[0].key, 'ramp');

        Odds.applyShareParams(null);
        Odds.applyShareParams({});
        assert.strictEqual(Odds.getState().groups[0].key, 'ramp');
    });

    it('remembers on the draw', () => {
        Odds.applyShareParams(new URLSearchParams('draw=1'));
        assert.strictEqual(Odds.getShareParams().draw, 1);
        // Commander ignores turn order: everyone draws.
        const { onPlay } = Odds.calculate();
        assert.strictEqual(onPlay, true);
    });

    it('falls back to copy counts without a card list', () => {
        DeckConfig.updateDeck({ cardsByName: {}, cardDetails: [], actualCardCount: null, commanderName: null });
        Odds.applyShareParams(new URLSearchParams(`g1=1~~t:lands&g2=1~~c:${encodeURIComponent(FIRST_CARD)}&g3=2~Ramp~n:12`));
        const s = Odds.getState();
        assert.deepStrictEqual(s.groups.map(g => g.kind), ['type', 'manual']);
        const { result, library } = Odds.calculate();
        assert.strictEqual(library.manual, true);
        assert.strictEqual(result.groups[0].copies, DeckConfig.getDeckConfig().lands);
        assert.strictEqual(result.groups[1].copies, 12);
        assert.ok(result.turns[3].all > 0 && result.turns[3].all < 1);
    });
});

describe('Draw Odds view', () => {
    it('exports a template, scoped styles and a guide', () => {
        assert.match(template, /id="odds-chart"/);
        assert.match(template, /id="odds-groups"/);
        // Every rule is scoped to the page.
        const selectors = styles.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g)
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('@'));
        selectors.forEach(s => s.split(',').forEach(part => assert.match(part.trim(), /^#odds-tab\b/, part)));
        // Tokens only: no literal colours.
        assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b(?![\w-])/i);
        assert.ok(guide.intro && guide.method && guide.howToRead.length && guide.assumptions.length);
    });
});
