/**
 * Deck Overview — the landing page.
 *
 * Reads the whole deck through utils/deckStats.js (exact, pure) and renders it
 * as plain-language findings plus four compact panels. Charts are plain HTML
 * bars rather than Chart.js canvases: they theme for free, render instantly,
 * and keep this page from needing the chart library at all.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { analyzeDeckStats, healthChecks, featuredCardName } from '../utils/deckStats.js';
import { FORMATS, detectFormat } from '../utils/format.js';
import { TAGS } from '../utils/cardTags.js';
import { COLOR_NAMES } from '../utils/mana.js';
import { analyzeDeck } from '../utils/deckRadar.js';
import { CALCULATORS, getGroup } from '../utils/calculatorRegistry.js';
import { CARD_META } from '../data/cards.js';
import { escapeHtml, cardRef, term } from '../data/glossary.js';
import { cardImageUrl, findCard } from '../data/images.js';
import { curveCards, deckProfile } from '../utils/deckProfile.js';
import { bulletList } from '../utils/viz.js';

const NAME = 'overview';
const TYPE_LABEL = {
    creatures: 'Creatures', planeswalkers: 'Planeswalkers', battles: 'Battles', artifacts: 'Artifacts',
    enchantments: 'Enchantments', instants: 'Instants', sorceries: 'Sorceries', lands: 'Lands', other: 'Other'
};
const TYPE_VAR = {
    creatures: 'creature', planeswalkers: 'planeswalker', battles: 'battle', artifacts: 'artifact',
    enchantments: 'enchantment', instants: 'instant', sorceries: 'sorcery', lands: 'land', other: 'artifact'
};
const STATUS_LABEL = { good: 'Looks good', warn: 'Worth a look', bad: 'Needs attention', info: 'Note' };
const GENERIC_TOOLS = ['odds', 'manabase', 'manadev', 'hands', 'mulligan', 'lands', 'compare'];

let onPlay = true;
let debouncedUpdate = null;
/** The mana-curve bar whose cards are listed (0…7), or null. */
let curvePick = null;
/** Deck stats from the last render; picking a curve bar re-renders only the curve. */
let lastStats = null;

const pct = (p, digits = 0) => `${(p * 100).toFixed(digits)}%`;

function manaPip(color) {
    return `<span class="ms ms-${color.toLowerCase()}" aria-hidden="true">${color}</span>`;
}

function artUrl(name, cardsByName) {
    if (!name) return '';
    return CARD_META[name]?.art ?? cardImageUrl(findCard(cardsByName, name) ?? name, 'art_crop');
}

function sourceLink(config) {
    const label = { moxfield: 'Moxfield', archidekt: 'Archidekt', paste: 'a pasted list', manual: 'manual counts' }[config.importSource] ?? null;
    if (!label) return '';
    if (config.importUrl && /^https:\/\/(www\.)?(moxfield|archidekt)\.com\//.test(config.importUrl)) {
        return `from <a href="${escapeHtml(config.importUrl)}" target="_blank" rel="noopener">${label} ↗</a>`;
    }
    return `from ${label}`;
}

// ── Sections ────────────────────────────────────────────────────────────────

function renderHero(config, stats, format) {
    const featured = featuredCardName(config);
    const pref = config.format ?? 'auto';
    const detected = FORMATS[detectFormat({ deckSize: stats.deckSize, commanderName: config.commanderName })];
    const name = config.deckName || (config.commanderName ? `${config.commanderName}` : 'Your deck');
    const identity = stats.identity.length
        ? stats.identity.map(manaPip).join('')
        : '<span class="ov-muted">Colourless</span>';
    const isExample = !config.deckId && config.importUrl === DeckConfig.DEFAULT_DECK_URL;

    return `
        ${isExample ? `
        <div class="ov-welcome" role="note">
            <span class="ov-welcome-text"><strong>You’re looking at an example deck.</strong> Load your own from Moxfield, Archidekt or a pasted list — every page updates to match.</span>
            <button class="btn btn-primary btn-sm" type="button" data-ov-deck>Load your deck</button>
        </div>` : ''}
        ${featured ? `<div class="ov-hero-art" style="background-image:url('${artUrl(featured, config.cardsByName)}')" aria-hidden="true"></div>` : ''}
        <div class="ov-hero-body">
            <div class="ov-eyebrow">${escapeHtml(format.label)} deck ${sourceLink(config)}</div>
            <h2 class="ov-hero-name">${escapeHtml(name)}</h2>
            ${config.commanderName ? `<div class="ov-hero-sub">Commander ${cardRef(config.commanderName)}</div>` : ''}
            <dl class="ov-hero-stats">
                <div><dt>Cards</dt><dd>${stats.deckSize}</dd></div>
                <div><dt>Lands</dt><dd>${stats.lands}</dd></div>
                <div><dt>${term('mv', 'Avg. mana value')}</dt><dd>${stats.curve.average.toFixed(2)}</dd></div>
                <div><dt>Colours</dt><dd class="ov-identity">${identity}</dd></div>
            </dl>
            <div class="ov-hero-controls">
                <label class="ov-control">
                    <span>Format</span>
                    <select id="ov-format" class="field field-sm">
                        <option value="auto"${pref === 'auto' ? ' selected' : ''}>Auto — ${escapeHtml(detected.label)}</option>
                        ${Object.values(FORMATS).map(f => `<option value="${f.key}"${pref === f.key ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
                    </select>
                </label>
                ${format.firstPlayerDraws ? '' : `
                <div class="seg seg-sm" role="group" aria-label="Turn order">
                    <button class="seg-btn${onPlay ? ' active' : ''}" type="button" data-ov-play="1" aria-pressed="${onPlay}">On the play</button>
                    <button class="seg-btn${!onPlay ? ' active' : ''}" type="button" data-ov-play="0" aria-pressed="${!onPlay}">On the draw</button>
                </div>`}
                <button class="btn btn-ghost btn-sm" type="button" data-ov-deck>Change deck</button>
                <button class="btn btn-ghost btn-sm" type="button" data-open-guide="overview">How it works</button>
            </div>
        </div>`;
}

function renderFindings(findings) {
    if (findings.length === 0) {
        return '<p class="ov-empty">Import a decklist to see health checks.</p>';
    }
    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    return findings
        .slice()
        .sort((a, b) => order[a.status] - order[b.status])
        .map(f => `
            <article class="finding finding-${f.status}">
                <div class="finding-head">
                    <span class="finding-status">${f.color ? manaPip(f.color) : `<span class="finding-dot" aria-hidden="true"></span>`}<span>${STATUS_LABEL[f.status]}</span></span>
                    <span class="finding-value">${escapeHtml(f.value)}</span>
                </div>
                <h3 class="finding-title">${escapeHtml(f.title)}</h3>
                <p class="finding-detail">${f.detail}</p>
                ${findingLink(f.id)}
            </article>`).join('');
}

/** Each check links to the page that explains it in depth. */
function findingLink(id) {
    const tab = id === 'lands' ? 'lands'
        : id === 'opener' ? 'hands'
            : id.startsWith('color-') ? 'manabase'
                : id.startsWith('role-') ? 'odds'
                    : null;
    if (!tab || !CALCULATORS[tab]) return '';
    return `<a class="finding-link" href="?tab=${tab}" data-tab-link="${tab}">${escapeHtml(CALCULATORS[tab].name)} →</a>`;
}

function renderCurve(stats) {
    const { buckets, average, median, nonlandCount } = stats.curve;
    if (nonlandCount === 0) return '<p class="ov-empty">Import a decklist to see the curve.</p>';
    const max = Math.max(...buckets.map(b => b.total), 1);
    const types = ['creatures', 'planeswalkers', 'battles', 'artifacts', 'enchantments', 'instants', 'sorceries'];
    const present = types.filter(t => buckets.some(b => b.byType[t] > 0));
    const avgPos = Math.min(7, average) / 7;
    if (curvePick != null && !(buckets[curvePick]?.total > 0)) curvePick = null;

    const cols = buckets.map((b, i) => {
        const segs = present.filter(t => b.byType[t] > 0).map(t =>
            `<span class="bar-seg" style="flex:${b.byType[t]};background:var(--type-${TYPE_VAR[t]})" data-tip="${b.byType[t]} ${TYPE_LABEL[t].toLowerCase()} at ${b.mv}"></span>`).join('');
        const label = `${b.total} ${b.total === 1 ? 'card' : 'cards'} at mana value ${b.mv}`;
        return `
            <button type="button" class="vbar viz-curve-bar" data-ov-mv="${i}" aria-pressed="${curvePick === i}" aria-controls="ov-curve-cards" aria-label="${label}"${b.total ? '' : ' disabled'}>
                <span class="vbar-value">${b.total || ''}</span>
                <span class="vbar-track"><span class="vbar-fill" style="height:${(b.total / max) * 100}%">${segs}</span></span>
                <span class="vbar-label">${b.mv}</span>
            </button>`;
    }).join('');

    return `
        <div class="vbars ov-curve-bars" role="group" aria-label="Mana curve: ${buckets.map(b => `${b.total} at ${b.mv}`).join(', ')}. Pick a bar to list its cards.">
            ${cols}
            <span class="vbars-marker" style="left:calc(${(avgPos * 7 + 0.5) / 8 * 100}% )" data-tip="Average mana value ${average.toFixed(2)}" aria-hidden="true"></span>
        </div>
        <div class="legend">${present.map(t => `<span class="legend-item"><span class="legend-swatch" style="background:var(--type-${TYPE_VAR[t]})"></span>${TYPE_LABEL[t]}</span>`).join('')}</div>
        <div class="ov-curve-cards" id="ov-curve-cards" aria-live="polite">${curveCardsHtml(stats)}</div>
        <p class="ov-note">${nonlandCount} nonland cards · median mana value ${median}</p>`;
}

/** The cards behind the picked mana-curve bar, grouped by type, with previews. */
function curveCardsHtml() {
    if (curvePick == null) return '<p class="ov-curve-hint">Pick a bar to list its cards.</p>';
    const { cardsByName } = DeckConfig.getDeckConfig();
    const { total, groups } = curveCards(cardsByName, curvePick);
    const mv = curvePick === 7 ? '7 or more' : String(curvePick);
    return `
        <div class="ov-curve-list">
            <div class="ov-curve-list-head">
                <strong>${total} ${total === 1 ? 'card' : 'cards'} at mana value ${mv}</strong>
                <button type="button" class="btn btn-ghost btn-sm" data-ov-mv-close>Close</button>
            </div>
            ${groups.map(g => `
                <div class="ov-curve-group">
                    <span class="ov-curve-type"><span class="legend-swatch" style="background:var(--type-${TYPE_VAR[g.type] ?? 'artifact'})"></span>${escapeHtml(TYPE_LABEL[g.type] ?? 'Other')} <span class="ov-curve-n">${g.count}</span></span>
                    <span class="ov-curve-names">${g.cards.map(c => `${cardRef(c.name)}${c.count > 1 ? `<span class="ov-curve-n">×${c.count}</span>` : ''}`).join('')}</span>
                </div>`).join('')}
        </div>`;
}

function renderHands(stats, format) {
    const { openingDist, keepable, dropsBy, expectedInHand } = stats.odds;
    const max = Math.max(...openingDist, 0.0001);
    const bars = openingDist.map((p, k) => `
        <div class="vbar${k >= 2 && k <= 4 ? ' is-keep' : ''}">
            <span class="vbar-value">${p >= 0.005 ? pct(p) : ''}</span>
            <span class="vbar-track"><span class="vbar-fill" style="height:${(p / max) * 100}%"></span></span>
            <span class="vbar-label">${k}</span>
        </div>`).join('');
    const drops = Object.entries(dropsBy).map(([turn, p]) => `
        <tr>
            <th scope="row">Turn ${turn}</th>
            <td><span class="meter"><span class="meter-fill tone-${p >= 0.8 ? 'good' : p >= 0.6 ? 'warn' : 'bad'}" style="width:${p * 100}%"></span></span></td>
            <td class="num">${pct(p)}</td>
        </tr>`).join('');
    return `
        <div class="ov-hands-split">
            <div>
                <div class="vbars vbars-sm" role="img" aria-label="Lands in opening hand">${bars}</div>
                <p class="ov-note">Lands in your opening seven · <strong>${pct(keepable)}</strong> have 2–4 (${term('keepable', 'keepable')}) · average ${expectedInHand.toFixed(1)}</p>
            </div>
            <div>
                <table class="mini-table">
                    <caption>Chance to have made every land drop</caption>
                    <tbody>${drops}</tbody>
                </table>
                <p class="ov-note">${format.firstPlayerDraws ? 'Everyone draws on turn one in multiplayer.' : (onPlay ? 'On the play — no draw on turn one.' : 'On the draw.')}</p>
            </div>
        </div>
        <a class="ov-card-link" href="?tab=hands" data-tab-link="hands">Draw sample hands →</a>`;
}

function renderColors(stats) {
    if (stats.colors.length === 0) {
        return '<p class="ov-empty">No coloured mana costs found. Import a decklist to check colour sources.</p>';
    }
    const rows = stats.colors.map(c => {
        const p = c.onCurve;
        const tone = p == null ? 'flat' : p >= 0.88 ? 'good' : p >= 0.78 ? 'warn' : 'bad';
        return `
            <div class="color-row">
                <div class="color-row-head">
                    ${manaPip(c.color)}
                    <span class="color-row-name">${COLOR_NAMES[c.color]}</span>
                    <span class="color-row-figs"><strong>${c.sources}</strong> ${term('source', 'sources')} · ${c.pips} ${term('pip', 'pips')} on ${c.cards} cards</span>
                </div>
                ${c.heaviest ? `
                <div class="color-row-check">
                    <span class="meter"><span class="meter-fill tone-${tone}" style="width:${(p ?? 0) * 100}%"></span></span>
                    <span class="num">${p == null ? '—' : pct(p)}</span>
                </div>
                <p class="ov-note">Hardest: ${cardRef(c.heaviest.name)} — ${c.heaviest.pips} pip${c.heaviest.pips === 1 ? '' : 's'} on turn ${Math.max(1, c.heaviest.mv)}${c.needed != null && c.needed > c.sources ? `. About <strong>${c.needed}</strong> sources reach 90%.` : '.'}</p>` : ''}
            </div>`;
    }).join('');
    const colorless = stats.colorlessLands > 0
        ? `<p class="ov-note">${stats.colorlessLands} land${stats.colorlessLands === 1 ? '' : 's'} make only colourless mana.</p>` : '';
    return rows + colorless;
}

function renderProfile(stats, format) {
    const rows = deckProfile(stats, format);
    if (rows.length === 0) return '<p class="ov-empty">Import a decklist to see its profile.</p>';
    const bullets = bulletList(rows.map(r => ({
        label: escapeHtml(r.label),
        value: r.value,
        min: r.min,
        max: r.max,
        range: r.range,
        format: r.format,
        tone: r.tone,
        status: r.status,
        tip: r.tip,
        rangeTip: r.rangeTip,
        sub: r.card ? `${manaPip(r.color)} ${cardRef(r.card)}, turn ${r.turn}` : escapeHtml(r.sub ?? '')
    })));
    const commander = format?.key === 'commander';
    return `
        <p class="ov-profile-key"><span class="ov-profile-swatch" aria-hidden="true"></span><span class="term" tabindex="0" data-tip="The shaded band is where most ${commander ? 'Commander' : (format?.label ?? 'similar')} decks sit — a rule of thumb, not a rule. Hover a band for where it comes from.">Typical range</span>${commander ? '' : ' · role counts have no common guideline outside Commander'}</p>
        ${bullets}
        ${renderRoles(stats)}`;
}

function renderRoles(stats) {
    const entries = Object.entries(TAGS);
    if (Object.keys(stats.tags.byCard).length === 0) return '';
    return `
        <details class="ov-roles">
            <summary>Every role, with its cards</summary>
            <ul class="role-list">${entries.map(([key, meta]) => {
        const count = stats.tags.counts[key] ?? 0;
        const members = stats.tags.members[key] ?? [];
        return `
            <li class="role">
                <details${count === 0 ? ' class="is-empty"' : ''}>
                    <summary>
                        <span class="role-name" data-tip="${escapeHtml(meta.hint)}">${escapeHtml(meta.label)}</span>
                        <span class="role-count">${count}</span>
                    </summary>
                    ${members.length ? `<div class="role-members">${members.map(n => cardRef(n)).join('')}</div>` : '<p class="ov-note">None detected.</p>'}
                </details>
            </li>`;
    }).join('')}</ul>
        </details>`;
}

function toolCard(key, reason, tone) {
    const c = CALCULATORS[key];
    const art = c.card ? CARD_META[c.card]?.art : null;
    return `
        <a class="tool-card${tone ? ` tool-${tone}` : ''}" href="?tab=${key}" data-tab-link="${key}">
            ${art ? `<img class="tool-art" src="${art}" alt="" loading="lazy" decoding="async" width="64" height="64">` : ''}
            <span class="tool-body">
                <span class="tool-group">${escapeHtml(getGroup(c.group)?.label ?? '')}</span>
                <span class="tool-name">${escapeHtml(c.name)}</span>
                <span class="tool-question">${escapeHtml(c.question)}</span>
                ${reason ? `<span class="tool-reason">${escapeHtml(reason)}</span>` : ''}
            </span>
        </a>`;
}

function renderTools(config) {
    const ranked = analyzeDeck(config);
    const inDeck = ranked.filter(r => r.hasCard);
    const likely = ranked.filter(r => !r.hasCard && r.tier === 'likely');
    const sub = document.getElementById('ov-tools-sub');
    if (sub) {
        sub.textContent = inDeck.length
            ? `${inDeck.length} card calculator${inDeck.length === 1 ? ' matches a card' : 's match cards'} in this list. The deck tools work with any deck.`
            : 'No card-specific calculators match this list — the deck tools below work with any deck.';
    }
    const cards = [
        ...inDeck.map(r => toolCard(r.tab, r.reasons[0], 'match')),
        ...likely.slice(0, 3).map(r => toolCard(r.tab, r.reasons[0], 'maybe')),
        ...GENERIC_TOOLS.map(key => toolCard(key, null, null))
    ];
    return cards.join('');
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function calculate() {
    const config = DeckConfig.getDeckConfig();
    const format = DeckConfig.getFormat();
    const effectiveOnPlay = format.firstPlayerDraws ? true : onPlay;
    const stats = analyzeDeckStats(config, { format, onPlay: effectiveOnPlay });
    // Manual-count decks have no card records: fall back to the typed counts.
    if (!DeckConfig.hasCardList()) {
        stats.deckSize = DeckConfig.getDeckSize(true);
        stats.lands = config.lands;
    }
    return { config, format, stats, findings: healthChecks(stats, { format }) };
}

export function updateUI() {
    if (!isCalculatorActive(NAME)) return;
    const { config, format, stats, findings } = calculate();
    lastStats = stats;
    const set = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };
    set('ov-hero', renderHero(config, stats, format));
    set('ov-findings', renderFindings(findings));
    set('ov-curve', renderCurve(stats));
    set('ov-curve-meta', stats.curve.nonlandCount ? `avg ${stats.curve.average.toFixed(2)}` : '');
    set('ov-hands', renderHands(stats, format));
    set('ov-hands-meta', `${pct(stats.odds.keepable)} keepable`);
    set('ov-colors', renderColors(stats));
    set('ov-roles', renderProfile(stats, format));
    set('ov-tools', renderTools(config));

    const sub = document.getElementById('ov-health-sub');
    if (sub) {
        const bad = findings.filter(f => f.status === 'bad').length;
        const warn = findings.filter(f => f.status === 'warn').length;
        sub.textContent = findings.length === 0 ? 'Import a decklist to run the checks.'
            : bad + warn === 0 ? 'Everything checks out against the usual ranges.'
                : `${bad ? `${bad} thing${bad === 1 ? '' : 's'} to fix` : ''}${bad && warn ? ', ' : ''}${warn ? `${warn} worth a look` : ''}.`;
    }
}

export function init() {
    const root = document.getElementById(`${NAME}-tab`);
    root?.addEventListener('change', e => {
        if (e.target.id === 'ov-format') DeckConfig.setFormatPreference(e.target.value);
    });
    root?.addEventListener('click', e => {
        const bar = e.target.closest('[data-ov-mv]');
        if (bar) {
            const i = Number(bar.dataset.ovMv);
            curvePick = curvePick === i ? null : i;
            refreshCurve(i);
            return;
        }
        if (e.target.closest('[data-ov-mv-close]')) {
            const was = curvePick;
            curvePick = null;
            refreshCurve(was);
            return;
        }
        const play = e.target.closest('[data-ov-play]');
        if (play) {
            onPlay = play.dataset.ovPlay === '1';
            updateUI();
            return;
        }
        if (e.target.closest('[data-ov-deck]')) {
            document.getElementById('deck-switcher')?.click();
        }
    });
    // Arrow keys move between curve bars, like one control.
    root?.addEventListener('keydown', e => {
        const bar = e.target.closest?.('[data-ov-mv]');
        if (!bar || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        const bars = [...root.querySelectorAll('[data-ov-mv]:not([disabled])')];
        const at = bars.indexOf(bar);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? bars.length - 1
            : Math.max(0, Math.min(bars.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)));
        bars[next]?.focus();
        e.preventDefault();
    });
    ({ updateUI: debouncedUpdate } = registerCalculator({ name: NAME, calculate, updateUI }));
}

/** Re-render just the curve card, keeping focus on the bar that was used. */
function refreshCurve(focusIndex) {
    const stats = lastStats ?? calculate().stats;
    const el = document.getElementById('ov-curve');
    if (el) el.innerHTML = renderCurve(stats);
    if (focusIndex != null) document.querySelector(`#ov-curve [data-ov-mv="${focusIndex}"]`)?.focus({ preventScroll: true });
}

/** For tests and share links. */
export function getShareParams() {
    return onPlay ? {} : { draw: 1 };
}

export function applyShareParams(params) {
    if (params.get('draw') === '1') onPlay = false;
    debouncedUpdate?.();
}
