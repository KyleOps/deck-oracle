/**
 * Mana Base — "Can my lands cast my spells on curve?"
 *
 * Frank Karsten-style colour analysis for any deck. The maths lives in
 * utils/castability.js (exact, pure, tested); this module caches it per deck,
 * turns it into plain-language findings and renders the page. Charts are HTML
 * bars and meters rather than Chart.js canvases: they theme for free and render
 * instantly, so this page never loads the chart library.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { analyzeCastability } from '../utils/castability.js';
import { heatStrip } from '../utils/viz.js';
import { COLOR_NAMES, renderManaCost } from '../utils/mana.js';
import { renderBottomLine, renderHeroStats, toneColor } from '../utils/components.js';
import { commanderNamesOf, libraryOf, unlistedCopies } from '../utils/library.js';
import { inflect as plural } from '../utils/text.js';
import { debounce } from '../utils/simulation.js';
import { escapeHtml, cardRef, term } from '../data/glossary.js';

const NAME = 'manabase';
export const TARGET = 0.9;
export const DEFAULT_ROWS = 12;
/** Turns the "when does it become reliable" strips cover. */
export const STRIP_TURNS = 8;

let onPlay = true;
let filter = 'all';
let query = '';
let showAll = false;
let tableColor = null;
let cache = { key: null, result: null };
let debouncedUpdate = null;

// ── Formatting helpers (pure) ────────────────────────────────────────────────

/**
 * A chance as a whole percentage, rounded DOWN so a card shown as "90%" really
 * is at least 90% — the threshold every count on this page uses.
 */
export function pct(p) {
    if (!Number.isFinite(p)) return '—';
    return `${Math.floor(Math.max(0, Math.min(1, p)) * 100 + 1e-9)}%`;
}

/** What a chance means against the 90% target. */
export function chanceTone(p, target = TARGET) {
    if (!Number.isFinite(p)) return 'flat';
    if (p >= target - 1e-9) return 'good';
    return p >= target - 0.1 ? 'warn' : 'bad';
}

function pip(color) {
    return `<span class="ms ms-${color.toLowerCase()}" aria-hidden="true">${color}</span>`;
}

/** Inline pips for "UU", readable as text when tags are stripped. */
function pips(color, count) {
    return `<span class="mana-cost" role="img" aria-label="${count} ${COLOR_NAMES[color].toLowerCase()}">${pip(color).repeat(count)}</span>`;
}

// ── Findings (pure) ──────────────────────────────────────────────────────────

/**
 * The bottom line: one or two sentences with the numbers that matter.
 * @param {ReturnType<typeof analyzeCastability>} result
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(result) {
    const base = summarizeLibrary(result);
    const zone = commanderSentence(result);
    if (!zone) return base;
    // A commander under the target is never "all good".
    const tone = result.commandersUnder > 0 && (base.tone === 'good' || base.tone === 'flat') ? 'warn' : base.tone;
    return { html: `${base.html} ${zone}`, tone };
}

/**
 * The commanders' own line: each one's on-curve chance, cast from the command
 * zone (never drawn, so on curve is its mana value with that many land drops).
 * Null without a checked commander.
 */
export function commanderSentence(result) {
    const list = result?.commanders ?? [];
    if (!list.length) return null;
    const target = result.target ?? TARGET;
    const each = list.map(c => `${cardRef(c.name)} <strong>${pct(c.chance)}</strong> on turn ${c.turn}`);
    const joined = each.length <= 2 ? each.join(' and ') : `${each.slice(0, -1).join(', ')} and ${each[each.length - 1]}`;
    const short = list.filter(c => c.chance < target - 1e-9).length;
    const goal = `${Math.round(target * 100)}%`;
    const verdict = short === 0 ? ''
        : list.length === 1 ? ` — under ${goal}`
            : short === list.length ? ` — ${list.length === 2 ? 'both' : 'all'} under ${goal}`
                : ` — ${short === 1 ? 'one' : short} under ${goal}`;
    return list.length > 1
        ? `From the command zone, your commanders have their colours on curve: ${joined}${verdict}.`
        : `From the command zone, your commander has its colours on curve: ${joined}${verdict}.`;
}

function summarizeLibrary(result) {
    if (!result || result.total === 0) {
        return {
            html: 'None of your spells have coloured mana symbols, so any lands cast them — only the land count matters here.',
            tone: 'flat'
        };
    }
    const { under, total, bottleneck: b, worst, target } = result;
    const goal = `${Math.round(target * 100)}%`;
    if (under === 0) {
        return {
            html: `All <strong>${total}</strong> of your coloured spells are at least <strong>${goal}</strong> to cast on curve once you hit your land drops.`
                + ` The hardest, ${cardRef(worst.name)}, is at <strong>${pct(worst.chance)}</strong>.`,
            tone: 'good'
        };
    }

    let html = `<strong>${under}</strong> of your ${total} coloured spells ${under === 1 ? 'is' : 'are'} under <strong>${goal}</strong> to cast on curve.`;
    if (b) {
        const name = COLOR_NAMES[b.color];
        const h = b.hardest;
        const who = b.peers > 1
            ? `your turn-${h.turn} ${pips(b.color, h.pips)} cards`
            : `${cardRef(h.name)} (${h.commander ? 'your commander, ' : ''}${pips(b.color, h.pips)} on turn ${h.turn})`;
        const verb = b.peers > 1 ? 'want' : 'wants';
        html += b.want == null
            ? ` ${name} is the bottleneck: <strong>${b.sources}</strong> ${plural(b.sources, 'source')}, and ${who} would need more ${name.toLowerCase()} sources than you have lands.`
            : ` ${name} is the bottleneck: <strong>${b.sources}</strong> ${plural(b.sources, 'source')} where ${who} ${verb} about <strong>${b.want}</strong>.`;
        const second = result.colors.filter(c => c !== b && c.gap > 0 && Number.isFinite(c.gap)).sort((x, y) => y.gap - x.gap)[0];
        if (second) html += ` ${COLOR_NAMES[second.color]} is short too: ${second.sources} of about ${second.want}.`;
    } else {
        html += ` Every colour has the sources its own cards want; the misses need several colours at once. The hardest is ${cardRef(worst.name)} at <strong>${pct(worst.chance)}</strong>.`;
    }
    return { html, tone: under / total <= 0.25 ? 'warn' : 'bad' };
}

/**
 * Hero stats in plain words.
 * @param {ReturnType<typeof analyzeCastability>} result
 */
export function heroStats(result) {
    if (!result || result.total === 0) return [];
    const ok = result.total - result.under;
    const share = ok / result.total;
    const goal = Math.round(result.target * 100);
    const b = result.bottleneck;
    const worst = result.worst;
    return [
        {
            label: `At ${goal}% or better`,
            value: `${Math.round(share * 100)}%`,
            sub: `${ok} of ${result.total} coloured spells`,
            color: toneColor(result.under === 0 ? 'good' : share >= 0.75 ? 'warn' : 'bad'),
            size: 'big',
            tip: `Coloured spells with at least a ${goal}% chance that your lands are the right colours on the turn matching their mana value, when you have hit your land drops.`
        },
        {
            label: 'Average chance',
            value: pct(result.average),
            sub: 'right colours on curve',
            color: toneColor(chanceTone(result.average, result.target)),
            tip: 'The average of every coloured spell’s on-curve chance, assuming you made your land drops.'
        },
        {
            label: 'Hardest to cast',
            value: pct(worst.chance),
            sub: `<span class="mb-hero-card">${cardRef(worst.name)} · turn ${worst.turn}</span>`,
            color: toneColor(chanceTone(worst.chance, result.target)),
            tip: 'The coloured spell least likely to have its colours on curve.'
        },
        b
            ? {
                label: 'Bottleneck',
                value: COLOR_NAMES[b.color],
                sub: b.want == null ? `${b.sources} sources · not enough lands` : `${b.sources} sources · wants about ${b.want}`,
                color: toneColor(b.gap >= 4 ? 'bad' : 'warn'),
                tip: 'The colour furthest short of the sources its hardest card wants for a 90% chance on curve.'
            }
            : {
                label: 'Bottleneck',
                value: 'None',
                sub: 'every colour has what its cards want',
                color: toneColor('good'),
                tip: 'No colour is short of the sources its hardest card wants for a 90% chance on curve.'
            }
    ];
}

/**
 * Cards matching the colour filter and search text, worst first.
 * @param {Array} cards - analysis rows (already sorted worst first)
 * @param {{filter?:string, query?:string}} opts - filter: 'all' | 'multi' | a colour letter
 */
export function filterCards(cards = [], { filter: f = 'all', query: q = '' } = {}) {
    const needle = String(q ?? '').trim().toLowerCase();
    return cards.filter(c => {
        if (f === 'multi' && !c.multicolor) return false;
        if (f !== 'all' && f !== 'multi' && !c.colors.includes(f)) return false;
        return !needle || c.name.toLowerCase().includes(needle);
    });
}

/** Cache key: everything that changes the answer (the library's contents, not the list object). */
export function deckKey(config, format, play) {
    const library = libraryOf(config ?? {}, { format });
    const zone = commanderNamesOf(config ?? {}).join('|');
    return `${format?.key}|${play ? 1 : 0}|${config?.actualCardCount ?? ''}|${library.key}|${zone}`;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function effectiveOnPlay(format) {
    return format.firstPlayerDraws ? true : onPlay;
}

/** Analyse the active deck (cached per deck and turn order). */
export function calculate() {
    const config = DeckConfig.getDeckConfig();
    const format = DeckConfig.getFormat();
    const play = effectiveOnPlay(format);
    const hasList = DeckConfig.hasCardList();
    if (!hasList) return { config, format, onPlay: play, hasList, result: null };
    const key = deckKey(config, format, play);
    if (cache.key !== key) {
        const library = libraryOf(config, { format });
        const deckSize = library.size + unlistedCopies(library, config.actualCardCount);
        const commanderCards = library.commanders.length ? DeckConfig.getCommanders().map(c => c.card) : [];
        cache = { key, result: analyzeCastability(library, { deckSize, format, onPlay: play, target: TARGET, byTurn: STRIP_TURNS, commanderCards }) };
    }
    return { config, format, onPlay: play, hasList, result: cache.result };
}

function set(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

export function updateUI() {
    if (!isCalculatorActive(NAME)) return;
    const { format, onPlay: play, hasList, result } = calculate();

    document.getElementById('mb-empty')?.toggleAttribute('hidden', hasList);
    document.getElementById('mb-content')?.toggleAttribute('hidden', !hasList);
    if (!hasList || !result) return;

    const bottom = summarize(result);
    set('mb-bottom', renderBottomLine(bottom));
    set('mb-hero', renderHeroStats(heroStats(result)));
    set('mb-controls', renderControls(result, format, play));
    set('mb-colors', renderColors(result));
    set('mb-colors-meta', result.bottleneck ? `${COLOR_NAMES[result.bottleneck.color]} is short` : 'every colour covered');
    renderCards(result);
    renderSourcesTable(result, format, play);
    set('mb-lands', renderLands(result));
    set('mb-lands-meta', `${result.lands} ${plural(result.lands, 'land')} · by the colours they make`);
}

export function init() {
    const root = document.getElementById(`${NAME}-tab`);
    const rerenderCards = () => {
        const { result } = calculate();
        if (result) renderCards(result);
    };
    const onSearch = debounce(value => {
        query = value;
        showAll = false;
        rerenderCards();
    }, 120);

    root?.addEventListener('input', e => {
        if (e.target.id === 'mb-search') onSearch(e.target.value);
    });
    root?.addEventListener('click', e => {
        const play = e.target.closest('[data-mb-play]');
        if (play) {
            onPlay = play.dataset.mbPlay === '1';
            updateUI();
            return;
        }
        const f = e.target.closest('[data-mb-filter]');
        if (f) {
            filter = f.dataset.mbFilter;
            showAll = false;
            rerenderCards();
            return;
        }
        if (e.target.closest('[data-mb-more]')) {
            showAll = !showAll;
            rerenderCards();
            return;
        }
        const c = e.target.closest('[data-mb-color]');
        if (c) {
            tableColor = c.dataset.mbColor;
            const { result, format, onPlay: p } = calculate();
            if (result) renderSourcesTable(result, format, p);
            return;
        }
        if (e.target.closest('[data-mb-deck]')) {
            document.getElementById('deck-switcher')?.click();
        }
    });
    ({ updateUI: debouncedUpdate } = registerCalculator({ name: NAME, calculate, updateUI }));
}

/** Share links: only the turn order changes the answer. */
export function getShareParams() {
    return onPlay ? {} : { draw: 1 };
}

export function applyShareParams(params) {
    if (params?.get?.('draw') === '1') onPlay = false;
    debouncedUpdate?.();
}

/**
 * Cells for a turn strip: one per turn, toned against the 90% target, with the
 * card's own turn outlined. Pure — exported for tests.
 * @param {Array<number|null>} chances - index 0 = turn 1; null = not castable yet
 * @param {{current?:number|null, target?:number}} [opts]
 */
export function stripCells(chances = [], { current = null, target = TARGET } = {}) {
    return chances.map((p, i) => ({
        label: `Turn ${i + 1}`,
        value: Number.isFinite(p) ? p : null,
        tone: Number.isFinite(p) ? chanceTone(p, target) : 'flat',
        current: current === i + 1,
        note: 'not enough lands yet'
    }));
}

/** The first turn a strip reaches the target, or null within the strip. */
export function reliableFrom(chances = [], target = TARGET) {
    const i = chances.findIndex(p => Number.isFinite(p) && p >= target - 1e-9);
    return i === -1 ? null : i + 1;
}

const STRIP_KEY = `<span class="mb-strip-key" aria-hidden="true">
        <span><i class="viz-strip-cell is-good"></i>90%+</span>
        <span><i class="viz-strip-cell is-warn"></i>80–89%</span>
        <span><i class="viz-strip-cell is-bad"></i>under 80%</span>
        <span><i class="viz-strip-cell is-good is-current"></i>on curve</span>
    </span>`;

function stripAxis() {
    return `<span class="mb-strip-axis" aria-hidden="true">${Array.from({ length: STRIP_TURNS }, (_, i) => `<span>${i + 1}</span>`).join('')}</span>`;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderControls(result, format, play) {
    const colored = result.lands - result.colorlessLands;
    const facts = `
        <span class="mb-facts">
            <span><strong>${result.deckSize}</strong> cards</span>
            <span><strong>${result.lands}</strong> lands</span>
            <span><strong>${colored}</strong> make coloured mana</span>
            <span>${escapeHtml(format.label)}</span>
        </span>`;
    const order = format.firstPlayerDraws
        ? `<span>Everyone draws on turn one — ${term('play', 'turn order')} doesn’t matter here.</span>`
        : `<div class="seg seg-sm" role="group" aria-label="Turn order">
                <button class="seg-btn${play ? ' active' : ''}" type="button" data-mb-play="1" aria-pressed="${play}">On the play</button>
                <button class="seg-btn${!play ? ' active' : ''}" type="button" data-mb-play="0" aria-pressed="${!play}">On the draw</button>
            </div>`;
    return facts + order;
}

function renderColors(result) {
    if (result.colors.length === 0) return '<p class="mb-note">No colours to check.</p>';
    return result.colors.map(c => {
        const name = COLOR_NAMES[c.color];
        const h = c.hardest;
        let bar = '';
        let note;
        if (!h) {
            note = c.cards > 0
                ? `<p class="mb-note">Only hybrid costs use ${name.toLowerCase()}, so other colours can pay them.</p>`
                : `<p class="mb-note">No spell needs ${name.toLowerCase()} mana.</p>`;
        } else {
            const want = c.want;
            const ratio = want == null ? 0 : Math.min(1, c.sources / Math.max(1, want));
            const tone = want != null && c.sources >= want ? 'good' : (want != null && want - c.sources <= 2 ? 'warn' : 'bad');
            bar = `
                <div class="mb-color-bar">
                    <span class="meter" role="img" aria-label="${c.sources} of ${want ?? 'more than your'} sources wanted"><span class="meter-fill tone-${tone}" style="width:${(ratio * 100).toFixed(1)}%"></span></span>
                    <span>${want == null ? 'needs more lands' : c.sources >= want ? `needs ${want}` : `wants ${want}`}</span>
                </div>`;
            const needs = want == null
                ? ' Even all your lands would not reach 90%.'
                : c.sources >= want ? '' : ` About <strong>${want}</strong> sources would reach 90%.`;
            note = `<p class="mb-note">Hardest: ${cardRef(h.name)}${h.commander ? ' (your commander)' : ''} — ${pips(c.color, h.pips)} on turn ${h.turn}, <strong>${pct(h.chance)}</strong>.${needs}</p>`;
        }
        const turns = (c.byTurn ?? []).length ? `
            <div class="mb-color-turns">
                <div class="mb-turns-row mb-turns-head"><span>By turn</span>${stripAxis()}</div>
                ${c.byTurn.map(row => {
                    const from = reliableFrom(row.cells);
                    return `
                <div class="mb-turns-row">
                    ${pips(c.color, row.pips)}
                    ${heatStrip({ label: `${row.pips} ${COLOR_NAMES[c.color].toLowerCase()} by turn, with every land drop made`, cells: stripCells(row.cells) })}
                    <span class="mb-turns-from">${from ? `90% from turn ${from}` : `under 90% by T${STRIP_TURNS}`}</span>
                </div>`;
                }).join('')}
            </div>` : '';
        const facts = h
            ? `<dl class="mb-color-facts">
                    <div><dt>${term('pip', 'Pips')}</dt><dd>${c.pips} on ${c.cards} ${plural(c.cards, 'card')}</dd></div>
                    <div><dt>Under 90%</dt><dd>${c.under} ${plural(c.under, 'card')}</dd></div>
                </dl>`
            : '';
        return `
            <article class="mb-color">
                <div class="mb-color-head">
                    ${pip(c.color)}
                    <span class="mb-color-name">${name}</span>
                    <span class="mb-color-src"><strong>${c.sources}</strong>${term('source', plural(c.sources, 'source'))}</span>
                </div>
                ${bar}
                ${facts}
                ${turns}
                ${note}
            </article>`;
    }).join('');
}

function cardTags(card) {
    const tags = [];
    if (card.commander) tags.push(`<span class="mb-tag" tabindex="0" data-tip="Your commander: cast from the command zone and never drawn, so on curve means turn ${card.turn} with ${card.turn} land ${card.turn === 1 ? 'drop' : 'drops'}. Not counted among the library’s coloured spells.">commander</span>`);
    if (card.x > 0) tags.push(`<span class="mb-tag" tabindex="0" data-tip="X counts as 1, so this is checked on turn ${card.turn} (mana value ${card.mv}).">X=1</span>`);
    if (card.phyrexian > 0) tags.push(`<span class="mb-tag" tabindex="0" data-tip="${card.phyrexian} Phyrexian ${plural(card.phyrexian, 'symbol')} can be paid with 2 life each, so ${card.phyrexian === 1 ? 'it is' : 'they are'} not counted.">Phyrexian</span>`);
    if (card.hybrid > 0) tags.push(`<span class="mb-tag" tabindex="0" data-tip="Hybrid symbols are paid by either of their colours.">hybrid</span>`);
    return tags.join('');
}

function renderFilters(result) {
    const counts = { all: result.cards.length, multi: result.cards.filter(c => c.multicolor).length };
    const colors = result.colors.filter(c => c.cards > 0).map(c => c.color);
    colors.forEach(c => { counts[c] = result.cards.filter(r => r.colors.includes(c)).length; });
    if (filter !== 'all' && !(filter in counts && counts[filter] > 0)) filter = 'all';
    const btn = (key, label, aria) => `
        <button class="seg-btn${filter === key ? ' active' : ''}" type="button" data-mb-filter="${key}" aria-pressed="${filter === key}"${aria ? ` aria-label="${aria}"` : ''}>
            ${label}<span class="seg-count">${counts[key]}</span>
        </button>`;
    return `
        <div class="seg seg-sm" role="group" aria-label="Filter by colour">
            ${btn('all', 'All')}
            ${colors.map(c => btn(c, pip(c), `${COLOR_NAMES[c]} (${counts[c]})`)).join('')}
            ${counts.multi > 0 && colors.length > 1 ? btn('multi', 'Multicolour') : ''}
        </div>`;
}

function renderCards(result) {
    set('mb-filters', renderFilters(result));
    const search = document.getElementById('mb-search');
    if (search && search.value !== query) search.value = query;

    const rows = filterCards(result.cards, { filter, query });
    // Commanders first, always shown (they're not among the library's counted spells).
    const pinned = filterCards(result.commanders ?? [], { filter, query });
    const zone = result.commanders?.length ? ` · ${plural(result.commanders.length, 'commander')}` : '';
    set('mb-cards-meta', `${result.total} checked · ${result.under} under 90%${zone}`);
    if (rows.length === 0 && pinned.length === 0) {
        set('mb-cards', `<p class="mb-none">${result.cards.length || result.commanders?.length ? 'No coloured spells match.' : 'No spells with coloured mana symbols.'}</p>`);
    } else {
        const shown = showAll ? rows : rows.slice(0, DEFAULT_ROWS);
        const body = [...pinned, ...shown].map(c => {
            const tone = chanceTone(c.chance, result.target);
            return `
                <tr${c.commander ? ' class="mb-commander"' : ''}>
                    <th scope="row">${cardRef(c.name)}${c.count > 1 ? `<span class="mb-copies">×${c.count}</span>` : ''}${cardTags(c)}<span class="mb-cost-inline" aria-hidden="true">${renderManaCost(c.cost)}<span class="mb-copies">turn ${c.turn}</span></span></th>
                    <td class="mb-cost mb-col-cost">${renderManaCost(c.cost)}</td>
                    <td class="num mb-col-turn">${c.turn}</td>
                    <td class="mb-col-chance">
                        <span class="mb-chance">
                            ${c.byTurn
                                ? heatStrip({ label: `${c.name}, right colours by turn`, cells: stripCells(c.byTurn, { current: c.turn, target: result.target }) })
                                : `<span class="meter"><span class="meter-fill tone-${tone}" style="width:${(c.chance * 100).toFixed(1)}%"></span></span>`}
                            <span class="num tone-${tone}">${pct(c.chance)}</span>
                        </span>
                    </td>
                    <td class="num mb-overall mb-col-overall">${pct(c.overall)}</td>
                </tr>`;
        }).join('');
        const more = rows.length > DEFAULT_ROWS
            ? `<div class="mb-more">
                    <span>${showAll ? `All ${rows.length} shown` : `The ${DEFAULT_ROWS} hardest of ${rows.length}`}</span>
                    <button class="btn btn-ghost btn-sm" type="button" data-mb-more aria-expanded="${showAll}">${showAll ? `Show the ${DEFAULT_ROWS} hardest` : `Show all ${rows.length}`}</button>
                </div>`
            : '';
        set('mb-cards', `
            <p class="mb-strip-note">When each card becomes reliable: ${STRIP_KEY}</p>
            <table class="mb-table">
                <thead>
                    <tr>
                        <th scope="col">Card</th>
                        <th scope="col" class="mb-col-cost">Cost</th>
                        <th scope="col" class="num mb-col-turn"><span class="term" tabindex="0" data-tip="The turn it is checked on: its mana value, with X counted as 1.">Turn</span></th>
                        <th scope="col" class="mb-col-chance"><span class="mb-chance mb-chance-head"><span class="term" tabindex="0" data-tip="One cell per turn, 1 to 8: if you have made every land drop by then, the chance your lands can pay every coloured symbol (Frank Karsten’s convention). The outlined cell is the card’s own turn — the number on the right.">Right colours by turn</span>${stripAxis()}</span></th>
                        <th scope="col" class="num mb-col-overall"><span class="term" tabindex="0" data-tip="The chance you have enough lands AND the right colours by that turn. Lower, because it also counts missed land drops.">Lands + colours</span></th>
                    </tr>
                </thead>
                <tbody>${body}</tbody>
            </table>
            ${more}`);
    }

    const notes = [];
    if (result.skipped.length) {
        const n = result.skipped.length;
        notes.push(`${n} double-faced ${plural(n, 'card')} came in without a mana cost and ${n === 1 ? 'isn’t' : 'aren’t'} checked: ${result.skipped.map(s => cardRef(s.name)).join(', ')}.`);
    }
    if (result.phyrexianOnly) {
        notes.push(`${result.phyrexianOnly} ${plural(result.phyrexianOnly, 'card')} with only Phyrexian symbols can be paid with life, so ${result.phyrexianOnly === 1 ? 'it is' : 'they are'} left out.`);
    }
    if (result.commanders?.length) {
        notes.push(`Your ${plural(result.commanders.length, 'commander')} ${result.commanders.length === 1 ? 'is' : 'are'} listed first: cast from the command zone, never drawn, so on curve is ${result.commanders.length === 1 ? 'its' : 'each one’s'} mana value with that many land drops. ${result.commanders.length === 1 ? 'It counts' : 'They count'} toward each colour’s hardest card, not the coloured-spell counts above.`);
    }
    for (const c of result.commandersUnchecked ?? []) {
        notes.push(c.why === 'colourless'
            ? `${cardRef(c.name)} has no coloured symbols, so only your land count matters for it.`
            : `${cardRef(c.name)} came in without a mana cost and isn’t checked.`);
    }
    const unknown = DeckConfig.getCommanders().filter(c => !c.card).map(c => escapeHtml(c.name));
    if (unknown.length && DeckConfig.getFormat().key === 'commander') {
        notes.push(`${unknown.join(' and ')} came without ${unknown.length === 1 ? 'its card' : 'their cards'}, so ${unknown.length === 1 ? 'its cost isn’t' : 'their costs aren’t'} checked — import the deck again to include ${unknown.length === 1 ? 'it' : 'them'}.`);
    }
    set('mb-cards-caption', notes.join(' ') || 'Only lands count as sources here — mana rocks and dorks make real games a little better than this.');
}

function renderSourcesTable(result, format, play) {
    const candidates = result.colors.filter(c => c.cards > 0 || c.sources > 0);
    if (!candidates.some(c => c.color === tableColor)) {
        tableColor = result.bottleneck?.color ?? candidates.slice().sort((a, b) => a.sources - b.sources)[0]?.color ?? null;
    }
    set('mb-table-meta', `${result.deckSize} cards · ${result.lands} lands${format.firstPlayerDraws ? '' : ` · ${play ? 'on the play' : 'on the draw'}`}`);
    if (!tableColor) {
        set('mb-table-colors', '');
        set('mb-table', '<p class="mb-none">No coloured spells to compare.</p>');
        set('mb-table-caption', '');
        return;
    }
    const color = result.colors.find(c => c.color === tableColor);
    set('mb-table-colors', `
        <div class="seg seg-sm" role="group" aria-label="Compare a colour">
            ${candidates.map(c => `
                <button class="seg-btn${c.color === tableColor ? ' active' : ''}" type="button" data-mb-color="${c.color}" aria-pressed="${c.color === tableColor}">
                    ${pip(c.color)} ${COLOR_NAMES[c.color]}<span class="seg-count">${c.sources}</span>
                </button>`).join('')}
        </div>
        <span class="mb-legend">
            <span><span class="mb-legend-swatch mb-legend-met"></span>your ${color.sources} sources are enough</span>
            <span><span class="mb-legend-swatch mb-legend-short"></span>short, and you have cards there</span>
        </span>`);

    // Which of this colour's cards sit in each cell (strict pips, turns 1–6).
    const cellCards = new Map();
    let offTable = 0;
    for (const card of [...(result.commanders ?? []), ...result.cards]) {
        const k = card.pips[tableColor] ?? 0;
        if (k <= 0) continue;
        if (k > 3 || card.turn > 6) { offTable++; continue; }
        const key = `${k}|${card.turn}`;
        if (!cellCards.has(key)) cellCards.set(key, []);
        cellCards.get(key).push(card.commander ? `${card.name} (commander)` : card.name);
    }

    const { turns, rows } = result.table;
    const head = `<tr><th scope="col">Cost</th>${turns.map(t => `<th scope="col"><span class="mb-turn-word">Turn </span><span class="mb-turn-short" aria-hidden="true">T</span>${t}</th>`).join('')}</tr>`;
    const body = rows.map(row => `
        <tr>
            <th scope="row">${pips(tableColor, row.pips)}</th>
            ${row.cells.map(cell => {
                if (!cell.possible) return '<td class="is-na" aria-label="Not possible">—</td>';
                const names = cellCards.get(`${row.pips}|${cell.turn}`) ?? [];
                if (cell.needed == null) {
                    return `<td class="is-na${names.length ? ' has-cards is-short' : ''}"${names.length ? ` data-tip="${escapeHtml(names.join(', '))}"` : ''}>&gt;${result.lands}</td>`;
                }
                const met = color.sources >= cell.needed;
                const cls = [met ? 'is-met' : 'is-short', names.length ? 'has-cards' : ''].filter(Boolean).join(' ');
                const tip = `${cell.needed} sources give a 90% chance of ${row.pips} ${COLOR_NAMES[tableColor].toLowerCase()} by turn ${cell.turn}.`
                    + (names.length ? ` Your cards here: ${names.join(', ')}.` : '');
                const count = names.length
                    ? `<span class="mb-cell-cards">${names.length}<span class="mb-cell-word"> ${plural(names.length, 'card')}</span></span>`
                    : '';
                return `<td class="${cls}" tabindex="0" data-tip="${escapeHtml(tip)}">${cell.needed}${count}</td>`;
            }).join('')}
        </tr>`).join('');
    set('mb-table', `<table class="mb-karsten"><thead>${head}</thead><tbody>${body}</tbody></table>`);

    const cap = [`Each number is the fewest ${COLOR_NAMES[tableColor].toLowerCase()} sources that give a 90% chance of that many ${term('pip', 'pips')} on that turn, if you hit your land drops — worked out exactly for ${result.deckSize} cards and ${result.lands} lands.`];
    if (offTable) cap.push(`${offTable} ${COLOR_NAMES[tableColor].toLowerCase()} ${plural(offTable, 'card')} ${offTable === 1 ? 'needs' : 'need'} four or more pips or ${offTable === 1 ? 'comes' : 'come'} after turn 6 — see the card list.`);
    set('mb-table-caption', cap.join(' '));
}

function renderLands(result) {
    if (result.landGroups.length === 0) return '<p class="mb-none">No lands in this list.</p>';
    return result.landGroups.map(g => {
        const symbols = g.kind === 'colorless' || g.kind === 'offcolor'
            ? '<span class="mana-cost" aria-hidden="true"><span class="ms ms-c">C</span></span>'
            : `<span class="mana-cost" aria-hidden="true">${g.colors.map(pip).join('')}</span>`;
        const cards = g.cards.map(c => `${c.count > 1 ? `<span class="mb-copies">${c.count}×</span>` : ''}${cardRef(c.name)}`).join(', ');
        const hint = g.kind === 'any' ? ' data-tip="Makes any colour your deck plays, so it counts as a source of each."'
            : g.kind === 'offcolor' ? ' data-tip="Makes only colours outside this deck’s colour identity."' : '';
        return `
            <div class="mb-land-group">
                <div class="mb-land-head"${hint}>
                    ${symbols}
                    <span class="mb-land-label">${escapeHtml(g.label)}</span>
                    <span class="mb-land-count">${g.count}</span>
                </div>
                <p class="mb-land-cards">${cards}</p>
            </div>`;
    }).join('');
}
