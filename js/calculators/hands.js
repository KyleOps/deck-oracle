/**
 * Opening Hands — a hands-on sample-hand lab for any deck.
 *
 * All the rules (keep heuristic, London-mulligan bottoming, the mulligan
 * simulation and the sample game's state machine) live in utils/handLab.js and
 * are unit-tested there. This module holds the page state, renders it, and
 * wires clicks and keyboard shortcuts.
 *
 * The hand is rendered by reconciling one element per physical card, so a
 * card's image loads once and moves between zones (hand → battlefield)
 * instead of being rebuilt on every action.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats } from '../utils/components.js';
import { renderManaCost } from '../utils/mana.js';
import { escapeHtml, cardRef, term } from '../data/glossary.js';
import { libraryOf } from '../utils/library.js';
import { pct } from '../utils/text.js';
import * as Lab from '../utils/handLab.js';
import { cardImageUrl, findCard } from '../data/images.js';
import { effectiveOnPlay, syncTurnOrder, turnOrderClicked } from '../utils/turnOrder.js';

const NAME = 'hands';
const GAMES = 10000;
/** Direct CDN URL when the deck record has a Scryfall id, else a named lookup. */
const SCRYFALL_IMAGE = name =>
    cardImageUrl(findCard(DeckConfig.getImportedCardData().cardsByName, name) ?? name, 'normal');
const TYPE_VAR = {
    lands: 'land', creatures: 'creature', planeswalkers: 'planeswalker', battles: 'battle',
    artifacts: 'artifact', enchantments: 'enchantment', instants: 'instant', sorceries: 'sorcery'
};

let rule = { ...Lab.DEFAULT_RULE };
let onPlay = true;
let mode = 'sample'; // 'sample' | 'practice'
let lib = null;
let format = null;
let game = Lab.createGame([]);
let practiceAnswer = null; // { you: 'keep'|'mull', verdict, agree }
const tally = { hands: 0, agree: 0, youKept: 0, ruleKept: 0, recent: [] };

const simCache = new Map();
const cardEls = new Map();
let hoverPreview = false;
let debouncedUpdate = null;

const $ = id => document.getElementById(id);

// ── Library & numbers ────────────────────────────────────────────────────────

/**
 * The deck and the page's settings: the format, the library hands are dealt
 * from (stand-in cards for bare type counts), the keep rule and the turn order.
 * @returns {{format:Object, library:Object, rule:Object, onPlay:boolean}}
 */
export function readInputs() {
    const config = DeckConfig.getDeckConfig();
    const deckFormat = DeckConfig.getFormat();
    let library;
    if (DeckConfig.hasCardList()) {
        const source = libraryOf(config, { format: deckFormat });
        const commanderCards = source.commanders.length ? DeckConfig.getCommanders().map(c => c.card) : [];
        const built = Lab.buildLibrary(source, { commanderCards });
        library = { ...built, key: `${Lab.libraryKey(built.cards)}|${built.identity.join('')}` };
    } else {
        const built = Lab.buildPlaceholderLibrary(config);
        library = { ...built, key: `counts:${Lab.libraryKey(built.cards)}` };
    }
    return { format: deckFormat, library, rule: { ...rule }, onPlay: effectiveOnPlay(onPlay, deckFormat) };
}

/** Rebuild the library when the deck changed; deal a fresh hand if so. */
function ensureLibrary() {
    const inputs = readInputs();
    format = inputs.format;
    const next = inputs.library;
    const formatChanged = game.freeMulligan !== format.freeMulligan || game.firstPlayerDraws !== format.firstPlayerDraws;
    if (lib && next.key === lib.key && !formatChanged) return;
    lib = next;
    cardEls.forEach(el => el.remove());
    cardEls.clear();
    game = Lab.createGame(lib.cards, { freeMulligan: format.freeMulligan, firstPlayerDraws: format.firstPlayerDraws, onPlay });
    Lab.newHand(game);
    practiceAnswer = null;
}

/**
 * The page's numbers for the current deck and rule: exact land odds plus the
 * simulated mulligan outcomes, cached per deck + rule + free-mulligan rule.
 */
export function calculate() {
    if (!lib) ensureLibrary();
    const N = lib.cards.length;
    const L = lib.cards.filter(c => c.land).length;
    const key = `${lib.key}|${rule.minLands}-${rule.maxLands}-${rule.playBy}|${format.freeMulligan ? 1 : 0}`;
    if (simCache.has(key)) return simCache.get(key);

    const t0 = performance.now();
    const sim = Lab.simulateMulligans(lib.cards, rule, { freeMulligan: format.freeMulligan, games: GAMES, hasCosts: lib.hasCosts });
    const ms = performance.now() - t0;
    const exactKeepable = Lab.landsInRangeChance(N, L, rule);
    const playRule = rule.playBy > 0 && lib.hasCosts;
    const result = {
        N,
        L,
        dist: Lab.landDistribution(N, L),
        averageLands: N > 0 ? (Lab.OPENING_HAND * L) / N : 0,
        exactKeepable,
        keepable: sim ? (playRule ? sim.firstKeepable : exactKeepable) : null,
        exact: !playRule,
        sim,
        ms
    };
    if (simCache.size > 24) simCache.delete(simCache.keys().next().value);
    simCache.set(key, result);
    return result;
}

// ── Cards ────────────────────────────────────────────────────────────────────

function faceHtml(card) {
    const type = card.placeholder ? 'Stand-in card' : card.typeLine;
    return `
        <span class="hl-face" aria-hidden="true">
            <span class="hl-face-head">
                <span class="hl-face-name">${escapeHtml(card.name)}</span>
                <span class="hl-face-cost">${renderManaCost(card.cost)}</span>
            </span>
            <span class="hl-face-art"></span>
            <span class="hl-face-type">${escapeHtml(type)}</span>
        </span>`;
}

function cardEl(card) {
    let el = cardEls.get(card.uid);
    if (el) return el;
    el = document.createElement('button');
    el.type = 'button';
    el.className = 'hl-card';
    el.dataset.uid = String(card.uid);
    el.style.setProperty('--type-c', `var(--type-${TYPE_VAR[card.type] ?? 'artifact'})`);
    const label = card.typeLine && card.typeLine !== card.name ? `${card.name}, ${card.typeLine}` : card.name;
    el.setAttribute('aria-label', label);
    if (hoverPreview && !card.placeholder) el.dataset.card = card.name;
    el.innerHTML = faceHtml(card)
        + (card.placeholder ? '' : `<img class="hl-img" src="${escapeHtml(SCRYFALL_IMAGE(card.name))}" alt="" loading="lazy" decoding="async" width="488" height="680" draggable="false">`)
        + '<span class="hl-tag"></span>';
    const img = el.querySelector('img');
    if (img) {
        img.addEventListener('load', () => el.classList.add('is-loaded'), { once: true });
        img.addEventListener('error', () => el.classList.add('is-failed'), { once: true });
        if (img.complete && img.naturalWidth > 0) el.classList.add('is-loaded');
    }
    cardEls.set(card.uid, el);
    return el;
}

/** Put exactly these cards, in this order, into a container (moving, not rebuilding). */
function syncZone(container, cards, decorate) {
    if (!container) return;
    const want = cards.map(cardEl);
    const keep = new Set(want);
    [...container.children].forEach(child => {
        if (keep.has(child)) return;
        // A detached node never fires mouseout, which would leave the global
        // card preview stuck on screen after a re-deal under the pointer.
        if (child.matches?.(':hover')) child.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        child.remove();
    });
    want.forEach((el, i) => {
        if (container.children[i] !== el) container.insertBefore(el, container.children[i] ?? null);
        decorate(el, cards[i], i);
    });
}

function setTag(el, text, muted = false) {
    const tag = el.querySelector('.hl-tag');
    if (!tag) return;
    tag.textContent = text;
    tag.classList.toggle('is-muted', muted);
}

function playFresh() {
    let k = 0;
    game.fresh.forEach(uid => {
        const el = cardEls.get(uid);
        if (!el) return;
        el.classList.remove('is-new');
        void el.offsetWidth; // restart the animation on a re-dealt card
        el.style.setProperty('--k', String(k++));
        el.classList.add('is-new');
        el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
    });
    game.fresh = new Set();
}

function renderCards() {
    const container = $('hl-cards');
    if (!container) return;
    const hand = game.hand;
    const n = hand.length;
    container.style.setProperty('--n', String(Math.max(n, 1)));
    const castable = new Set(mode === 'sample' ? Lab.castableNow(game).map(c => c.uid) : []);
    const bottoming = mode === 'sample' && game.phase === 'bottoming';
    syncZone(container, hand, (el, card, i) => {
        const off = i - (n - 1) / 2;
        el.style.setProperty('--off', off.toFixed(2));
        el.style.setProperty('--abs', Math.abs(off).toFixed(2));
        const selected = bottoming && game.selected.has(card.uid);
        const canCast = castable.has(card.uid);
        el.classList.toggle('is-selected', selected);
        el.classList.toggle('is-castable', canCast);
        el.classList.toggle('is-actionable', bottoming || canCast);
        el.classList.remove('is-tapped');
        if (bottoming) el.setAttribute('aria-pressed', String(selected));
        else el.removeAttribute('aria-pressed');
        setTag(el, selected ? 'Bottom' : canCast ? 'Cast' : '');
    });
    if (n === 0) {
        container.innerHTML = `<p class="hl-empty">${lib && !Lab.canDeal(game)
            ? 'This deck has fewer than seven cards. Import a decklist or enter your card counts.'
            : 'No cards in hand.'}</p>`;
    } else {
        container.querySelector('.hl-empty')?.remove();
    }
}

function renderField() {
    const field = $('hl-field');
    if (!field) return;
    const show = mode === 'sample' && game.phase === 'playing';
    field.hidden = !show;
    if (!show) {
        syncZone($('hl-lane'), [], () => {});
        return;
    }
    const lands = game.battlefield.filter(c => c.land);
    const untapped = Lab.untappedLands(game).length;
    const colors = Lab.colorsOfMask(lands.reduce((m, l) => m | l.mask, 0));
    const head = $('hl-field-head');
    if (head) {
        head.innerHTML = `
            <span class="hl-field-title tx-eyebrow">Battlefield</span>
            <span>Turn <strong>${game.turn}</strong></span>
            <span>Mana <strong>${untapped}</strong> of ${lands.length}${colors.length ? ` · ${colors.map(c => `<span class="ms ms-${c.toLowerCase()}" aria-label="${c}">${c}</span>`).join('')}` : ''}</span>
            <span>Hand <strong>${game.hand.length}</strong></span>
            <span>Library <strong>${game.library.length}</strong></span>
            ${game.graveyard.length ? `<span data-tip="${escapeHtml(game.graveyard.map(c => c.name).join(', '))}">Graveyard <strong>${game.graveyard.length}</strong></span>` : ''}`;
    }
    // Lands first, then other permanents, each in the order played.
    const ordered = [...lands, ...game.battlefield.filter(c => !c.land)];
    syncZone($('hl-lane'), ordered, (el, card) => {
        el.classList.remove('is-selected', 'is-castable', 'is-actionable');
        el.classList.toggle('is-tapped', game.tapped.has(card.uid));
        el.removeAttribute('aria-pressed');
        el.style.removeProperty('--off');
        el.style.removeProperty('--abs');
        setTag(el, '');
    });
}

// ── Toolbar, prompt, read-out ────────────────────────────────────────────────

function btn(action, label, { key = '', primary = false, disabled = false, ghost = false, hint = '' } = {}) {
    const cls = ['btn', 'btn-sm', primary ? 'btn-primary' : '', ghost ? 'btn-ghost' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" type="button" data-hl-action="${action}"${disabled ? ' aria-disabled="true"' : ''}${hint ? ` data-tip="${escapeHtml(hint)}"` : ''}>${label}${key ? ` <kbd>${key}</kbd>` : ''}</button>`;
}

/** Re-render a container of action buttons without losing keyboard focus. */
function setActions(id, html) {
    const el = $(id);
    if (!el) return;
    const focused = document.activeElement?.closest?.('[data-hl-action]')?.dataset.hlAction;
    const wasInside = focused && el.contains(document.activeElement);
    el.innerHTML = html;
    if (wasInside) el.querySelector(`[data-hl-action="${focused}"]`)?.focus();
}

function chip(label, value) {
    return `<span class="chip">${label} <span class="hl-chip-num">${value}</span></span>`;
}

function renderToolbar() {
    if (mode === 'practice') {
        const answered = Boolean(practiceAnswer);
        const dots = tally.recent.map(r => `<span class="hl-dot ${r ? 'is-agree' : 'is-disagree'}"></span>`).join('');
        setActions('hl-toolbar', `
            ${btn('practice-keep', 'Keep', { key: 'K', disabled: answered })}
            ${btn('practice-mull', 'Mulligan', { key: 'M', disabled: answered })}
            ${btn('practice-next', answered ? 'Next hand' : 'Skip', { key: 'N', primary: answered, ghost: !answered })}
            <div class="hl-toolbar-status">
                ${tally.hands ? `
                <span class="hl-tally">
                    <span>You agreed with the rule <strong>${tally.agree}</strong> of <strong>${tally.hands}</strong></span>
                    <span class="hl-dots" aria-hidden="true">${dots}</span>
                </span>
                ${btn('tally-reset', 'Reset tally', { ghost: true })}` : '<span class="hl-tally">Your tally for this session appears here.</span>'}
            </div>`);
        return;
    }
    const g = game;
    const owed = Lab.owedCards(g);
    // While playing, the battlefield header carries turn, mana and library.
    const status = g.phase === 'playing'
        ? ''
        : `${chip('Mulligans', g.mulligans)}${g.mulligans ? chip('Keeping', Lab.OPENING_HAND - owed) : ''}`;
    setActions('hl-toolbar', `
        ${btn('new', 'New hand', { key: 'N' })}
        ${btn('mulligan', 'Mulligan', { key: 'M', disabled: !Lab.canMulligan(g) })}
        ${btn('keep', 'Keep', { key: 'K', primary: g.phase === 'deciding', disabled: g.phase !== 'deciding' || !Lab.canDeal(g) })}
        ${btn('draw', g.phase === 'playing' ? (g.turn === 0 ? 'Start turn 1' : 'Next turn') : 'Draw', {
            key: 'Space',
            primary: g.phase === 'playing',
            disabled: g.phase === 'playing' ? !Lab.canAdvance(g) : (g.phase === 'bottoming' && g.selected.size !== owed) || !Lab.canDeal(g)
        })}
        ${btn('reset', 'Reset', { ghost: true, disabled: !Lab.canDeal(g), hint: 'Replay this hand from the start' })}
        <div class="hl-toolbar-status">${Lab.canDeal(g) ? status : ''}</div>`);
}

function renderPrompt() {
    const el = $('hl-prompt');
    if (!el) return;
    el.classList.remove('is-agree', 'is-disagree');
    if (!Lab.canDeal(game)) {
        el.innerHTML = '';
        return;
    }
    if (mode === 'practice') {
        if (!practiceAnswer) {
            el.innerHTML = '<span><strong>Would you keep this seven?</strong> Decide first — then see what your rule says.</span>';
            return;
        }
        const { you, verdict, agree } = practiceAnswer;
        el.classList.add(agree ? 'is-agree' : 'is-disagree');
        el.innerHTML = `<span>You chose <strong>${you === 'keep' ? 'keep' : 'mulligan'}</strong>; the rule says <strong>${escapeHtml(verdict.headline)}</strong>. ${agree ? 'You agree.' : 'You disagree — worth a second look.'}</span>`;
        return;
    }
    const g = game;
    const owed = Lab.owedCards(g);
    if (g.phase === 'bottoming') {
        const chosen = g.selected.size;
        setActions('hl-prompt', `
            <span>Choose <strong>${owed}</strong> card${owed === 1 ? '' : 's'} to put on the bottom — click to select (${chosen} of ${owed}).</span>
            <span class="hl-prompt-actions">
                ${btn('suggest', 'Suggest', { ghost: true, hint: 'Pick them the way the simulation does' })}
                ${btn('confirm', `Put ${owed} on the bottom`, { primary: true, disabled: chosen !== owed })}
            </span>`);
        return;
    }
    if (g.phase === 'playing') {
        if (g.turn === 0) {
            const under = g.bottomed.length ? ` (${g.bottomed.length} on the bottom)` : '';
            el.innerHTML = `<span>Kept <strong>${g.hand.length}</strong> cards${escapeHtml(under)}. Press <strong>Start turn 1</strong> or <kbd>Space</kbd> to goldfish.</span>`;
        } else if (!Lab.canAdvance(g)) {
            el.innerHTML = '<span>That’s far enough for an opening. Deal a new hand to go again.</span>';
        } else {
            const castable = Lab.castableNow(g).length;
            el.innerHTML = castable
                ? `<span>Turn ${g.turn}: <strong>${castable}</strong> card${castable === 1 ? '' : 's'} you can cast now — click an outlined card to cast it.</span>`
                : `<span>Turn ${g.turn}: nothing castable with your untapped lands. <kbd>Space</kbd> for the next turn.</span>`;
        }
        return;
    }
    if (g.mulligans > 0) {
        const free = g.freeMulligan && g.mulligans === 1;
        el.innerHTML = `<span>Mulligan ${g.mulligans}${free ? ' (free)' : ''}: ${owed
            ? `if you keep, you’ll put <strong>${owed}</strong> card${owed === 1 ? '' : 's'} on the bottom.`
            : 'keep all seven if you like this one.'}</span>`;
        return;
    }
    el.innerHTML = '';
}

function names(cards) {
    if (!cards.length) return '<span class="hl-none">nothing</span>';
    // Count duplicates so "Forest ×2" reads cleanly.
    const counts = new Map();
    cards.forEach(c => counts.set(c.name, (counts.get(c.name) ?? 0) + 1));
    return [...counts].map(([name, n]) => `${cardRef(name)}${n > 1 ? ` ×${n}` : ''}`).join(', ');
}

function colorPips(colors) {
    return colors.map(c => `<span class="ms ms-${c.toLowerCase()}" role="img" aria-label="${c}">${c}</span>`).join('');
}

function factsHtml(a, { placeholder }) {
    const rows = [];
    rows.push(['Lands', a.landCount ? `${a.landCount}${placeholder ? '' : ` — ${names(a.lands)}`}` : '<span class="hl-none">none</span>']);
    if (placeholder) {
        rows.push(['Spells', String(a.nonlands.length)]);
        rows.push(['', '<span class="hl-none">Import a decklist to see costs, colours and what you can cast.</span>']);
    } else {
        rows.push(['Colours', a.colors.length ? colorPips(a.colors) : `<span class="hl-none">${a.colorlessOnly ? 'colourless only' : 'none yet'}</span>`]);
        rows.push([term('mv', 'Average mana value'), a.averageMv == null ? '<span class="hl-none">no spells</span>' : `${a.averageMv.toFixed(1)} across ${a.nonlands.length} spell${a.nonlands.length === 1 ? '' : 's'}`]);
        rows.push(['Castable by turn 2', names(a.castableBy[2])]);
        rows.push(['Castable by turn 3', names(a.castableBy[3])]);
        if (a.ramp.length) rows.push(['Ramp', names(a.ramp)]);
    }
    return `<dl class="hl-facts">${rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`;
}

function verdictHtml(v, { label = 'Your rule says', extra = [] } = {}) {
    const why = [...v.reasons, ...extra];
    return `
        <div class="hl-verdict ${v.keep ? 'tone-keep' : 'tone-mull'}">
            <span class="hl-verdict-mark" aria-hidden="true">${v.keep ? '✓' : '↻'}</span>
            <div>
                <div class="hl-verdict-label tx-eyebrow">${label}</div>
                <div class="hl-verdict-text">${escapeHtml(v.headline)}</div>
                ${why.length ? `<ul class="hl-verdict-why">${why.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}
            </div>
        </div>`;
}

/** The verdict for what's on the table now (respecting a finished bottom choice). */
function currentVerdict() {
    const g = game;
    const owed = Lab.owedCards(g);
    if (g.phase === 'bottoming' && g.selected.size === owed) {
        const kept = g.hand.filter(c => !g.selected.has(c.uid));
        return { ...Lab.judgeHand(kept, rule), bottomed: g.hand.filter(c => g.selected.has(c.uid)), chosen: true };
    }
    return { ...Lab.judgeHand(g.hand, rule, { bottom: owed }), chosen: false };
}

function renderReadout() {
    const el = $('hl-readout');
    if (!el) return;
    if (!Lab.canDeal(game)) {
        el.innerHTML = '';
        return;
    }
    const placeholder = lib.placeholder;
    if (mode === 'practice' && !practiceAnswer) {
        el.innerHTML = '<p class="hl-hidden-note">The read-out and the rule’s verdict appear once you decide.</p>';
        return;
    }
    if (mode === 'sample' && game.phase === 'playing') {
        const opening = Lab.judgeHand(game.kept ?? [], rule);
        const castable = Lab.castableNow(game);
        el.innerHTML = `
            ${verdictHtml(opening, { label: 'Opening hand' })}
            <dl class="hl-facts">
                <dt>Turn</dt><dd>${game.turn || '—'}</dd>
                <dt>Lands in play</dt><dd>${names(game.battlefield.filter(c => c.land))}</dd>
                <dt>Castable now</dt><dd>${game.turn ? names(castable) : '<span class="hl-none">start a turn first</span>'}</dd>
                <dt>In hand</dt><dd>${game.hand.length} card${game.hand.length === 1 ? '' : 's'}${placeholder ? '' : ` — ${game.hand.filter(c => c.land).length} land${game.hand.filter(c => c.land).length === 1 ? '' : 's'}`}</dd>
                ${game.graveyard.length ? `<dt>Graveyard</dt><dd>${names(game.graveyard)}</dd>` : ''}
            </dl>`;
        return;
    }
    const v = mode === 'practice' ? practiceAnswer.verdict : currentVerdict();
    const extra = [];
    if (mode === 'sample' && v.bottomed.length) {
        extra.push(`${v.chosen ? 'Bottoming' : 'If you keep, bottom'} ${names(v.bottomed)}${v.chosen ? '' : ' (suggested)'}`);
    }
    if (placeholder && rule.playBy) extra.push('The early-play requirement needs a decklist, so it is skipped.');
    el.innerHTML = verdictHtml(v, { extra }) + factsHtml(v.analysis, { placeholder });
}

function renderTable() {
    renderToolbar();
    renderPrompt();
    renderCards();
    renderField();
    renderReadout();
    playFresh();
}

// ── Summary, rail, statistics ────────────────────────────────────────────────

function renderSummary(stats) {
    const el = $('hl-summary');
    if (!el) return;
    if (!stats.sim) {
        el.innerHTML = renderBottomLine(Lab.summarize(null));
        return;
    }
    const s = stats.sim;
    const summary = Lab.summarize({ keepable: stats.keepable, belowSix: s.belowSix, freeMulligan: format.freeMulligan });
    const tone = stats.keepable >= 0.7 ? 'var(--tx-good)' : stats.keepable >= 0.55 ? 'var(--tx-warn)' : 'var(--tx-bad)';
    el.innerHTML = renderBottomLine(summary) + renderHeroStats([
        { label: 'Keepable seven', term: 'keepable', value: pct(stats.keepable), color: tone, size: 'big', sub: stats.exact ? 'exact' : `simulated · ${GAMES.toLocaleString('en-US')} hands` },
        { label: 'Keep seven cards', tip: format.freeMulligan ? 'Games where you keep a seven-card hand, using the free first mulligan if you need it.' : 'Games where you keep your first seven.', value: pct(s.keptAt[7] / s.games), sub: format.freeMulligan ? 'free mulligan included' : 'no mulligan needed' },
        { label: 'Down to five or fewer', tip: 'Games where you mulligan until you are keeping five cards or fewer.', value: pct(s.belowSix), sub: `${s.averageMulligans.toFixed(1)} mulligans a game on average` },
        { label: 'Lands in seven', tip: 'Average number of lands in an opening seven (exact).', value: stats.averageLands.toFixed(1), sub: `${stats.L} lands in ${stats.N} cards` }
    ]);
}

function renderRail() {
    const min = $('hl-min-lands');
    const max = $('hl-max-lands');
    if (min && document.activeElement !== min) min.value = String(rule.minLands);
    if (max && document.activeElement !== max) max.value = String(rule.maxLands);
    document.querySelectorAll('#hands-tab [data-hl-play]').forEach(b => {
        const on = Number(b.dataset.hlPlay) === rule.playBy;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('#hands-tab [data-hl-mode]').forEach(b => {
        const on = b.dataset.hlMode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    syncTurnOrder($('hl-order-group'), onPlay, format);
    const hint = $('hl-play-hint');
    if (hint) {
        hint.textContent = lib?.placeholder
            ? 'Needs a decklist — with bare type counts there are no costs to check.'
            : 'A spell or ramp piece the lands in the hand can cast by then, colours included.';
    }
    const note = $('hl-format');
    if (note && format) {
        const parts = [format.freeMulligan
            ? `${format.label}: the first mulligan is free and everyone draws on turn one.`
            : `${format.label}: no free mulligan.`];
        if (lib?.commanders?.length) parts.push(lib.commanders.length > 1 ? 'Your commanders start in the command zone, so they’re never dealt.' : 'Your commander starts in the command zone, so it’s never dealt.');
        if (lib?.placeholder) parts.push('Your deck is bare type counts, so the cards are stand-ins labelled by type.');
        note.textContent = parts.join(' ');
    }
}

function renderStats(stats) {
    const el = $('hl-stats');
    const meta = $('hl-stats-meta');
    if (!el) return;
    if (!stats.sim) {
        el.innerHTML = '<p class="hl-empty">Load a deck with at least seven cards to see how often hands are keepable.</p>';
        if (meta) meta.textContent = '';
        return;
    }
    if (meta) meta.textContent = `exact land odds · ${GAMES.toLocaleString('en-US')} simulated games`;
    const max = Math.max(...stats.dist, 0.0001);
    const bars = stats.dist.map((p, k) => `
        <div class="vbar${k >= rule.minLands && k <= rule.maxLands ? ' is-keep' : ''}">
            <span class="vbar-value">${p >= 0.005 ? pct(p) : ''}</span>
            <span class="vbar-track"><span class="vbar-fill" style="height:${((p / max) * 100).toFixed(1)}%"></span></span>
            <span class="vbar-label">${k}</span>
        </div>`).join('');
    const s = stats.sim;
    const rows = [
        { label: 'Keep 7 cards', p: s.keptAt[7] / s.games, tone: 'good' },
        { label: 'Keep 6 cards', p: s.keptAt[6] / s.games, tone: 'warn' },
        { label: 'Keep 5 or fewer', p: s.belowSix, tone: 'bad' }
    ];
    const range = rule.minLands === rule.maxLands ? `${rule.minLands}` : `${rule.minLands}–${rule.maxLands}`;
    el.innerHTML = `
        <div class="hl-stats-grid">
            <figure>
                <figcaption class="hl-stat-title">Lands in your opening seven</figcaption>
                <div class="vbars vbars-sm" role="img" aria-label="Chance of each land count in seven cards: ${stats.dist.map((p, k) => `${k} lands ${pct(p)}`).join(', ')}">${bars}</div>
                <p class="tx-caption is-inset is-below">${term('exact', 'Exact')}. Green bars are inside your keep range: <strong>${pct(stats.exactKeepable)}</strong> of sevens have ${range} lands. ${stats.exact ? '' : `With the early-play requirement, <strong>${pct(stats.keepable)}</strong> pass the whole rule (simulated).`}</p>
            </figure>
            <div>
                <div class="hl-stat-title">Where you end up after mulligans</div>
                <div class="hl-keeprows">
                    ${rows.map(r => `
                        <div class="hl-keeprow">
                            <span class="hl-keeprow-label">${r.label}</span>
                            <span class="meter"><span class="meter-fill tone-${r.tone}" style="width:${(r.p * 100).toFixed(1)}%"></span></span>
                            <span class="hl-keeprow-num">${pct(r.p)}</span>
                        </div>`).join('')}
                </div>
                <p class="tx-caption is-inset is-below">${term('simulation', `${GAMES.toLocaleString('en-US')} simulated games`)}: ${term('mulligan', 'mulligan')} until the hand meets your rule${format.freeMulligan ? ', first mulligan free' : ''}, bottoming extra lands or the priciest spells. The simulated player keeps any four-card hand. On average <strong>${s.averageMulligans.toFixed(1)}</strong> mulligans a game.</p>
            </div>
        </div>`;
}

function renderAll() {
    const stats = calculate();
    renderSummary(stats);
    renderRail();
    renderTable();
    renderStats(stats);
}

// ── Actions ──────────────────────────────────────────────────────────────────

function answerPractice(you) {
    if (practiceAnswer || !Lab.canDeal(game)) return;
    const verdict = Lab.judgeHand(game.hand, rule);
    const agree = (you === 'keep') === verdict.keep;
    practiceAnswer = { you, verdict, agree };
    tally.hands += 1;
    tally.agree += agree ? 1 : 0;
    tally.youKept += you === 'keep' ? 1 : 0;
    tally.ruleKept += verdict.keep ? 1 : 0;
    tally.recent = [...tally.recent, agree].slice(-20);
}

/** Run one named action and re-render the table. */
function act(action) {
    if (!lib) return;
    game.onPlay = onPlay;
    switch (action) {
        case 'new':
        case 'practice-next':
            Lab.newHand(game);
            practiceAnswer = null;
            break;
        case 'mulligan':
            Lab.takeMulligan(game);
            break;
        case 'keep':
            Lab.keepHand(game);
            break;
        case 'draw':
            if (game.phase === 'deciding') {
                Lab.keepHand(game);
                if (game.phase === 'playing') Lab.nextTurn(game);
            } else if (game.phase === 'bottoming') {
                if (Lab.confirmBottom(game)) Lab.nextTurn(game);
            } else {
                Lab.nextTurn(game);
            }
            break;
        case 'reset':
            Lab.resetHand(game);
            break;
        case 'suggest':
            Lab.suggestBottom(game, rule);
            break;
        case 'confirm':
            Lab.confirmBottom(game);
            break;
        case 'practice-keep':
            answerPractice('keep');
            break;
        case 'practice-mull':
            answerPractice('mull');
            break;
        case 'tally-reset':
            Object.assign(tally, { hands: 0, agree: 0, youKept: 0, ruleKept: 0, recent: [] });
            break;
        default:
            return;
    }
    renderTable();
}

function onCardClick(uid) {
    if (mode !== 'sample') return;
    if (game.phase === 'bottoming') {
        if (Lab.toggleBottom(game, uid)) renderTable();
        return;
    }
    if (game.phase === 'playing' && Lab.castCard(game, uid)) renderTable();
}

function setMode(next) {
    if (next === mode || !['sample', 'practice'].includes(next)) return;
    mode = next;
    Lab.newHand(game);
    practiceAnswer = null;
    renderRail();
    renderTable();
}

function setRule(patch) {
    const before = { ...rule };
    rule = Lab.normalizeRule({ ...rule, ...patch });
    // Raising min past max drags max up; lowering max past min drags min down.
    if (patch.maxLands != null && Number(patch.maxLands) < before.minLands) {
        rule = Lab.normalizeRule({ ...rule, minLands: rule.maxLands });
    }
    if (rule.minLands === before.minLands && rule.maxLands === before.maxLands && rule.playBy === before.playBy) {
        renderRail();
        return;
    }
    renderAll();
}

function isTyping(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable);
}

function onKeydown(e) {
    if (!isCalculatorActive(NAME)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (document.querySelector('dialog[open]')) return;
    const drawer = document.getElementById('guide-drawer');
    if (drawer && !drawer.hidden) return;
    const key = e.key;
    if (key === ' ' || key === 'Spacebar') {
        // Space on a focused button already clicks it.
        if (e.target?.closest?.('button, a, summary, [role="button"]')) return;
        if (e.repeat) return;
        e.preventDefault();
        if (mode === 'practice') { if (practiceAnswer) act('practice-next'); }
        else act('draw');
        return;
    }
    const map = mode === 'practice'
        ? { k: 'practice-keep', m: 'practice-mull', n: 'practice-next' }
        : { k: 'keep', m: 'mulligan', n: 'new' };
    const action = map[key.toLowerCase()];
    if (!action || e.repeat) return;
    e.preventDefault();
    act(action);
}

function onClick(e) {
    const action = e.target.closest('[data-hl-action]');
    if (action) {
        if (action.getAttribute('aria-disabled') !== 'true') act(action.dataset.hlAction);
        return;
    }
    const modeBtn = e.target.closest('[data-hl-mode]');
    if (modeBtn) { setMode(modeBtn.dataset.hlMode); return; }
    const playBtn = e.target.closest('[data-hl-play]');
    if (playBtn) { setRule({ playBy: Number(playBtn.dataset.hlPlay) }); return; }
    const order = turnOrderClicked(e);
    if (order !== null) {
        onPlay = order;
        game.onPlay = onPlay;
        renderRail();
        return;
    }
    const card = e.target.closest('#hl-cards .hl-card');
    if (card) onCardClick(Number(card.dataset.uid));
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function updateUI() {
    if (!isCalculatorActive(NAME)) return;
    ensureLibrary();
    renderAll();
}

export function init() {
    const root = document.getElementById(`${NAME}-tab`);
    if (!root) return;
    hoverPreview = Boolean(window.matchMedia?.('(hover: hover)').matches);

    root.addEventListener('click', e => {
        onClick(e);
        // A mouse click leaves focus on the button, so Space would press it
        // again instead of drawing. Keyboard activation (detail 0) keeps focus.
        const focused = document.activeElement;
        if (e.detail > 0 && focused?.tagName === 'BUTTON' && root.contains(focused)) focused.blur();
    });

    const onNumber = e => {
        const id = e.target?.id;
        if (id !== 'hl-min-lands' && id !== 'hl-max-lands') return;
        if (e.target.value === '') return;
        setRule(id === 'hl-min-lands' ? { minLands: e.target.value } : { maxLands: e.target.value });
    };
    root.addEventListener('input', onNumber);
    root.addEventListener('change', e => {
        onNumber(e);
        renderRail(); // tidy an emptied or out-of-range field on commit
    });

    document.addEventListener('keydown', onKeydown);
    ({ updateUI: debouncedUpdate } = registerCalculator({ name: NAME, calculate, updateUI }));
}

// ── Share links ──────────────────────────────────────────────────────────────

/** Non-default settings as URL params. */
export function getShareParams() {
    const out = {};
    if (rule.minLands !== Lab.DEFAULT_RULE.minLands) out.hmin = rule.minLands;
    if (rule.maxLands !== Lab.DEFAULT_RULE.maxLands) out.hmax = rule.maxLands;
    if (rule.playBy !== Lab.DEFAULT_RULE.playBy) out.hplay = rule.playBy;
    if (!onPlay) out.hdraw = 1;
    return out;
}

/** Apply share params (validated and clamped). */
export function applyShareParams(params) {
    const get = k => (params?.has?.(k) ? params.get(k) : null);
    const patch = {};
    if (get('hmin') !== null && /^\d+$/.test(get('hmin'))) patch.minLands = Number(get('hmin'));
    if (get('hmax') !== null && /^\d+$/.test(get('hmax'))) patch.maxLands = Number(get('hmax'));
    if (get('hplay') !== null) patch.playBy = Number(get('hplay'));
    rule = Lab.normalizeRule({ ...rule, ...patch });
    if (get('hdraw') === '1') onPlay = false;
    game.onPlay = onPlay;
    debouncedUpdate?.();
}

/** Current settings (for tests). */
export function getSettings() {
    return { rule: { ...rule }, onPlay };
}
