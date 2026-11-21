/**
 * Genesis Wave — {X}{G}{G}{G} sorcery. The page: readInputs() (the DOM and
 * the deck → a plain object), the model, then rendering. The maths lives in
 * js/utils/models/wave.js; the X control, chart, samples, table and wiring
 * are the big-spell kit's (js/utils/bigSpells.js), shared with the Vow.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor, toneFor } from '../utils/components.js';
import { describeDots, dotPlot } from '../utils/viz.js';
import { closeCast, playCast, syncCast } from '../utils/castAnimation.js';
import { shuffle } from '../utils/random.js';
import { avg, pct, plural } from '../utils/text.js';
import {
    PAYBACK_LEGEND, bindBigSpellControls, castImage, createSampler, noticeHTML, paybackChart, paybackSampleHTML,
    readValueInput, readXSpell, renderEmptyAnswer, renderHowItCompares, renderXSweep, setXInputs, syncDotsView,
    syncXControl, valueBandsTable
} from '../utils/bigSpells.js';
import { expandCards } from '../utils/models/cardList.js';
import { ON_STACK, WAVE, analyze, buildWaveLibrary, summarize, waveCastPlan, waveDots, waveSpread, waveSweep } from '../utils/models/wave.js';

const CONFIG = Object.freeze({
    MAX_X: 30,
    DEFAULT_X: 7,
    TABLE_MAX_X: 20,
    SAMPLE_COUNT: 4,
    SAMPLE_ROWS: 12
});

/** Which quantity the "out of 100 casts" dots are stacked by. */
let dotView = 'value';
const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The page's inputs and the library they apply to (defaults when not mounted). */
export function readInputs() {
    const { cards, library, deckSize, maxX, x, deckKey } = readXSpell('wave', DeckConfig.getDeckConfig(), {
        onStack: ON_STACK, build: buildWaveLibrary, maxX: CONFIG.MAX_X, defaultX: CONFIG.DEFAULT_X
    });
    const settings = {
        landValue: readValueInput('wave-land-value', WAVE.DEFAULT_LAND_VALUE),
        cardValue: readValueInput('wave-card-value', WAVE.DEFAULT_CARD_VALUE)
    };
    return { deckSize, x, maxX, library, cards, settings, deckKey };
}

/** Outcomes for every X up to the slider maximum. */
export function calculate() {
    const config = readInputs();
    return { config, results: waveSweep(config.library, config.maxX, config.settings, config.deckKey) };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderAnswer(config, a) {
    const el = document.getElementById('wave-stats');
    if (!el) return;
    const { html, tone } = summarize(a);
    const p = a.payback?.paybackProbability;
    const hero = renderHeroStats([
        {
            label: 'Pays for itself', value: a.payback ? pct(p) : '—', size: 'big',
            color: a.payback ? toneColor(toneFor(p)) : 'var(--tx-dim)',
            sub: a.payback ? `reaches ${a.mana} value` : 'needs a decklist',
            term: 'payback'
        },
        {
            label: 'Permanents', value: avg(a.expectedPermanents),
            sub: a.low === a.high ? `almost always ${a.low}` : `${a.low}–${a.high} in 8 of 10 casts`,
            tip: 'Average number of permanent cards with mana value X or less among the X cards revealed — the ones Genesis Wave puts onto the battlefield.'
        },
        a.payback ? {
            label: 'Value into play', value: avg(a.payback.expectedEffectiveValue),
            sub: `${avg(a.payback.expectedManaValue)} printed mana value`,
            tip: 'The printed mana value of everything put onto the battlefield, plus the land and per-permanent credit set on the left. Compared with the mana spent to decide whether the cast paid for itself.'
        } : null,
        {
            label: 'Cards it can hit', value: `${a.eligible}`,
            sub: `of ${a.deckSize}: permanents, mana value ≤ ${a.x}`,
            tip: 'Permanent cards in your library cheap enough for Genesis Wave at this X. Everything else it reveals goes to the graveyard.'
        }
    ].filter(Boolean));
    el.innerHTML = renderBottomLine({ html, tone }) + hero;

    const target = document.getElementById('wave-payback-target');
    if (target) target.textContent = `${a.mana} value at X=${a.x}`;
}

// ── Out of 100 casts ─────────────────────────────────────────────────────────

const valueText = v => (v % 1 ? v.toFixed(2).replace(/0$/, '') : String(v));

function renderDots(config, a) {
    const el = document.getElementById('wave-dots');
    if (!el) return;
    const spread = waveSpread(config.library, config.x, config.settings, config.deckKey);
    const dots = waveDots(a, spread);
    const hasValue = Boolean(dots.value);
    // Without values (counts-only deck) show permanents, but keep the choice for the next deck.
    const byValue = dotView === 'value' && hasValue;
    syncDotsView('wave', byValue ? 'value' : 'permanents', hasValue);
    const title = document.getElementById('wave-dots-title');
    if (title) title.textContent = `Out of 100 casts at X=${config.x}`;

    const legend = hasValue ? PAYBACK_LEGEND : [];
    const shown = byValue ? dots.value : dots.permanents;
    const format = byValue ? valueText : v => String(v);
    const label = `${byValue ? 'Value put into play' : 'Permanents put into play'} by Genesis Wave at X=${config.x}, out of 100 casts. ${describeDots(shown, { unit: 'cast', format, legend })}`;

    let table;
    if (byValue) {
        table = valueBandsTable(spread.valuePmf, { threshold: a.mana, step: a.mana, bands: 3 });
    } else {
        const pmf = a.pmf ?? [];
        let atLeast = 1;
        const rows = [];
        pmf.forEach((p, k) => {
            if (p >= 0.0005) {
                rows.push([String(k), pct(p), pct(atLeast), ...(hasValue ? [pct(spread.paidByHits[k] ?? 0)] : [])]);
            }
            atLeast -= p;
        });
        table = {
            summary: 'Exact chances', caption: 'Exact chance of each number of permanents',
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
        threshold: byValue ? a.mana : null,
        thresholdLabel: byValue ? `${a.mana}+ pays for itself` : '',
        legend,
        maxColumns: 28,
        table
    });
    const caption = document.getElementById('wave-dots-caption');
    if (caption) {
        caption.textContent = byValue
            ? `Each dot is one cast in a hundred, stacked by the value it puts into play. Solid dots reach the ${a.mana} mana you spent; rings fall short. Exact, not simulated.`
            : `Each dot is one cast in a hundred, stacked by how many permanents it puts onto the battlefield.${hasValue ? ' Solid dots paid for themselves; rings fell short.' : ' Counts only: every permanent is assumed cheap enough.'} Exact, not simulated.`;
    }
}

function renderChart(config, results) {
    const top = Math.min(config.maxX, Math.max(15, config.x + 5));
    const xs = Array.from({ length: top }, (_, i) => i + 1);
    chart = paybackChart(chart, 'wave', {
        points: xs,
        current: config.x,
        bars: { label: 'Permanents', data: xs.map(x => +(results[x]?.expectedPermanents ?? 0).toFixed(2)) },
        payback: config.library.hasList ? xs.map(x => +((results[x]?.payback?.paybackProbability ?? 0) * 100).toFixed(1)) : null,
        xTitle: 'Cards revealed (X)',
        yTitle: 'Permanents',
        title: x => `X=${x} · ${x + WAVE.EXTRA_MANA} mana`,
        onPick: setX
    });
}

/** What a cast depends on: a different deck, X or setting closes an open cast. */
const castKey = config => `${config.deckKey}|${config.x}|${JSON.stringify(config.settings)}`;

/** "Cast it": a fresh shuffle resolved at the chosen X, card by card. */
function castIt() {
    const config = readInputs();
    const stage = document.getElementById('wave-cast');
    if (!stage || !config.cards.length) return;
    const library = expandCards(config.cards);
    shuffle(library);
    const plan = waveCastPlan(library, config.x, config.settings);
    playCast(stage, { ...plan, outLabel: 'Graveyard', librarySize: library.length, imageFor: castImage, key: castKey(config) }, castIt);
}

function renderSamples(config) {
    const el = document.getElementById('wave-samples');
    const header = document.getElementById('wave-samples-title');
    if (header) header.textContent = `Sample casts at X=${config.x}`;
    if (!el) return;
    const castBtn = document.getElementById('wave-cast-btn');
    if (castBtn) castBtn.hidden = !config.cards.length;
    syncCast(document.getElementById('wave-cast'), config.cards.length ? castKey(config) : null);
    if (!config.cards.length) {
        el.innerHTML = noticeHTML('Sample casts need a decklist with card names — import one from the deck menu.', 'flat');
        return;
    }
    const threshold = config.x + WAVE.EXTRA_MANA;
    const decks = sampler.get(config.deckKey, () => expandCards(config.cards));
    el.innerHTML = decks.map((library, index) => {
        let permanents = 0;
        let manaValue = 0;
        let lands = 0;
        const rows = library.slice(0, config.x).map(card => {
            const permanent = card.types.some(t => t !== 'instant' && t !== 'sorcery');
            const hit = permanent && card.cmc <= config.x;
            if (hit) {
                permanents++;
                manaValue += card.cmc;
                if (card.types.includes('land')) lands++;
            }
            return {
                name: card.name,
                type: card.types.includes('land') ? 'land' : card.types[0] ?? 'artifact',
                mv: card.types.includes('land') && card.cmc === 0 ? '' : card.cmc,
                fate: hit ? 'battlefield' : (permanent ? 'costs too much' : 'graveyard'),
                state: hit ? 'hit' : 'miss'
            };
        });
        return paybackSampleHTML({
            index, rows, maxRows: CONFIG.SAMPLE_ROWS, hitUnit: 'permanent',
            put: { manaValue, lands, cards: permanents }, settings: config.settings, threshold,
            lead: `<strong>${plural(permanents, 'permanent')}</strong>`
        });
    }).join('');
}

function renderDetails(config, results, a) {
    renderXSweep('wave-comparisonTable', {
        x: config.x,
        recommended: a.reliableX,
        results,
        maxX: config.maxX,
        tableMax: CONFIG.TABLE_MAX_X,
        hits: r => r.expectedPermanents,
        seen: r => r.revealed,
        columns: [{ label: 'Permanents', render: row => avg(row.r.expectedPermanents) }],
        hasPayback: config.library.hasList
    });
}

function setX(x) {
    setXInputs('wave', x);
    updateUI();
}

export function updateUI() {
    const { config, results } = calculate();
    syncXControl('wave', config.x, config.maxX, `${config.x + WAVE.EXTRA_MANA} mana · {X}{G}{G}{G}`);

    if (config.deckSize === 0 || !results[config.x]) {
        renderEmptyAnswer('wave', 'Add cards to your deck to see what Genesis Wave does.');
        closeCast(document.getElementById('wave-cast'));
        chart?.destroy?.();
        chart = null;
        return;
    }

    const a = analyze(results, config.x);
    renderAnswer(config, a);
    renderDots(config, a);
    renderChart(config, results);
    renderSamples(config);
    renderDetails(config, results, a);
    renderHowItCompares('big-spell-comparison-wave', { x: config.x, source: 'wave', deckKey: config.deckKey });
}

export function init() {
    registerCalculator({
        name: 'wave',
        calculate,
        updateUI,
        inputs: ['x'],
        init: debouncedUpdate => bindBigSpellControls('wave', {
            update: debouncedUpdate,
            setX,
            values: ['wave-land-value', 'wave-card-value'],
            reshuffle: () => {
                sampler.reshuffle();
                renderSamples(readInputs());
            },
            cast: castIt,
            dotsView: view => {
                if (view === dotView) return;
                dotView = view;
                updateUI();
            }
        })
    });
}
