import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { effectiveOnPlay, syncTurnOrder, turnOrderClicked, turnOrderHTML, turnOrderMatters } from '../../js/utils/turnOrder.js';
import { FORMATS } from '../../js/utils/format.js';

/** Just enough of an element for syncTurnOrder(): dataset, classes, attributes, hidden. */
function fakeButton(play) {
    const classes = new Set();
    const attrs = {};
    return {
        dataset: { play },
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) },
        setAttribute: (k, v) => { attrs[k] = v; },
        attrs
    };
}

function fakeGroup() {
    const buttons = [fakeButton('1'), fakeButton('0')];
    return {
        hidden: false,
        buttons,
        matches: sel => sel === '[data-turn-order]',
        querySelectorAll: sel => (sel === '[data-play]' ? buttons : [])
    };
}

describe('turn order rule', () => {
    it('matters only when the starting player skips a draw', () => {
        assert.equal(turnOrderMatters(FORMATS.commander), false);
        assert.equal(turnOrderMatters(FORMATS.constructed), true);
        assert.equal(turnOrderMatters(FORMATS.limited), true);
        assert.equal(turnOrderMatters(null), true, 'no format yet: show the choice');
    });

    it('uses the page’s choice only where it changes the answer', () => {
        assert.equal(effectiveOnPlay(false, FORMATS.constructed), false);
        assert.equal(effectiveOnPlay(true, FORMATS.constructed), true);
        assert.equal(effectiveOnPlay(false, FORMATS.commander), true, 'everyone draws: on the play');
        assert.equal(effectiveOnPlay(undefined, FORMATS.limited), true, 'default is on the play');
    });
});

describe('turnOrderHTML', () => {
    it('is a labelled button group with the choice pressed', () => {
        const html = turnOrderHTML({ onPlay: false, id: 'x-order', className: 'odds-order' });
        assert.match(html, /^<div class="seg seg-sm odds-order" id="x-order" role="group" aria-label="Turn order" data-turn-order>/);
        assert.match(html, /<button class="seg-btn" type="button" data-play="1" aria-pressed="false">On the play<\/button>/);
        assert.match(html, /<button class="seg-btn active" type="button" data-play="0" aria-pressed="true">On the draw<\/button>/);
        assert.doesNotMatch(html, /hidden/);
    });

    it('can start hidden, and becomes a field with a visible label and hint', () => {
        assert.match(turnOrderHTML({ hidden: true }), /data-turn-order hidden>/);
        const field = turnOrderHTML({ id: 'md-order-group', className: 'md-group', label: 'Turn order', hint: 'One card fewer.', hidden: true });
        assert.match(field, /^<div class="md-group" id="md-order-group" data-turn-order hidden>/);
        assert.match(field, /<span class="field-label" id="md-order-group-label">Turn order<\/span>/);
        assert.match(field, /role="group" aria-labelledby="md-order-group-label"/);
        assert.match(field, /<p class="field-hint">One card fewer.<\/p>/);
        assert.doesNotMatch(turnOrderHTML({ label: 'Turn order' }), /field-hint/);
    });
});

describe('syncTurnOrder', () => {
    it('presses the chosen button and hides the control where it changes nothing', () => {
        const group = fakeGroup();
        syncTurnOrder(group, false, FORMATS.constructed);
        assert.equal(group.hidden, false);
        assert.equal(group.buttons[0].attrs['aria-pressed'], 'false');
        assert.equal(group.buttons[1].attrs['aria-pressed'], 'true');
        assert.ok(group.buttons[1].classList.contains('active'));

        syncTurnOrder(group, true, FORMATS.commander);
        assert.equal(group.hidden, true);
        assert.equal(group.buttons[0].attrs['aria-pressed'], 'true');
        assert.ok(!group.buttons[1].classList.contains('active'));
    });

    it('finds the controls inside a page and ignores a missing root', () => {
        const group = fakeGroup();
        const page = { matches: () => false, querySelectorAll: sel => (sel === '[data-turn-order]' ? [group] : []) };
        syncTurnOrder(page, false, FORMATS.limited);
        assert.equal(group.buttons[1].attrs['aria-pressed'], 'true');
        assert.doesNotThrow(() => syncTurnOrder(null, true, FORMATS.limited));
    });
});

describe('turnOrderClicked', () => {
    const click = btn => ({ target: { closest: sel => (sel === '[data-turn-order] [data-play]' ? btn : null) } });

    it('reads the choice from a turn-order button, and nothing from anything else', () => {
        assert.equal(turnOrderClicked(click({ dataset: { play: '1' } })), true);
        assert.equal(turnOrderClicked(click({ dataset: { play: '0' } })), false);
        assert.equal(turnOrderClicked(click(null)), null);
        assert.equal(turnOrderClicked({ target: {} }), null, 'a text node or SVG without closest()');
        assert.equal(turnOrderClicked(null), null);
    });
});

describe('every page uses the one control', () => {
    const PAGES = ['overview', 'odds', 'manabase', 'hands', 'mulligan', 'lands', 'manadev'];
    const read = file => readFileSync(new URL(`../../js/${file}`, import.meta.url), 'utf8');

    for (const page of PAGES) {
        it(page, () => {
            const source = read(`calculators/${page}.js`) + read(`views/${page}.js`);
            assert.match(source, /turnOrderClicked\(/, 'reads clicks through turnOrderClicked()');
            assert.match(source, /turnOrderHTML\(/, 'renders turnOrderHTML()');
            assert.doesNotMatch(source, /firstPlayerDraws \? true :/, 'no hand-rolled effective turn order');
            assert.doesNotMatch(source, /data-(mb|md|ov)-play=|data-hl-play-first/, 'no page-specific toggle markup');
        });
    }
});
