// createOpponentPage(): the page the three multiplayer pages share (Mara,
// Dream Harvest, Mind's Dilation). Their markup and maths are tested in
// tests/calculators/opponentPages.node.test.js and tests/models/; this is the
// behaviour around them — caching, render gating, layouts and sample casts —
// against a fake opponent state and a small fake DOM.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createOpponentPage, opponentTableHTML, sampleCastsHTML, sectionHeadHTML } from '../../js/utils/opponentPages.js';

/** Elements by id, created on first use; `firstElementChild` follows innerHTML. */
function fakeDocument() {
    const elements = new Map();
    const make = id => {
        const listeners = {};
        return {
            id,
            innerHTML: '',
            hidden: false,
            checked: false,
            clientWidth: 1000,
            dataset: {},
            classList: { contains: c => c === 'active' && id.endsWith('-tab') },
            get firstElementChild() { return this.innerHTML.trim() ? {} : null; },
            addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
            fire(type, event) { (listeners[type] ?? []).forEach(fn => fn(event)); }
        };
    };
    return {
        elements,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, make(id));
            return elements.get(id);
        },
        querySelectorAll: () => [],
        querySelector: () => null
    };
}

const deckA = { name: 'Deck A' };
const deckB = { name: 'Deck B' };
const opp = (key, index, data) => ({ key, index, data, name: data.name, color: `var(--seat-${index})` });

function stateWith(opponents, { loading = [], errors = [] } = {}) {
    return { opponents, loading, errors, signature: `${opponents.map(o => o.key).join(',')}|${loading.join(',')}` };
}

/** A page over a fake model that records what it was asked. */
function testPage(overrides = {}) {
    const calls = { stats: [], summarize: 0, draw: 0, render: [] };
    let state = stateWith([]);
    let settings = {};
    const page = createOpponentPage({
        key: 'testpage',
        read: () => state,
        settings: () => settings,
        stats: (data, s) => {
            calls.stats.push([data.name, JSON.stringify(s)]);
            return data.name === 'Broken' ? null : { value: data.name.length, doubled: Boolean(s.double) };
        },
        statsKey: s => (s.double ? 'double' : 'plain'),
        summarize: rows => {
            calls.summarize += 1;
            return { html: `${rows.length} opponents`, tone: 'flat' };
        },
        hero: rows => `<div class="hero">${rows.map(r => r.stats.value).join('+')}</div>`,
        sections: (rows, { panel, settings: s }) => `<section data-panel="${panel.id}" data-double="${Boolean(s.double)}">${rows.map(r => r.name).join(',')}</section>`,
        placeholder: { title: 'No opponents yet', lead: 'Load some.', steps: [] },
        sample: {
            panel: 'testpage-samples',
            count: 6,
            batch: 2,
            draw: o => {
                calls.draw += 1;
                return Array.from({ length: 6 }, (_, i) => `${o.name} #${i + 1} (draw ${calls.draw})`);
            },
            render: (opponents, samples, shown) => {
                calls.render.push(shown);
                return samples.map(list => list.slice(0, shown).join(';')).join('|');
            }
        },
        ...overrides
    });
    return {
        page,
        calls,
        setState: next => { state = next; },
        setSettings: next => { settings = next; }
    };
}

describe('createOpponentPage', () => {
    let doc;
    beforeEach(() => {
        doc = fakeDocument();
        globalThis.document = doc;
    });

    it('shows the placeholder and hides the samples without opponents', () => {
        const { page } = testPage();
        assert.deepEqual(page.calculate(), {});
        page.updateUI();
        assert.match(doc.getElementById('testpage-results').innerHTML, /No opponents yet/);
        assert.match(doc.getElementById('testpage-results').innerHTML, /Load example opponents/);
        assert.equal(doc.getElementById('testpage-samples').hidden, true);
        assert.equal(doc.getElementById('testpage-samples').innerHTML, '');
    });

    it('shows a loading state while imports are running', () => {
        const { page, setState } = testPage();
        setState(stateWith([], { loading: ['opponent1'] }));
        page.updateUI();
        assert.match(doc.getElementById('testpage-results').innerHTML, /Loading an opponent’s deck/);
    });

    it('renders the answer, caches stats per deck and skips opponents the model cannot read', () => {
        const { page, calls, setState } = testPage();
        setState(stateWith([opp('opponent1', 0, deckA), opp('opponent2', 1, { name: 'Broken' }), opp('opponent3', 2, deckB)]));
        page.updateUI();
        const html = doc.getElementById('testpage-results').innerHTML;
        assert.match(html, /2 opponents/, 'the bottom line sees the two readable decks');
        assert.match(html, /<div class="hero">6\+6<\/div>/);
        assert.match(html, /<section data-panel="testpage-results" data-double="false">Deck A,Deck B<\/section>/);
        assert.deepEqual(page.calculate(), { opponent1: { value: 6, doubled: false }, opponent3: { value: 6, doubled: false } });
        assert.equal(calls.stats.length, 3, 'one model run per deck, then cached');
        assert.deepEqual(page.rows().map(r => r.name), ['Deck A', 'Deck B']);
        assert.deepEqual(page.readInputs().opponents.map(o => o.key), ['opponent1', 'opponent2', 'opponent3']);
    });

    it('renders only when the opponents or settings change', () => {
        const { page, calls, setState, setSettings } = testPage();
        setState(stateWith([opp('opponent1', 0, deckA)]));
        page.updateUI();
        page.updateUI();
        assert.equal(calls.summarize, 1, 'same opponents, same settings: nothing to do');

        setSettings({ double: true });
        page.updateUI();
        assert.equal(calls.summarize, 2);
        assert.deepEqual(calls.stats.at(-1), ['Deck A', '{"double":true}'], 'stats keyed on the settings they use');
        assert.match(doc.getElementById('testpage-results').innerHTML, /data-double="true"/);
        assert.equal(page.readInputs().double, true, 'settings are part of readInputs()');

        doc.getElementById('testpage-results').innerHTML = '';
        page.updateUI();
        assert.equal(calls.summarize, 3, 'an emptied panel renders again');
    });

    it('splits the answer and the evidence, and shows the options, with a detail layout', () => {
        const { page, setState } = testPage({ layout: { summary: 'tp-summary', detail: 'tp-detail', options: 'tp-options' } });
        page.updateUI();
        assert.equal(doc.getElementById('tp-options').hidden, true);
        assert.equal(doc.getElementById('tp-detail').innerHTML, '');

        setState(stateWith([opp('opponent1', 0, deckA)]));
        page.updateUI();
        assert.equal(doc.getElementById('tp-options').hidden, false);
        assert.match(doc.getElementById('tp-summary').innerHTML, /1 opponents/);
        assert.doesNotMatch(doc.getElementById('tp-summary').innerHTML, /<section/);
        assert.match(doc.getElementById('tp-detail').innerHTML, /<section data-panel="tp-summary"/);
    });

    it('keeps sample casts until Reshuffle, and shows more a batch at a time', () => {
        const { page, calls, setState } = testPage();
        setState(stateWith([opp('opponent1', 0, deckA), opp('opponent3', 2, deckB)]));
        page.updateUI();
        const panel = doc.getElementById('testpage-samples');
        assert.equal(panel.hidden, false);
        assert.equal(panel.innerHTML, 'Deck A #1 (draw 1);Deck A #2 (draw 1)|Deck B #1 (draw 2);Deck B #2 (draw 2)');

        page.sampleAction('more');
        page.sampleAction('more');
        page.sampleAction('more');
        assert.deepEqual(calls.render, [2, 4, 6, 6], 'never more than were drawn');
        assert.equal(calls.draw, 2, 'showing more reuses the shuffles');

        page.sampleAction('reshuffle');
        assert.equal(calls.draw, 4, 'new shuffles for every opponent');
        assert.match(panel.innerHTML, /\(draw 3\)/);
        page.sampleAction('nonsense');
        assert.equal(calls.render.length, 5);

        // A new render starts from the first batch again, and drops decks that left.
        setState(stateWith([opp('opponent1', 0, deckA)]));
        page.updateUI();
        assert.equal(calls.render.at(-1), 2);
        assert.equal(calls.draw, 4, 'Deck A keeps its shuffles');
    });

    it('wires the page once: sample buttons and the page’s own controls', () => {
        let bound = null;
        const { page, calls, setState } = testPage({ bind: (root, p) => { bound = [root.id, p]; } });
        setState(stateWith([opp('opponent1', 0, deckA)]));
        page.init();
        assert.deepEqual(bound, ['testpage-tab', page]);
        const root = doc.getElementById('testpage-tab');
        assert.equal(root.dataset.oppBound, 'true', 'the placeholder buttons are bound too');

        page.updateUI();
        const button = action => ({ target: { closest: sel => (sel === '[data-opp-sample]' ? { dataset: { oppSample: action } } : null) } });
        root.fire('click', button('reshuffle'));
        assert.equal(calls.draw, 2);
        root.fire('click', { target: { closest: () => null } });
        assert.equal(calls.draw, 2, 'other clicks are ignored');
    });

    it('works without sample casts', () => {
        const { page, setState } = testPage({ sample: undefined });
        setState(stateWith([opp('opponent1', 0, deckA)]));
        page.updateUI();
        page.sampleAction('reshuffle');
        assert.match(doc.getElementById('testpage-results').innerHTML, /1 opponents/);
    });
});

describe('multiplayer markup helpers', () => {
    it('section heads, tables and sample panels', () => {
        assert.match(sectionHeadHTML('Opponent by opponent', 'Exact odds'), /<h2 class="opp-section-title">Opponent by opponent<\/h2>\s*<span class="opp-section-sub">Exact odds<\/span>/);
        assert.doesNotMatch(sectionHeadHTML('Title'), /opp-section-sub/);

        const table = opponentTableHTML({ head: ['Opponent', 'Hit chance'], body: '<tr><td>A</td></tr>' });
        assert.match(table, /<th scope="col">Opponent<\/th><th scope="col">Hit chance<\/th>/);
        assert.doesNotMatch(table, /tfoot/);
        assert.match(opponentTableHTML({ head: [], body: '', foot: '<td>All</td>' }), /<tfoot><tr><td>All<\/td><\/tr><\/tfoot>/);

        const samples = sampleCastsHTML({ sub: 'Real shuffles.', games: '<div>g</div>', more: true, before: '<i>cols</i>' });
        assert.match(samples, /data-opp-sample="reshuffle"/);
        assert.match(samples, /data-opp-sample="more">Show more casts/);
        assert.match(samples, /<i>cols<\/i>\s*<div class="opp-games"><div>g<\/div><\/div>/);
        assert.doesNotMatch(sampleCastsHTML({ sub: '', games: '' }), /data-opp-sample="more"/);
    });
});
