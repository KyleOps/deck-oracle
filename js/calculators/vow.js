/**
 * Kamahl's Druidic Vow — {X}{G}{G} legendary sorcery. The page: readInputs()
 * (the DOM and the deck → a plain object), the model, then rendering. The
 * maths lives in js/utils/models/vow.js; the X control, chart, samples, table
 * and wiring are the big-spell kit's (js/utils/bigSpells.js), shared with
 * Genesis Wave.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor, toneFor } from '../utils/components.js';
import { quantile } from '../utils/stats.js';
import { commanderNamesOf, isPermanent } from '../utils/library.js';
import { avg, pct, plural } from '../utils/text.js';
import {
    barsHTML, bindBigSpellControls, createSampler, noticeHTML, paybackChart, paybackSampleHTML, readValueInput,
    readXSpell, renderEmptyAnswer, renderHowItCompares, renderXSweep, setXInputs, syncXControl
} from '../utils/bigSpells.js';
import { expandCards } from '../utils/models/cardList.js';
import { ON_STACK, VOW, analyze, buildVowLibrary, classifyForVow, commanderCopiesVow, summarize, vowSweep } from '../utils/models/vow.js';

/** Inputs share links carry as they are (js/utils/share.js). Names and ids are in links already shared: never rename them. */
export const shareInputs = Object.freeze([
    { param: 'vowX', id: 'vow-xSlider', min: 0, max: 30 },
    { param: 'vowLand', id: 'vow-land-value', min: 0, max: 20, float: true },
    { param: 'vowCard', id: 'vow-card-value', min: 0, max: 20, float: true }
]);

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
    const { cards, library, deckSize, maxX, x, deckKey } = readXSpell('vow', deck, {
        onStack: ON_STACK, build: buildVowLibrary, maxX: CONFIG.MAX_X, defaultX: CONFIG.DEFAULT_X
    });
    const doubleCast = resolveCopy(commanderNamesOf(deck));
    const settings = {
        copies: doubleCast ? 2 : 1,
        landValue: readValueInput('vow-land-value', VOW.DEFAULT_LAND_VALUE),
        cardValue: readValueInput('vow-card-value', VOW.DEFAULT_CARD_VALUE)
    };
    return { deckSize, x, maxX, library, cards, doubleCast, settings, deckKey };
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
    chart = paybackChart(chart, 'vow', {
        points: xs,
        current: config.x,
        bars: { label: 'Lands & legends', data: xs.map(x => +(results[x]?.expectedHits ?? 0).toFixed(2)) },
        payback: xs.map(x => +((results[x]?.payback?.paybackProbability ?? 0) * 100).toFixed(1)),
        xTitle: 'X',
        yTitle: 'Lands & legends',
        title: x => `X=${x} · ${x + VOW.EXTRA_MANA} mana`,
        barLabel: item => {
            const r = results[Number(item.label)];
            return `${avg(item.parsed.y)} hits (${avg(r?.expectedLands ?? 0)} lands, ${avg(r?.expectedLegends ?? 0)} legends)`;
        },
        onPick: setX
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
    el.innerHTML = decks.map((library, index) => {
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
        return paybackSampleHTML({
            index, rows, maxRows: CONFIG.SAMPLE_ROWS, hitUnit: 'hit',
            put: { manaValue, lands, cards: hits }, settings: config.settings, threshold,
            lead: `<strong>${plural(lands, 'land')}</strong>, <strong>${plural(hits - lands, 'legend')}</strong>`
        });
    }).join('');
}

function renderDetails(config, results, a) {
    renderXSweep('vow-comparisonTable', {
        x: config.x,
        recommended: a.reliableX,
        results,
        maxX: config.maxX,
        tableMax: CONFIG.TABLE_MAX_X,
        hits: r => r.expectedHits,
        seen: r => r.seen,
        columns: [
            { label: 'Lands', render: row => avg(row.r.expectedLands) },
            { label: 'Legends', render: row => avg(row.r.expectedLegends) }
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
        distEl.innerHTML = '<p class="tx-caption is-below">Exact odds of each result from your card counts; a hit is a land or a legendary permanent the Vow can put into play. The highlighted bar is the typical cast.</p>'
            + barsHTML(bars, { scale: peak });
    }
}

function setX(x) {
    setXInputs('vow', x);
    updateUI();
}

export function updateUI() {
    const { config, results } = calculate();
    syncXControl('vow', config.x, config.maxX, `${config.x + VOW.EXTRA_MANA} mana · {X}{G}{G}`);

    if (config.deckSize === 0 || !results[config.x]) {
        renderEmptyAnswer('vow', 'Add cards to your deck to see what Kamahl’s Druidic Vow does.');
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
            bindBigSpellControls('vow', {
                update: debouncedUpdate,
                setX,
                values: ['vow-land-value', 'vow-card-value'],
                reshuffle: () => {
                    sampler.reshuffle();
                    renderSamples(readInputs());
                }
            });
            document.getElementById('vow-doubleCast')?.addEventListener('change', () => {
                copyChosenByUser = true;
                updateUI();
            });
        }
    });
}
