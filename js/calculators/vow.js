/**
 * Kamahl's Druidic Vow — {X}{G}{G} legendary sorcery. The page: readInputs()
 * (the DOM and the deck → a plain object), the model, then rendering. The
 * maths lives in js/utils/models/vow.js.
 */

import { createOrUpdateChart, TX_CHART } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, renderSweepTable, pBarCell, toneColor, toneFor } from '../utils/components.js';
import { scoreBattlefieldValue } from '../utils/payback.js';
import { quantile } from '../utils/stats.js';
import { commanderNamesOf, isPermanent } from '../utils/library.js';
import { avg, pct, plural } from '../utils/text.js';
import {
    barsHTML, bindXPresets, createSampler, fade, noticeHTML, readX, renderHowItCompares, sampleCardHTML, syncXControl
} from '../utils/bigSpells.js';
import { cardListKey, deckCardList, expandCards } from '../utils/models/cardList.js';
import { VOW, analyze, buildVowLibrary, classifyForVow, commanderCopiesVow, summarize, vowSweep } from '../utils/models/vow.js';

const CONFIG = Object.freeze({
    MAX_X: 30,
    DEFAULT_X: 7,
    TABLE_MAX_X: 20,
    SAMPLE_COUNT: 4,
    SAMPLE_ROWS: 12
});

const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;
let lastCommander;          // undefined until the first render
let copyChosenByUser = false;

// ── Inputs ───────────────────────────────────────────────────────────────────

function readNumber(id, fallback) {
    const value = parseFloat(typeof document !== 'undefined' ? document.getElementById(id)?.value : NaN);
    return Number.isFinite(value) ? Math.min(20, Math.max(0, value)) : fallback;
}

/**
 * Whether the Vow is copied. Follows the commanders (checked automatically
 * when one copies it) until the player — or a share link — sets it by hand.
 * @param {string[]} commanders
 */
function resolveCopy(commanders) {
    const auto = commanderCopiesVow(commanders);
    const box = typeof document !== 'undefined' ? document.getElementById('vow-doubleCast') : null;
    if (!box) return auto;
    const zone = commanders.join('\u0001');
    if (zone !== lastCommander) {
        if (lastCommander !== undefined) copyChosenByUser = false;
        lastCommander = zone;
        if (!copyChosenByUser) box.checked = auto;
    }
    return box.checked;
}

/** The page's inputs and the library they apply to (defaults when not mounted). */
export function readInputs() {
    const deck = DeckConfig.getDeckConfig();
    const cards = deckCardList(deck);
    const library = buildVowLibrary(cards, deck);
    const maxX = Math.max(1, Math.min(library.deckSize, CONFIG.MAX_X));
    const x = Math.min(maxX, readX('vow', CONFIG.DEFAULT_X));
    const doubleCast = resolveCopy(commanderNamesOf(deck));
    const settings = {
        copies: doubleCast ? 2 : 1,
        landValue: readNumber('vow-land-value', VOW.DEFAULT_LAND_VALUE),
        cardValue: readNumber('vow-card-value', VOW.DEFAULT_CARD_VALUE)
    };
    const deckKey = cards.length ? cardListKey(cards) : `counts:${library.entries.map(e => e.count).join(',')}`;
    return { deckSize: library.deckSize, x, maxX, library, cards, doubleCast, settings, deckKey };
}

/** Outcomes for every X up to the slider maximum. */
export function calculate() {
    const config = readInputs();
    return { config, results: vowSweep(config.library, config.maxX, config.settings, config.deckKey) };
}

/** Share-link settings beyond the legacy sliders. */
export function getShareParams() {
    const box = document.getElementById('vow-doubleCast');
    return box ? { vowCopy: box.checked ? 1 : 0 } : {};
}

export function applyShareParams(params) {
    const value = params?.get?.('vowCopy');
    if (value !== '0' && value !== '1') return;
    const box = document.getElementById('vow-doubleCast');
    if (!box) return;
    box.checked = value === '1';
    copyChosenByUser = true;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderAnswer(config, a) {
    const el = document.getElementById('vow-stats');
    if (!el) return;
    const { html, tone } = summarize(a);
    const p = a.payback?.paybackProbability ?? 0;
    const hero = renderHeroStats([
        {
            label: 'Pays for itself', value: pct(p), size: 'big', color: toneColor(toneFor(p)),
            sub: `reaches ${a.mana} value${a.legendsKnown ? '' : ' · lands only'}`,
            term: 'payback'
        },
        {
            label: 'Lands & legends', value: avg(a.expectedHits),
            sub: a.low === a.high ? `almost always ${a.low}` : `${a.low}–${a.high} in 8 of 10 casts`,
            tip: 'Average number of lands and legendary permanents with mana value X or less among the cards the Vow looks at — the ones it puts onto the battlefield.'
        },
        {
            label: 'Value into play', value: avg(a.payback?.expectedEffectiveValue ?? 0),
            sub: `${avg(a.payback?.expectedManaValue ?? 0)} printed mana value`,
            tip: 'The printed mana value of everything put onto the battlefield, plus the land and per-permanent credit set on the left. Compared with the mana spent to decide whether the cast paid for itself.'
        },
        {
            label: 'Cards it can hit', value: `${a.eligible}`,
            sub: `${a.eligibleLands} lands + ${a.eligibleLegends} legends`,
            tip: 'Lands and legendary permanents in your library with mana value X or less. Everything else the Vow looks at goes to the graveyard.'
        }
    ]);
    const notice = config.cards.length ? '' : noticeHTML('Card-type counts can’t tell which permanents are legendary, so only lands are counted. Import your decklist for the full answer.', 'warn');
    el.innerHTML = renderBottomLine({ html, tone }) + notice + hero;

    const target = document.getElementById('vow-payback-target');
    if (target) target.textContent = `${a.mana} value at X=${a.x}`;
}

function renderChart(config, results) {
    const top = Math.min(config.maxX, Math.max(15, config.x + 5));
    const xs = Array.from({ length: top }, (_, i) => i + 1);
    chart = createOrUpdateChart(chart, 'vow-chart', {
        type: 'bar',
        data: {
            labels: xs.map(String),
            datasets: [
                {
                    label: 'Lands & legends',
                    data: xs.map(x => +(results[x]?.expectedHits ?? 0).toFixed(2)),
                    backgroundColor: xs.map(x => x === config.x ? TX_CHART.amber : fade(TX_CHART.blue, 0.45)),
                    hoverBackgroundColor: xs.map(x => x === config.x ? TX_CHART.amber : fade(TX_CHART.blue, 0.7)),
                    borderRadius: 3,
                    maxBarThickness: 34,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Pays for itself',
                    type: 'line',
                    data: xs.map(x => +((results[x]?.payback?.paybackProbability ?? 0) * 100).toFixed(1)),
                    borderColor: TX_CHART.green,
                    backgroundColor: TX_CHART.green,
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: xs.map(x => x === config.x ? 5 : 2),
                    pointBackgroundColor: xs.map(x => x === config.x ? TX_CHART.green : TX_CHART.bg),
                    pointBorderColor: TX_CHART.green,
                    yAxisID: 'y2',
                    order: 1
                }
            ]
        },
        options: {
            onClick: (event, elements) => {
                const index = elements?.[0]?.index;
                if (index != null) setX(index + 1);
            },
            onHover: (event, elements) => {
                const target = event?.native?.target;
                if (target) target.style.cursor = elements?.length ? 'pointer' : 'default';
            },
            scales: {
                x: { title: { display: true, text: 'X', color: TX_CHART.dim }, grid: { display: false } },
                y: { beginAtZero: true, title: { display: true, text: 'Lands & legends', color: TX_CHART.dim } },
                y2: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { stepSize: 25, callback: v => `${v}%` } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => `X=${items[0].label} · ${Number(items[0].label) + VOW.EXTRA_MANA} mana`,
                        label: item => {
                            if (item.datasetIndex === 1) return `Pays for itself: ${pct(item.parsed.y / 100)}`;
                            const r = results[Number(item.label)];
                            return `${avg(item.parsed.y)} hits (${avg(r?.expectedLands ?? 0)} lands, ${avg(r?.expectedLegends ?? 0)} legends)`;
                        }
                    }
                }
            }
        }
    });
}

function renderSamples(config) {
    const el = document.getElementById('vow-samples');
    const header = document.getElementById('vow-samples-title');
    const seen = Math.min(config.x * config.settings.copies, config.deckSize);
    if (header) header.textContent = `Sample casts at X=${config.x}${config.doubleCast ? ` (copied, ${seen} cards)` : ''}`;
    if (!el) return;
    if (!config.cards.length) {
        el.innerHTML = noticeHTML('Sample casts need a decklist with card names — import one from the deck menu.', 'flat');
        return;
    }
    const threshold = config.x + VOW.EXTRA_MANA;
    const decks = sampler.get(config.deckKey, () => expandCards(config.cards));
    el.innerHTML = decks.map((library, i) => {
        const looked = library.slice(0, seen);
        let hits = 0;
        let lands = 0;
        let manaValue = 0;
        const rows = looked.map(card => {
            const { isLand, isLegendary, isValid } = classifyForVow(card.type_line);
            const hit = isValid && card.cmc <= config.x;
            if (hit) {
                hits++;
                manaValue += card.cmc;
                if (isLand) lands++;
            }
            const permanent = isPermanent(card.type_line);
            return {
                name: card.name,
                type: isLand ? 'land' : card.types[0] ?? 'artifact',
                mv: isLand && card.cmc === 0 ? '' : card.cmc,
                fate: hit ? (isLegendary ? 'legend → play' : 'land → play') : (isLegendary ? 'costs too much' : (permanent ? 'not legendary' : 'graveyard')),
                state: hit ? (isLegendary ? 'star' : 'hit') : 'miss'
            };
        });
        const scored = scoreBattlefieldValue({ manaValue, lands, cards: hits }, { ...config.settings, threshold });
        const shown = rows.slice(0, CONFIG.SAMPLE_ROWS);
        const hidden = rows.slice(CONFIG.SAMPLE_ROWS);
        return sampleCardHTML({
            title: `Shuffle ${i + 1}`,
            tag: scored.paidForItself ? 'Pays for itself' : 'Falls short',
            tone: scored.paidForItself ? 'good' : 'bad',
            rows: shown,
            more: hidden.length ? `+ ${plural(hidden.length, 'more card')} (${plural(hidden.filter(r => r.state !== 'miss').length, 'hit')})` : '',
            footer: `<strong>${plural(lands, 'land')}</strong>, <strong>${plural(hits - lands, 'legend')}</strong> · value <strong>${avg(scored.effectiveValue)}</strong> of ${threshold} needed`
        });
    }).join('');
}

function renderDetails(config, results, a) {
    const rows = [];
    for (let x = 1; x <= Math.min(config.maxX, CONFIG.TABLE_MAX_X); x++) {
        const r = results[x];
        if (!r) continue;
        rows.push({ x, r, delta: results[x - 1] ? r.expectedHits - results[x - 1].expectedHits : null });
    }
    renderSweepTable('vow-comparisonTable', {
        current: config.x,
        recommended: a.reliableX,
        rows,
        columns: [
            { label: 'X', align: 'left', render: row => `${row.x}` },
            { label: 'Mana', render: row => `${row.r.mana}` },
            { label: 'Lands', render: row => avg(row.r.expectedLands) },
            { label: 'Legends', render: row => avg(row.r.expectedLegends) },
            { label: 'Change', render: row => row.delta == null ? '—' : `+${avg(row.delta, 2)}` },
            { label: 'Hit rate', align: 'left', render: row => pBarCell(row.r.seen ? row.r.expectedHits / row.r.seen : 0, 'var(--tx-flat)') },
            { label: 'Pays for itself', render: row => `<span style="color:${toneColor(toneFor(row.r.payback.paybackProbability))}">${pct(row.r.payback.paybackProbability)}</span>` }
        ]
    });

    const distEl = document.getElementById('vow-dist');
    const sub = document.getElementById('vow-dist-sub');
    if (sub) sub.textContent = `at X=${config.x}`;
    if (distEl) {
        const pmf = a.pmf ?? [];
        const peak = Math.max(...pmf, 0.0001);
        const typical = quantile(pmf, 0.5);
        const bars = pmf.map((p, k) => ({ k, p })).filter(({ p }) => p >= 0.0005).map(({ k, p }) => ({
            label: plural(k, 'hit'),
            value: p,
            tone: k === typical ? 'accent' : 'flat'
        }));
        distEl.innerHTML = '<p class="bs-caption">Exact odds of each result from your card counts; a hit is a land or a legendary permanent the Vow can put into play. The highlighted bar is the typical cast.</p>'
            + barsHTML(bars, { scale: peak });
    }
}

function setX(x) {
    const slider = document.getElementById('vow-xSlider');
    const input = document.getElementById('vow-xValue');
    if (slider) slider.value = x;
    if (input) input.value = x;
    updateUI();
}

export function updateUI() {
    const { config, results } = calculate();
    syncXControl('vow', config.x, config.maxX, `${config.x + VOW.EXTRA_MANA} mana · {X}{G}{G}`);

    if (config.deckSize === 0 || !results[config.x]) {
        const el = document.getElementById('vow-stats');
        if (el) el.innerHTML = renderBottomLine({ html: 'Add cards to your deck to see what Kamahl’s Druidic Vow does.', tone: 'flat' });
        chart?.destroy?.();
        chart = null;
        return;
    }

    const a = analyze(results, config.x);
    renderAnswer(config, a);
    renderChart(config, results);
    renderSamples(config);
    renderDetails(config, results, a);
    renderHowItCompares('big-spell-comparison', {
        x: config.x, source: 'vow', deckKey: config.deckKey, options: { vowDoubleCast: config.doubleCast }
    });
}

export function init() {
    registerCalculator({
        name: 'vow',
        calculate,
        updateUI,
        inputs: ['x'],
        init: debouncedUpdate => {
            bindXPresets('vow', setX);
            document.getElementById('vow-doubleCast')?.addEventListener('change', () => {
                copyChosenByUser = true;
                updateUI();
            });
            ['vow-land-value', 'vow-card-value'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', debouncedUpdate);
            });
            document.getElementById('vow-reshuffle-btn')?.addEventListener('click', () => {
                sampler.reshuffle();
                renderSamples(readInputs());
            });
        }
    });
}
