/**
 * Primal Surge — {8}{G}{G} sorcery. The page: readInputs() (the DOM and the
 * deck → a plain object), the model, then rendering. The maths lives in
 * js/utils/models/surge.js.
 */

import { formatNumber } from '../utils/simulation.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor, toneFor } from '../utils/components.js';
import { describeDots, dotPlot } from '../utils/viz.js';
import { closeCast, playCast, syncCast } from '../utils/castAnimation.js';
import { shuffle } from '../utils/random.js';
import { isPermanent, libraryOf, sameCard } from '../utils/library.js';
import { avg, pct, plural } from '../utils/text.js';
import {
    PAYBACK_LEGEND, bindBigSpellControls, castImage, createSampler, noticeHTML, paybackChart, renderEmptyAnswer,
    renderHowItCompares, sampleCardHTML, syncDotsView, valueBandsTable
} from '../utils/bigSpells.js';
import { deckCardList, expandCards } from '../utils/models/cardList.js';
import {
    ON_STACK, PRIMAL_SURGE, SURGE, cachedValuePmf, calculateSurgeRunValue, summarize, surgeCastPlan, surgeDots,
    surgeFromCounts, surgeFromList, surgePaybackFor, surgeResult, surgeRunPmf, surgeSettings, valueText
} from '../utils/models/surge.js';

/** Inputs share links carry as they are (js/utils/share.js). Names and ids are in links already shared: never rename them. */
export const shareInputs = Object.freeze([
    { param: 'surgeThreshold', id: 'surge-payback-threshold', min: 0.25, max: 100, float: true },
    { param: 'surgeLand', id: 'surge-land-value', min: 0, max: 20, float: true },
    { param: 'surgeCard', id: 'surge-card-value', min: 0, max: 20, float: true }
]);

const CONFIG = Object.freeze({
    SAMPLE_COUNT: 4,
    SAMPLE_ROWS: 10
});

const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;

/** Which quantity the "out of 100 casts" dots are stacked by. */
let dotView = 'permanents';

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The value model from the page's inputs (defaults when not mounted). */
function readSettings() {
    const read = id => (typeof document !== 'undefined' ? document.getElementById(id)?.value : undefined);
    return surgeSettings({
        threshold: read('surge-payback-threshold'),
        landValue: read('surge-land-value'),
        cardValue: read('surge-card-value')
    });
}

/**
 * The library Primal Surge resolves into, and the page's value model.
 *
 * With a decklist, the cast Surge is removed only when the list names it. With
 * type counts only, one instant or sorcery is assumed to be the Surge being
 * cast, and mana values are unknown (no payback odds).
 */
export function readInputs() {
    const deck = DeckConfig.getDeckConfig();
    const cards = deckCardList(deck, ON_STACK);
    const settings = readSettings();
    if (cards.length > 0) {
        const surgeOnStack = libraryOf(deck, ON_STACK).removed.some(name => sameCard(name, PRIMAL_SURGE));
        return surgeFromList(cards, { surgeOnStack, settings });
    }
    return surgeFromCounts(deck, DeckConfig.getDeckSize(true), settings);
}

/** Exact results for the deck as built. */
export function calculate() {
    const config = readInputs();
    return { config, result: surgeResult(config) };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderAnswer(config, result) {
    const el = document.getElementById('surge-stats');
    if (!el) return;
    const p = result.payback?.paybackProbability ?? null;
    const cut = Math.min(5, config.nonPermanents);
    const cutTo = result.table && cut > 0
        ? { count: cut, payback: surgePaybackFor(result.table, config.nonPermanents - cut).paybackProbability }
        : null;
    const { html, tone } = summarize({
        permanents: config.permanents,
        stops: config.nonPermanents,
        mean: result.mean,
        median: result.median,
        threshold: config.settings.threshold,
        payback: p,
        cutTo
    });
    const hero = renderHeroStats([
        {
            label: 'Pays for itself', value: p == null ? '—' : pct(p), size: 'big',
            color: p == null ? 'var(--tx-dim)' : toneColor(toneFor(p)),
            sub: p == null ? 'needs a decklist' : `reaches ${formatNumber(config.settings.threshold, config.settings.threshold % 1 ? 2 : 0)} value`,
            term: 'payback'
        },
        {
            label: 'Permanents', value: avg(result.mean),
            sub: `half the time ${result.median} or fewer`,
            tip: 'Average number of permanents Primal Surge puts onto the battlefield before it exiles an instant or sorcery (or runs out of library).'
        },
        result.payback ? {
            label: 'Value into play', value: avg(result.payback.expectedEffectiveValue),
            sub: `${avg(result.expectedManaValue)} printed mana value`,
            tip: 'The printed mana value of everything put onto the battlefield, plus the land and per-permanent credit set on the left.'
        } : null,
        {
            label: 'Cards that stop it', value: `${config.nonPermanents}`,
            sub: `instants & sorceries of ${config.deckSize}`,
            tip: config.surgeOnStack
                ? 'Instants and sorceries left in your library. The Primal Surge you are casting is on the stack, so it is not counted.'
                : 'Instants and sorceries in your library. Primal Surge stops at the first one it exiles.'
        }
    ].filter(Boolean));
    const notice = config.mvKnown ? '' : noticeHTML('Using card-type counts: run lengths are exact, but mana values are unknown, so payback isn’t shown. Import your decklist for the full answer.', 'flat');
    el.innerHTML = renderBottomLine({ html, tone }) + notice + hero;
}

/** "Out of 100 casts": exact run lengths (or values), split by payback. */
function renderDots(config, result) {
    const el = document.getElementById('surge-dots');
    if (!el) return;
    const threshold = config.settings.threshold;
    const hasValue = Boolean(result.table);
    if (!hasValue) dotView = 'permanents';
    const valuePmf = hasValue ? cachedValuePmf(config) : null;
    const dots = surgeDots({ permanents: config.permanents, stops: config.nonPermanents, table: result.table, valuePmf, threshold });
    const legend = hasValue ? PAYBACK_LEGEND : [];
    const byValue = dotView === 'value' && dots.value;
    syncDotsView('surge', dotView, hasValue);

    const shown = byValue ? dots.value : dots.permanents;
    const format = byValue ? valueText : v => String(v);
    const summary = describeDots(shown, { unit: 'cast', format, legend });
    const label = `${byValue ? 'Value put into play' : 'Permanents put into play'}, out of 100 casts. ${summary}`;

    let table;
    if (byValue) {
        table = valueBandsTable(valuePmf, { threshold, step: Math.max(SURGE.VALUE_STEP, threshold), bands: 4, format: valueText });
    } else {
        const runPmf = surgeRunPmf(config.permanents, config.nonPermanents);
        const rows = [];
        for (let k = 0; k <= config.permanents; k++) {
            if (k > 0 && (result.atLeast[k] ?? 0) < 0.0005 && k !== config.permanents) continue;
            const paid = result.table?.shortBySize ? 1 - (result.table.shortBySize[k] ?? 1) : null;
            rows.push([
                k === config.permanents && config.permanents > 0 ? `${k} (whole library)` : String(k),
                pct(runPmf[k] ?? 0),
                pct(result.atLeast[k] ?? 0),
                ...(hasValue ? [result.table.shortBySize ? pct(paid) : '100%'] : [])
            ]);
        }
        table = {
            summary: 'Exact chances',
            caption: 'Exact chance of each run length',
            head: ['Permanents', 'Exactly', 'At least', ...(hasValue ? ['Pays for itself'] : [])],
            rows
        };
    }

    el.innerHTML = dotPlot({
        dots: shown,
        label,
        unit: 'cast',
        format,
        xLabel: byValue ? 'Value put into play (mana value + credits)' : 'Permanents put onto the battlefield',
        threshold: byValue ? threshold : null,
        thresholdLabel: byValue ? `${valueText(threshold)}+ pays for itself` : '',
        legend,
        maxColumns: byValue ? 28 : 32,
        table
    });
    const caption = document.getElementById('surge-dots-caption');
    if (caption) {
        caption.innerHTML = byValue
            ? 'Each dot is one cast in a hundred, stacked by the value it puts into play. Solid dots reach your target; rings fall short. Exact, not simulated.'
            : `Each dot is one cast in a hundred, stacked by how many permanents it puts onto the battlefield before an instant or sorcery stops it.${hasValue ? ' Solid dots paid for themselves; rings fell short.' : ''} Exact, not simulated.`;
    }
}

function renderChart(config, result) {
    const stops = config.nonPermanents;
    const lo = Math.max(0, stops - 10);
    const hi = stops + 6;
    const counts = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    chart = paybackChart(chart, 'surge', {
        points: counts,
        current: stops,
        bars: { label: 'Permanents', data: counts.map(s => +(config.permanents / (s + 1)).toFixed(2)) },
        payback: result.table ? counts.map(s => +(surgePaybackFor(result.table, s).paybackProbability * 100).toFixed(1)) : null,
        xTitle: 'Instants and sorceries in your library',
        yTitle: 'Permanents',
        title: s => {
            const diff = s - stops;
            return `${plural(s, 'instant or sorcery', 'instants and sorceries')}${diff === 0 ? ' (your deck)' : ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)})`}`;
        }
    });
}

function renderSamples(config) {
    const el = document.getElementById('surge-samples');
    if (!el) return;
    const castBtn = document.getElementById('surge-cast-btn');
    if (castBtn) castBtn.hidden = !config.cards.length;
    syncCast(document.getElementById('surge-cast'), config.cards.length ? castKey(config) : null);
    if (!config.cards.length) {
        el.innerHTML = noticeHTML('Sample casts need a decklist with card names — import one from the deck menu.', 'flat');
        return;
    }
    const decks = sampler.get(config.deckKey, () => libraryCards(config.cards));
    el.innerHTML = decks.map((library, i) => {
        let permanents = 0;
        let manaValue = 0;
        let lands = 0;
        let stopper = null;
        const rows = [];
        for (const card of library) {
            if (!isPermanent(card.type_line)) {
                stopper = card;
                break;
            }
            permanents++;
            manaValue += card.cmc;
            if (card.types.includes('land')) lands++;
            if (rows.length < CONFIG.SAMPLE_ROWS) {
                rows.push({
                    name: card.name,
                    type: card.types.includes('land') ? 'land' : card.types[0] ?? 'artifact',
                    mv: card.types.includes('land') && card.cmc === 0 ? '' : card.cmc,
                    fate: 'battlefield',
                    state: 'hit'
                });
            }
        }
        if (permanents > rows.length) rows.push({ more: `+ ${plural(permanents - rows.length, 'more permanent')}` });
        if (stopper) {
            rows.push({ name: stopper.name, type: stopper.types[0] ?? 'sorcery', mv: stopper.cmc, fate: 'stops it', state: 'miss' });
        }
        const scored = calculateSurgeRunValue({ manaValue, lands, permanents }, config.settings);
        return sampleCardHTML({
            title: `Shuffle ${i + 1}`,
            tag: stopper ? (scored.paidBack ? 'Pays for itself' : 'Falls short') : 'Whole library!',
            tone: scored.paidBack ? 'good' : 'bad',
            rows,
            footer: `<strong>${plural(permanents, 'permanent')}</strong> · value <strong>${avg(scored.effectiveValue)}</strong> of ${formatNumber(config.settings.threshold, config.settings.threshold % 1 ? 2 : 0)} needed`
        });
    }).join('');
}

/** The library (the cast Surge already out of `cards`), one object per card. */
function libraryCards(cards) {
    return expandCards(cards);
}

/** What a cast depends on: a different deck or setting closes an open cast. */
const castKey = config => `${config.deckKey}|${JSON.stringify(config.settings)}`;

/** "Cast it": a fresh shuffle resolved card by card. */
function castIt() {
    const config = readInputs();
    const stage = document.getElementById('surge-cast');
    if (!stage || !config.cards.length) return;
    const library = libraryCards(config.cards);
    shuffle(library);
    const plan = surgeCastPlan(library, config.settings);
    playCast(stage, { ...plan, outLabel: 'Stopped by', librarySize: library.length, imageFor: castImage, key: castKey(config) }, castIt);
}

export function updateUI() {
    const { config, result } = calculate();
    if (!result) {
        renderEmptyAnswer('surge', 'Add cards to your deck to see how far Primal Surge gets.');
        closeCast(document.getElementById('surge-cast'));
        chart?.destroy?.();
        chart = null;
        return;
    }
    renderAnswer(config, result);
    renderDots(config, result);
    renderChart(config, result);
    renderSamples(config);
    renderHowItCompares('big-spell-comparison-surge', { x: SURGE.COST, source: 'surge', deckKey: config.deckKey });
}

export function init() {
    registerCalculator({
        name: 'surge',
        calculate,
        updateUI,
        init: debouncedUpdate => bindBigSpellControls('surge', {
            update: debouncedUpdate,
            values: ['surge-payback-threshold', 'surge-land-value', 'surge-card-value'],
            reshuffle: () => {
                sampler.reshuffle();
                renderSamples(readInputs());
            },
            cast: castIt,
            dotsView: view => {
                if (view === dotView) return;
                dotView = view;
                const { config, result } = calculate();
                if (result) renderDots(config, result);
            }
        })
    });
}
