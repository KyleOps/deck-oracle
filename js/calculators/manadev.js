/**
 * Mana Development — how fast this deck's mana comes online.
 *
 * The model (ramp classifier + goldfish simulator) lives in
 * utils/manaDevelopment.js and is unit-tested there. This module reads the
 * deck, runs the simulation without blocking the page (5,000 paired games in
 * ~10 ms slices, yielding to the browser between them), caches the result per
 * deck + settings, and renders it.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor, toneFor } from '../utils/components.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import { renderManaCost } from '../utils/mana.js';
import { escapeHtml, cardRef } from '../data/glossary.js';
import { libraryOf } from '../utils/library.js';
import { pct, inflect as plural } from '../utils/text.js';
import * as MD from '../utils/manaDevelopment.js';
import { effectiveOnPlay, syncTurnOrder, turnOrderClicked } from '../utils/turnOrder.js';

const NAME = 'manadev';
const SLICE_MS = 10;
const CACHE_SIZE = 12;

let onPlay = true;
let treasure = false;
let chart = null;
let debouncedUpdate = null;
let runToken = 0;
let reshuffles = 0;
let samples = null; // sample games shown (null = the run's own)
let current = null; // { key, result, lib, format }
let libMemo = null;

const cache = new Map();

const $ = id => document.getElementById(id);

// ── Deck → simulator input ──────────────────────────────────────────────────

/** The simulator library for the active deck (memoised on the deck record). */
export function readInputs() {
    const config = DeckConfig.getDeckConfig();
    const format = DeckConfig.getFormat();
    const cardList = DeckConfig.hasCardList();
    const library = cardList ? libraryOf(config, { format }) : null;
    const commanderCards = library?.commanders.length ? DeckConfig.getCommanders().map(c => c.card) : [];
    const memoKey = [library, ...commanderCards, format.multiplayer, cardList ? '' : config.lands, config.actualCardCount];
    if (!libMemo || libMemo.key.length !== memoKey.length || libMemo.key.some((v, i) => v !== memoKey[i])) {
        const lib = cardList
            ? MD.buildManaLibrary(library, { commanderCards, multiplayer: format.multiplayer })
            : MD.buildCountsLibrary(config);
        libMemo = { key: memoKey, lib };
    }
    return { config, format, lib: libMemo.lib };
}

function settingsFor(format, lib) {
    const treasureMatters = lib.ramp.some(r => r.info.treasure > 0);
    return {
        onPlay: effectiveOnPlay(onPlay, format),
        treasure: treasureMatters && treasure,
        treasureMatters
    };
}

function cacheKey(lib, format, s) {
    return [lib.key, format.key, s.onPlay ? 'play' : 'draw', s.treasure ? 't' : '', lib.target?.name ?? '', lib.target?.mv ?? ''].join('|');
}

/**
 * The page's numbers for the current deck and settings, synchronously (tests,
 * share links). The page itself uses the sliced version in updateUI().
 */
export function calculate() {
    const { format, lib } = readInputs();
    const s = settingsFor(format, lib);
    const key = cacheKey(lib, format, s);
    if (cache.has(key)) return cache.get(key);
    const result = MD.simulateManaDevelopment(lib, { format, onPlay: s.onPlay, treasure: s.treasure });
    remember(key, result);
    return result;
}

function remember(key, result) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
    cache.set(key, result);
}

const yieldToBrowser = () => (globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise(resolve => setTimeout(resolve, 0)));

/** Run the simulation in slices; resolves to the result, or null if superseded. */
async function runSliced(lib, format, s, key, onProgress) {
    const token = ++runToken;
    const run = MD.createRun(lib, { format, onPlay: s.onPlay, treasure: s.treasure });
    const t0 = performance.now();
    let longest = 0;
    for (;;) {
        const start = performance.now();
        let done = false;
        while (!done && performance.now() - start < SLICE_MS) done = MD.runBatch(run, 50);
        longest = Math.max(longest, performance.now() - start);
        if (done) break;
        onProgress?.(run.done / run.games);
        await yieldToBrowser();
        if (token !== runToken) return null;
    }
    const result = MD.finishRun(run);
    if (result) result.timing = { total: performance.now() - t0, longestSlice: longest };
    remember(key, result);
    return result;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function targetLabel(t) {
    if (!t) return 'your top end';
    return t.kind === 'commander' ? cardRef(t.name) : `your top end (${cardRef(t.name)})`;
}

function renderSummary(r) {
    const el = $('md-summary');
    if (!el) return;
    if (!r) {
        el.innerHTML = renderBottomLine(MD.summarize(null));
        return;
    }
    const check = r.mana[MD.CHECK_TURN - 1];
    const reach7 = MD.turnToReach(r.reach, 7);
    const reach7Lands = MD.turnToReach(r.reachLands, 7);
    const t = r.target;
    const stats = [
        {
            label: `Mana on turn ${MD.CHECK_TURN}`,
            tip: `What your lands and ramp can make on turn ${MD.CHECK_TURN} after your land drop, in the typical game. Half of games fall in the range below.`,
            value: String(check.p50),
            size: 'big',
            sub: check.p25 === check.p75 ? `most games: ${check.p50}` : `half of games: ${check.p25}–${check.p75}`
        },
        {
            label: 'Reach 7 mana',
            tip: 'The turn by which half of your games have had 7 mana available.',
            value: reach7 ? `Turn ${reach7}` : `After ${MD.SIM_TURNS}`,
            sub: reach7Lands ? `lands alone: turn ${reach7Lands}` : `lands alone: after turn ${MD.SIM_TURNS}`
        }
    ];
    if (t?.ramp) {
        const p = t.ramp.onCurve;
        stats.push({
            label: t.kind === 'commander' ? 'Commander on curve' : 'Top end on curve',
            tip: `Chance you can cast ${t.name} (mana value ${t.mv}, colours included) by turn ${t.ramp.onCurveTurn}.`,
            value: pct(p),
            color: toneColor(toneFor(p, { good: 0.6, warn: 0.35 })),
            sub: `by turn ${t.ramp.onCurveTurn} · lands alone ${pct(t.lands.onCurve)}`
        });
        stats.push({
            label: 'Turns saved by ramp',
            tip: `Each shuffle is played twice — with your ramp and with every ramp card blank. This is the average difference in the turn ${t.name} becomes castable.`,
            value: r.placeholder ? '—' : t.turnsSaved.toFixed(1),
            sub: r.placeholder ? 'needs a decklist' : 'vs. the same games, lands only'
        });
    }
    el.innerHTML = renderBottomLine(MD.summarize(r)) + renderHeroStats(stats);
}

function renderPending(progress = 0) {
    const el = $('md-summary');
    if (!el) return;
    let bar = el.querySelector('.md-pending-fill');
    if (!bar) {
        el.innerHTML = `
            <div class="md-pending" role="status">
                <span>Playing ${MD.DEFAULT_GAMES.toLocaleString('en-US')} games…</span>
                <span class="md-pending-bar"><span class="md-pending-fill" style="width:0%"></span></span>
            </div>`;
        bar = el.querySelector('.md-pending-fill');
    }
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
}

function renderRail(lib, format, s) {
    syncTurnOrder($('md-order-group'), onPlay, format);
    const tGroup = $('md-treasure-group');
    if (tGroup) tGroup.hidden = !s.treasureMatters;
    const box = $('md-treasure');
    if (box) box.checked = treasure;
    const hint = $('md-treasure-hint');
    if (hint && s.treasureMatters) {
        const makers = lib.ramp.filter(r => r.info.treasure > 0).map(r => cardRef(r.name));
        hint.innerHTML = `Treasure is one-shot mana: each token is spent the first time a ramp spell needs it. Makers in this deck: ${makers.join(', ')}.`;
    }
    const note = $('md-format');
    if (note) {
        const parts = [format.freeMulligan
            ? `${escapeHtml(format.label)}: everyone draws on turn one and the first mulligan is free.`
            : `${escapeHtml(format.label)}: no free mulligan.`];
        if (lib.commanders?.length) parts.push(lib.commanders.length > 1 ? 'Your commanders start in the command zone, so they’re never drawn.' : 'Your commander starts in the command zone, so it’s never drawn.');
        if (lib.placeholder) parts.push('This deck is bare type counts, so only lands are simulated. Import a decklist to count ramp.');
        note.innerHTML = parts.join(' ');
    }
    const facts = $('md-facts');
    if (facts) {
        const counted = MD.countedRamp(lib, { treasure: s.treasure });
        const total = lib.ramp.reduce((n, r) => n + r.count, 0);
        const t = lib.target;
        const rows = [
            ['Cards in library', String(lib.cards.length)],
            ['Lands', String(lib.landCount)],
            ['Ramp the model counts', lib.placeholder ? '—' : String(counted)],
            ['Ramp it can’t count', lib.placeholder ? '—' : String(total - counted)]
        ];
        let html = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
        if (t) {
            html += `<div><dt>${t.kind === 'commander' ? 'Commander' : 'Top end'}</dt><dd class="md-fact-target">${cardRef(t.name)}${renderManaCost(t.cost)}</dd></div>`;
        }
        facts.innerHTML = html;
    }
}

function updateChart(r) {
    const meta = $('md-chart-meta');
    if (meta) meta.textContent = r ? `${r.games.toLocaleString('en-US')} simulated games` : '';
    const keyTarget = $('md-key-target');
    const t = r?.target;
    if (keyTarget) {
        keyTarget.hidden = !t;
        if (t) keyTarget.textContent = `${t.kind === 'commander' ? 'Commander' : 'Top end'}: ${t.mv} mana`;
    }
    if (!$('manadev-chart')) return;
    if (!r) {
        if (chart) { chart.destroy(); chart = null; }
        return;
    }
    const m = r.mana;
    const lands = r.landsOnly;
    const line = (data, extra) => ({ data, pointRadius: 0, pointHoverRadius: 0, borderWidth: 0, fill: false, tension: 0, ...extra });
    const datasets = [
        line(m.map(x => x.p90), { label: '8 games in 10', backgroundColor: TX.greenFill, fill: '+1' }),
        line(m.map(x => x.p10), { label: 'low' }),
        line(m.map(x => x.p75), { label: 'Half of games', backgroundColor: TX.greenFill, fill: '+1' }),
        line(m.map(x => x.p25), { label: 'low-mid' }),
        line(m.map(x => x.p50), { label: 'Typical game', borderColor: TX.green, backgroundColor: TX.green, borderWidth: 2, pointHoverRadius: 4 }),
        line(lands.map(x => x.p50), { label: 'Lands alone', borderColor: TX.mid, backgroundColor: TX.mid, borderWidth: 2, borderDash: [6, 4], pointHoverRadius: 3 })
    ];
    if (t) datasets.push(line(m.map(() => t.mv), { label: 'target', borderColor: TX.amber, borderWidth: 1, borderDash: [3, 4] }));
    chart = createOrUpdateChart(chart, 'manadev-chart', {
        type: 'line',
        data: { labels: m.map(x => String(x.turn)), datasets },
        options: {
            plugins: {
                tooltip: {
                    filter: item => item.datasetIndex === 4,
                    callbacks: {
                        title: items => `Turn ${items[0]?.label ?? ''}`,
                        label: ctx => {
                            const row = m[ctx.dataIndex];
                            const l = lands[ctx.dataIndex];
                            if (!row || !l) return '';
                            return [
                                ` Typical game: ${row.p50} mana`,
                                ` Half of games: ${row.p25}–${row.p75}`,
                                ` 8 games in 10: ${row.p10}–${row.p90}`,
                                ` Lands alone, typical: ${l.p50}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Turn', color: TX.dim } },
                y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Mana available', color: TX.dim } }
            }
        }
    });
}

function gridRows(r) {
    const mv = r.target?.mv ?? 0;
    const hi = Math.max(8, Math.min(14, mv + 2));
    const rows = [];
    for (let k = 2; k <= hi; k++) rows.push(k);
    return rows;
}

function renderGrid(r) {
    const el = $('md-grid');
    if (!el) return;
    if (!r) {
        el.innerHTML = '<div class="tx-empty">Load a deck to see the odds.</div>';
        return;
    }
    const mv = r.target?.mv ?? null;
    const turns = Array.from({ length: MD.SHOWN_TURNS }, (_, i) => i + 1);
    const head = `<tr><th scope="col">Mana</th>${turns.map(t => `<th scope="col">T${t}</th>`).join('')}</tr>`;
    const body = gridRows(r).map(k => {
        const isTarget = mv === k;
        const cells = turns.map(t => {
            const p = r.reach[t]?.[k] ?? 0;
            const cls = [p < 0.005 ? 'is-none' : '', p < 0.05 ? 'is-low' : '', p >= 0.75 ? 'is-high' : '', isTarget && t === r.target?.ramp?.onCurveTurn ? 'is-curve' : ''].filter(Boolean).join(' ');
            // The number without its % sign: "<1" / ">99" keep the honest ends.
            const label = p < 0.005 ? '·' : pct(p).replace('%', '');
            return `<td${cls ? ` class="${cls}"` : ''} style="--p:${Math.round(p * 38)}%" title="${pct(p)} of games had ${k}+ mana by turn ${t}">${label}</td>`;
        }).join('');
        return `<tr${isTarget ? ' class="is-target"' : ''}><th scope="row">${k}+</th>${cells}</tr>`;
    }).join('');
    el.innerHTML = `<table class="md-grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    const meta = $('md-grid-meta');
    if (meta) meta.textContent = 'percent of games';
    const caption = $('md-grid-caption');
    if (caption) {
        caption.innerHTML = 'Each cell is the share of games that had at least that much mana on some turn up to that one.'
            + (r.target ? ` The highlighted row is ${targetLabel(r.target)}’s ${r.target.mv} mana; the outlined cell is casting it on curve (colours are checked in the stats above, not here).` : '');
    }
}

function renderRamp(r, lib) {
    const el = $('md-ramp');
    const meta = $('md-ramp-meta');
    if (!el) return;
    if (!r || lib.placeholder) {
        el.innerHTML = '<div class="tx-empty">Import a decklist to see what your ramp does.</div>';
        if (meta) meta.textContent = '';
        return;
    }
    if (r.ramp.length === 0) {
        el.innerHTML = '<div class="tx-empty">No ramp found — no mana rocks, dorks, land searches or extra land drops in this list.</div>';
        if (meta) meta.textContent = '';
        return;
    }
    if (meta) meta.textContent = `${r.rampCount} counted${r.notCounted ? ` · ${r.notCounted} not` : ''}`;
    const counted = r.ramp.filter(x => x.counted).sort((a, b) => b.castBy4 - a.castBy4 || b.castBy3 - a.castBy3 || a.name.localeCompare(b.name));
    const off = r.ramp.filter(x => !x.counted).sort((a, b) => a.name.localeCompare(b.name));
    const row = (x, isOff) => `
        <tr${isOff ? ' class="is-off"' : ''}>
            <td>
                <div class="md-ramp-name">${cardRef(x.name)}${x.count > 1 ? `<span class="md-ramp-copies">×${x.count}</span>` : ''}${x.mv != null ? `<span class="md-ramp-mv">${x.mv} mana</span>` : ''}</div>
                <div class="md-ramp-read">${escapeHtml(x.info.label)}</div>
            </td>
            <td class="num md-col-seen">${pct(x.seenBy4)}</td>
            <td class="num">${isOff ? '—' : pct(x.castBy3)}</td>
            <td class="num">${isOff ? '—' : pct(x.castBy4)}</td>
        </tr>`;
    el.innerHTML = `
        <table class="md-ramp-table">
            <thead><tr>
                <th scope="col">Card and what the model reads</th>
                <th scope="col" class="md-col-seen">In hand by T4</th>
                <th scope="col">Cast by T3</th>
                <th scope="col">Cast by T4</th>
            </tr></thead>
            <tbody>
                ${counted.map(x => row(x, false)).join('')}
                ${off.length ? `<tr class="md-ramp-group"><td colspan="4">Recognised but not counted</td></tr>${off.map(x => row(x, true)).join('')}` : ''}
            </tbody>
        </table>`;
}

function renderSamples(r, lib) {
    const el = $('md-samples');
    if (!el) return;
    const games = samples ?? r?.samples ?? [];
    if (!r || games.length === 0) {
        el.innerHTML = '<div class="tx-empty">Load a deck with at least seven cards to see sample games.</div>';
        return;
    }
    const t = r.target;
    const html = games.map((g, i) => {
        const last = Math.min(MD.SHOWN_TURNS, Math.max(6, g.targetTurn || 8));
        const lands = g.hand.filter(name => lib.cards.find(c => c.name === name)?.land).length;
        const kept = `${g.hand.length} card${g.hand.length === 1 ? '' : 's'}, ${lands} ${plural(lands, 'land')}`;
        const mull = g.mulligans ? `after ${g.mulligans} mulligan${g.mulligans === 1 ? '' : 's'}` : 'no mulligan';
        const when = t
            ? (g.targetTurn
                ? `${targetLabel(t)} castable on <strong>turn ${g.targetTurn}</strong>${g.landsOnlyTargetTurn ? ` (lands alone: turn ${g.landsOnlyTargetTurn})` : ` (lands alone: after turn ${MD.SIM_TURNS})`}`
                : `${targetLabel(t)} not castable by turn ${MD.SIM_TURNS}`)
            : '';
        const turns = g.turns.slice(0, last).map(e => `
            <li class="md-turn${e.target ? ' is-target' : ''}">
                <span class="md-turn-n">T${e.turn}</span>
                <span class="md-turn-mana" aria-label="${e.mana} mana">${e.mana}${MD.manaPips(e.colors)}</span>
                <span class="md-turn-what">${MD.describeTurn(e)}${e.target ? `<span class="md-turn-flag">← ${t?.kind === 'commander' ? 'commander' : 'top end'} castable</span>` : ''}</span>
            </li>`).join('');
        return `
            <article class="md-game">
                <div class="md-game-head"><span><strong>Game ${i + 1}</strong> · kept ${kept}, ${mull}</span><span>${when}</span></div>
                <ol class="md-turns">${turns}</ol>
            </article>`;
    }).join('');
    el.innerHTML = `
        <p class="tx-caption is-below">Each row is one turn: the mana you had after your land drop (with its colours), the land you played, and the ramp you cast — <span class="md-found">→</span> shows what it found.</p>
        <div class="md-games">${html}</div>
        <p class="md-samples-foot">${games.length} of ${r.games.toLocaleString('en-US')} simulated games${reshuffles ? ', reshuffled' : ''}.</p>`;
}

function render(r, lib) {
    renderSummary(r);
    updateChart(r);
    renderGrid(r);
    renderRamp(r, lib);
    renderSamples(r, lib);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function updateUI() {
    if (!isCalculatorActive(NAME)) return;
    const { format, lib } = readInputs();
    const s = settingsFor(format, lib);
    renderRail(lib, format, s);
    const key = cacheKey(lib, format, s);
    if (current?.key !== key) samples = null;
    if (lib.cards.length < 7) {
        current = { key, result: null, lib, format };
        render(null, lib);
        return;
    }
    const cached = cache.get(key);
    if (cached) {
        current = { key, result: cached, lib, format };
        render(cached, lib);
        return;
    }
    renderPending(0);
    runSliced(lib, format, s, key, renderPending).then(result => {
        if (!result || !isCalculatorActive(NAME)) return;
        current = { key, result, lib, format };
        render(result, lib);
    }).catch(err => console.error('Mana development simulation failed:', err));
}

function reshuffle() {
    if (!current?.result) return;
    const { format, lib } = current;
    const s = settingsFor(format, lib);
    reshuffles += 1;
    const run = MD.createRun(lib, { format, onPlay: s.onPlay, treasure: s.treasure, games: MD.SAMPLE_GAMES, seed: MD.SEED + reshuffles * 7919 });
    MD.runBatch(run);
    samples = run.sampleGames;
    renderSamples(current.result, lib);
}

export function init() {
    const root = document.getElementById(`${NAME}-tab`);
    if (!root) return;
    root.addEventListener('click', e => {
        const order = turnOrderClicked(e);
        if (order !== null) {
            onPlay = order;
            updateUI();
            return;
        }
        if (e.target.closest('#md-reshuffle')) reshuffle();
    });
    root.addEventListener('change', e => {
        if (e.target.id === 'md-treasure') {
            treasure = e.target.checked;
            updateUI();
        }
    });
    ({ updateUI: debouncedUpdate } = registerCalculator({ name: NAME, calculate, updateUI }));
}

// ── Share links ──────────────────────────────────────────────────────────────

/** Non-default settings as URL params. */
export function getShareParams() {
    const out = {};
    if (!onPlay) out.mddraw = 1;
    if (treasure) out.mdtreasure = 1;
    return out;
}

/** Apply share params (only the exact value 1 turns a setting on). */
export function applyShareParams(params) {
    const get = k => (params?.has?.(k) ? params.get(k) : null);
    if (get('mddraw') === '1') onPlay = false;
    if (get('mdtreasure') === '1') treasure = true;
    debouncedUpdate?.();
}

/** Current settings (for tests). */
export function getSettings() {
    return { onPlay, treasure };
}
