/**
 * Genesis Wave — {X}{G}{G}{G} sorcery.
 *
 * "Reveal the top X cards of your library. You may put any number of permanent
 * cards with mana value X or less from among them onto the battlefield. Then
 * put all cards revealed this way that weren't put onto the battlefield into
 * your graveyard."
 *
 * Everything on the page is exact: the number of hits among X revealed cards
 * is hypergeometric, and the chance the cast pays for itself is an exact
 * dynamic program over the revealed cards' values (js/utils/payback.js).
 */

import { createCache } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, renderSweepTable, pBarCell, toneColor, toneFor } from '../utils/components.js';
import { calculateFixedDrawPayback, fixedDrawValuePmf, paybackShareByHits, scoreBattlefieldValue } from '../utils/payback.js';
import { describeDots, dotPlot, pmfQuantiles, splitDots } from '../utils/viz.js';
import { escapeHtml } from '../data/glossary.js';
import { cardImageUrl, findCard } from '../data/images.js';
import { closeCast, playCast, syncCast } from '../utils/castAnimation.js';
import { shuffle } from '../utils/random.js';
import { quantile } from '../utils/stats.js';
import { isLand, isPermanent } from '../utils/library.js';
import { avg, pct, plural } from '../utils/text.js';
import {
    bindXPresets, cardListKey, createSampler, deckCardList, expandCards, fade, hypergeometricPmf,
    listSize, noticeHTML, readX, renderHowItCompares, sampleCardHTML, syncXControl
} from '../utils/bigSpells.js';

const CONFIG = Object.freeze({
    MAX_X: 30,
    DEFAULT_X: 7,
    TABLE_MAX_X: 20,
    RELIABLE: 0.75,
    SAMPLE_COUNT: 4,
    SAMPLE_ROWS: 12,
    DEFAULT_LAND_VALUE: 1,
    DEFAULT_CARD_VALUE: 0.25,
    EXTRA_MANA: 3
});

const paybackCache = createCache(256);
const spreadCache = createCache(32);
/** Which quantity the "out of 100 casts" dots are stacked by. */
let dotView = 'value';
const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;

/**
 * Expected permanents for Genesis Wave at X (linearity of expectation):
 * revealed cards × the share of the library that is a permanent with MV ≤ X.
 *
 * @param {number} deckSize - cards in the library
 * @param {Object} distribution - mana value -> permanent count, plus `nonperm`
 * @param {number} x
 * @returns {{expectedPermanents:number}}
 */
export function simulateGenesisWave(deckSize, distribution, x) {
    let eligible = 0;
    for (const [key, count] of Object.entries(distribution ?? {})) {
        if (key === 'nonperm') continue;
        const mv = parseInt(key, 10);
        if (!Number.isNaN(mv) && mv <= x) eligible += count || 0;
    }
    const revealed = Math.min(Math.max(0, x), deckSize);
    return { expectedPermanents: deckSize > 0 ? revealed * eligible / deckSize : 0 };
}

// ── The library ──────────────────────────────────────────────────────────────

/**
 * The library as Genesis Wave sees it.
 * With only type counts, permanents' mana values are unknown (cmc: null).
 */
export function buildWaveLibrary(cards = [], counts = {}) {
    if (cards.length > 0) {
        return {
            hasList: true,
            deckSize: listSize(cards),
            entries: cards.map(card => ({
                count: card.count,
                cmc: card.cmc,
                isPermanent: isPermanent(card.type_line),
                isLand: isLand(card.type_line)
            }))
        };
    }
    const n = field => Math.max(0, Math.floor(Number(counts?.[field]) || 0));
    const lands = n('lands');
    const others = n('creatures') + n('artifacts') + n('enchantments') + n('planeswalkers') + n('battles');
    const spells = n('instants') + n('sorceries');
    return {
        hasList: false,
        deckSize: lands + others + spells,
        entries: [
            { count: lands, cmc: 0, isPermanent: true, isLand: true },
            { count: others, cmc: null, isPermanent: true, isLand: false },
            { count: spells, cmc: 0, isPermanent: false, isLand: false }
        ]
    };
}

/** mana value -> permanent count (+ nonperm), the shape simulateGenesisWave takes. */
function distributionOf(library) {
    const distribution = {};
    for (const entry of library.entries) {
        if (!entry.isPermanent) {
            distribution.nonperm = (distribution.nonperm ?? 0) + entry.count;
            continue;
        }
        const mv = entry.cmc == null ? 0 : Math.floor(entry.cmc);
        distribution[mv] = (distribution[mv] ?? 0) + entry.count;
    }
    return distribution;
}

function eligibleAt(library, x) {
    return library.entries.reduce((sum, e) => sum + (e.isPermanent && (e.cmc == null || e.cmc <= x) ? e.count : 0), 0);
}

function paybackAt(library, deckKey, x, settings) {
    if (!library.hasList) return null;
    const key = `${deckKey}|${x}|${settings.landValue}|${settings.cardValue}`;
    let payback = paybackCache.get(key);
    if (!payback) {
        payback = calculateFixedDrawPayback(
            library.entries.map(e => ({ ...e, eligible: e.isPermanent && e.cmc <= x })),
            x,
            { threshold: x + CONFIG.EXTRA_MANA, landValue: settings.landValue, cardValue: settings.cardValue }
        );
        paybackCache.set(key, payback);
    }
    return payback;
}

/**
 * Everything the page shows for one X. Exact; payback is cached per deck,
 * X and value settings.
 */
export function waveOutcome(library, x, settings = {}, deckKey = 'deck') {
    const revealed = Math.min(x, library.deckSize);
    const eligible = eligibleAt(library, x);
    const pmf = hypergeometricPmf(library.deckSize, eligible, revealed);
    const payback = paybackAt(library, deckKey, x, {
        landValue: settings.landValue ?? CONFIG.DEFAULT_LAND_VALUE,
        cardValue: settings.cardValue ?? CONFIG.DEFAULT_CARD_VALUE
    });
    return {
        x,
        mana: x + CONFIG.EXTRA_MANA,
        revealed,
        eligible,
        deckSize: library.deckSize,
        expectedPermanents: simulateGenesisWave(library.deckSize, distributionOf(library), x).expectedPermanents,
        pmf,
        low: quantile(pmf, 0.1),
        high: quantile(pmf, 0.9),
        payback,
        mvKnown: library.hasList
    };
}

// ── Plain-English answer ─────────────────────────────────────────────────────

/**
 * @param {Object<number, ReturnType<typeof waveOutcome>>} sweep - outcome per X
 * @param {number} x
 */
export function analyze(sweep, x) {
    const xs = Object.keys(sweep ?? {}).map(Number).sort((a, b) => a - b);
    const at = sweep?.[x] ?? null;
    const next = sweep?.[x + 1] ?? null;
    const reliableX = xs.find(k => (sweep[k]?.payback?.paybackProbability ?? 0) >= CONFIG.RELIABLE) ?? null;
    return {
        ...at,
        next,
        marginal: next && at ? next.expectedPermanents - at.expectedPermanents : null,
        reliableX,
        maxX: xs.length ? xs[xs.length - 1] : 0
    };
}

function rangePhrase(low, high) {
    return low === high ? `almost always ${low}` : `${low} to ${high} in 8 casts out of 10`;
}

/**
 * The page's bottom line: "How much does Genesis Wave put into play, and does
 * it pay for itself?"
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(a) {
    if (!a || !a.deckSize) return { html: 'Add cards to your deck to see what Genesis Wave does.', tone: 'flat' };
    const opener = `Genesis Wave at <strong>X=${a.x}</strong> (${a.mana} mana)`;
    if (!a.mvKnown || !a.payback) {
        return {
            html: `${opener} reveals ${plural(a.revealed, 'card')}, and about <strong>${avg(a.expectedPermanents)}</strong> of them are permanents. With card-type counts only, mana values are unknown, so this assumes every permanent costs ${a.x} or less — import your decklist for the real number and the payback odds.`,
            tone: 'flat'
        };
    }
    const p = a.payback.paybackProbability;
    const lead = `${opener} puts about <strong>${avg(a.expectedPermanents)} permanents</strong> onto the battlefield — ${rangePhrase(a.low, a.high)} — and pays for itself <strong>${pct(p)}</strong> of the time.`;
    let follow = '';
    if (p >= CONFIG.RELIABLE) {
        if (a.marginal != null) follow = `Each extra point of X adds about ${avg(a.marginal)} more permanents.`;
    } else if (a.reliableX != null && a.reliableX > a.x) {
        follow = `At <strong>X=${a.reliableX}</strong> it pays for itself 3 times in 4.`;
    } else if (a.reliableX == null) {
        follow = `With these value settings it never pays back 3 times in 4, even at X=${a.maxX}.`;
    }
    return { html: follow ? `${lead} ${follow}` : lead, tone: toneFor(p) };
}

// ── Deck and page state ──────────────────────────────────────────────────────

function readNumber(id, fallback) {
    const value = parseFloat(typeof document !== 'undefined' ? document.getElementById(id)?.value : NaN);
    return Number.isFinite(value) ? Math.min(20, Math.max(0, value)) : fallback;
}

/** The page's inputs and the library they apply to. */
export function getDeckConfig() {
    const deck = DeckConfig.getDeckConfig();
    const cards = deckCardList(deck);
    const library = buildWaveLibrary(cards, deck);
    const maxX = Math.max(1, Math.min(library.deckSize, CONFIG.MAX_X));
    const x = Math.min(maxX, readX('wave', CONFIG.DEFAULT_X));
    const settings = {
        landValue: readNumber('wave-land-value', CONFIG.DEFAULT_LAND_VALUE),
        cardValue: readNumber('wave-card-value', CONFIG.DEFAULT_CARD_VALUE)
    };
    const deckKey = cards.length ? cardListKey(cards) : `counts:${library.entries.map(e => e.count).join(',')}`;
    return { deckSize: library.deckSize, x, maxX, library, cards, settings, deckKey };
}

/** Outcomes for every X up to the slider maximum. */
export function calculate() {
    const config = getDeckConfig();
    const results = {};
    if (config.deckSize === 0) return { config, results };
    for (let x = 1; x <= config.maxX; x++) {
        results[x] = waveOutcome(config.library, x, config.settings, config.deckKey);
    }
    return { config, results };
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

/**
 * The exact spread of one cast at X: the value it puts into play, and for
 * each number of hits the share of casts that pay for themselves. Cached per
 * deck, X and value settings.
 */
export function waveSpread(library, x, settings = {}, deckKey = 'deck') {
    if (!library?.hasList) return null;
    const landValue = settings.landValue ?? CONFIG.DEFAULT_LAND_VALUE;
    const cardValue = settings.cardValue ?? CONFIG.DEFAULT_CARD_VALUE;
    const key = `${deckKey}|${x}|${landValue}|${cardValue}`;
    let spread = spreadCache.get(key);
    if (!spread) {
        const entries = library.entries.map(e => ({ ...e, eligible: e.isPermanent && e.cmc <= x }));
        const revealed = Math.min(x, library.deckSize);
        const model = { landValue, cardValue, threshold: x + CONFIG.EXTRA_MANA };
        spread = {
            valuePmf: fixedDrawValuePmf(entries, revealed, model),
            paidByHits: paybackShareByHits(entries, revealed, model)
        };
        spreadCache.set(key, spread);
    }
    return spread;
}

/**
 * The 100 dots for both views. Value: stacked by value, split at the mana
 * spent. Permanents: stacked by hits, each run length split by its exact
 * payback share, with the same number of solid dots as the value view.
 * @param {{pmf:number[], mana:number}} outcome - waveOutcome() at X
 * @param {{valuePmf:Array, paidByHits:number[]}|null} spread
 */
export function waveDots(outcome, spread) {
    const hits = pmfQuantiles(outcome?.pmf ?? [], 100);
    if (!spread) return { permanents: hits.map(k => ({ value: k, tone: 'flat' })), value: null };
    const threshold = outcome.mana;
    const value = pmfQuantiles(spread.valuePmf, 100).map(v => ({ value: v, tone: v >= threshold - 1e-9 ? 'good' : 'bad' }));
    const good = value.filter(d => d.tone === 'good').length;
    return { permanents: splitDots(hits, k => spread.paidByHits[k] ?? 0, good), value };
}

const DOT_LEGEND = Object.freeze([
    { tone: 'good', label: 'paid for itself' },
    { tone: 'bad', label: 'fell short' }
]);
const valueText = v => (v % 1 ? v.toFixed(2).replace(/0$/, '') : String(v));

function renderDots(config, a) {
    const el = document.getElementById('wave-dots');
    if (!el) return;
    const spread = waveSpread(config.library, config.x, config.settings, config.deckKey);
    const dots = waveDots(a, spread);
    const hasValue = Boolean(dots.value);
    // Without values (counts-only deck) show permanents, but keep the choice for the next deck.
    const byValue = dotView === 'value' && hasValue;
    document.querySelectorAll('#wave-tab [data-wave-view]').forEach(btn => {
        const on = btn.dataset.waveView === (byValue ? 'value' : 'permanents');
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    });
    const toggle = document.getElementById('wave-dots-view');
    if (toggle) toggle.hidden = !hasValue;
    const title = document.getElementById('wave-dots-title');
    if (title) title.textContent = `Out of 100 casts at X=${config.x}`;

    const legend = hasValue ? DOT_LEGEND : [];
    const shown = byValue ? dots.value : dots.permanents;
    const format = byValue ? valueText : v => String(v);
    const label = `${byValue ? 'Value put into play' : 'Permanents put into play'} by Genesis Wave at X=${config.x}, out of 100 casts. ${describeDots(shown, { unit: 'cast', format, legend })}`;

    let table;
    if (byValue) {
        const mana = a.mana;
        const step = mana;
        const bands = [{ lo: 0, hi: mana, label: `Under ${mana} (falls short)` }];
        for (let lo = mana; lo < mana * 4; lo += step) bands.push({ lo, hi: lo + step, label: `${lo} to under ${lo + step}` });
        bands.push({ lo: mana * 4, hi: Infinity, label: `${mana * 4} or more` });
        const chance = b => spread.valuePmf.reduce((s, e) => s + (e.value >= b.lo - 1e-9 && e.value < b.hi - 1e-9 ? e.p : 0), 0);
        table = {
            summary: 'Exact chances', caption: 'Exact chance of each value range',
            head: ['Value put into play', 'Chance'],
            rows: bands.map(b => [escapeHtml(b.label), pct(chance(b))])
        };
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
    const hasPayback = config.library.hasList;
    if (chart && chart.$hasPayback !== hasPayback) {
        // Axis options are fixed at creation; rebuild when the right axis comes or goes.
        chart.destroy();
        chart = null;
    }
    chart = createOrUpdateChart(chart, 'wave-chart', {
        type: 'bar',
        data: {
            labels: xs.map(String),
            datasets: [
                {
                    label: 'Permanents',
                    data: xs.map(x => +(results[x]?.expectedPermanents ?? 0).toFixed(2)),
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
                    data: xs.map(x => hasPayback ? +((results[x]?.payback?.paybackProbability ?? 0) * 100).toFixed(1) : null),
                    borderColor: TX_CHART.green,
                    backgroundColor: TX_CHART.green,
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: xs.map(x => x === config.x ? 5 : 2),
                    pointBackgroundColor: xs.map(x => x === config.x ? TX_CHART.green : TX_CHART.bg),
                    pointBorderColor: TX_CHART.green,
                    hidden: !hasPayback,
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
                x: { title: { display: true, text: 'Cards revealed (X)', color: TX_CHART.dim }, grid: { display: false } },
                y: { beginAtZero: true, title: { display: true, text: 'Permanents', color: TX_CHART.dim } },
                y2: {
                    position: 'right', min: 0, max: 100,
                    grid: { drawOnChartArea: false },
                    ticks: { stepSize: 25, callback: v => `${v}%` },
                    display: hasPayback
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => `X=${items[0].label} · ${Number(items[0].label) + CONFIG.EXTRA_MANA} mana`,
                        label: item => item.datasetIndex === 0
                            ? `Permanents: ${avg(item.parsed.y)}`
                            : `Pays for itself: ${pct(item.parsed.y / 100)}`
                    }
                }
            }
        }
    });
    if (chart) chart.$hasPayback = hasPayback;
    document.querySelectorAll('#wave-tab [data-payback-key]').forEach(key => { key.hidden = !hasPayback; });
}

/**
 * One Genesis Wave resolution, card by card, for the "Cast it" animation:
 * the top X cards are revealed; permanents with mana value X or less go to
 * the battlefield, everything else to the graveyard. Pure.
 *
 * @param {Array<{name:string, cmc:number, types:string[]}>} library - shuffled
 * @param {number} x
 * @param {{landValue:number, cardValue:number}} settings
 */
export function waveCastPlan(library, x, settings = {}) {
    const threshold = x + CONFIG.EXTRA_MANA;
    const revealed = (library ?? []).slice(0, Math.max(0, x));
    let permanents = 0;
    let manaValue = 0;
    let lands = 0;
    const totals = () => {
        const scored = scoreBattlefieldValue({ manaValue, lands, cards: permanents }, { ...settings, threshold });
        return {
            scored,
            list: [
                { label: 'Permanents', value: String(permanents) },
                { label: 'Value', value: `${avg(scored.effectiveValue)} <small>of ${threshold}</small>`, tone: scored.paidForItself ? 'good' : undefined }
            ]
        };
    };
    const steps = revealed.map((card, i) => {
        const types = card.types ?? [];
        const permanent = types.some(t => t !== 'instant' && t !== 'sorcery');
        const mv = card.cmc || 0;
        const hit = permanent && mv <= x;
        if (hit) {
            permanents += 1;
            manaValue += mv;
            if (types.includes('land')) lands += 1;
        }
        const count = `${i + 1} of ${x}: `;
        const note = hit
            ? `${count}${types.includes('land') ? 'a land' : `a permanent with mana value ${mv}`} — X is ${x}, so onto the battlefield.`
            : permanent
                ? `${count}mana value ${mv} is more than X (${x}) — to the graveyard.`
                : `${count}${types.includes('instant') ? 'an instant' : 'a sorcery'}, not a permanent — to the graveyard.`;
        return { name: card.name, fate: hit ? 'battlefield' : 'graveyard', note, totals: totals().list };
    });
    const end = totals().scored;
    const summary = `${plural(revealed.length, 'card')} revealed, ${plural(permanents, 'permanent')} onto the battlefield worth ${avg(end.effectiveValue)} — ${end.paidForItself ? '<strong>pays for itself</strong>' : '<strong>falls short</strong>'} of the ${threshold} mana spent.`;
    return {
        steps, permanents, value: end.effectiveValue, paidBack: end.paidForItself, summary,
        startTotals: [{ label: 'Permanents', value: '0' }, { label: 'Value', value: `0 <small>of ${threshold}</small>` }]
    };
}

function imageFor(name) {
    const record = findCard(DeckConfig.getImportedCardData()?.cardsByName ?? {}, name);
    return cardImageUrl(record ?? name, 'small');
}

/** What a cast depends on: a different deck, X or setting closes an open cast. */
const castKey = config => `${config.deckKey}|${config.x}|${JSON.stringify(config.settings)}`;

/** "Cast it": a fresh shuffle resolved at the chosen X, card by card. */
function castIt() {
    const config = getDeckConfig();
    const stage = document.getElementById('wave-cast');
    if (!stage || !config.cards.length) return;
    const library = expandCards(config.cards);
    shuffle(library);
    const plan = waveCastPlan(library, config.x, config.settings);
    playCast(stage, { ...plan, outLabel: 'Graveyard', librarySize: library.length, imageFor, key: castKey(config) }, castIt);
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
    const threshold = config.x + CONFIG.EXTRA_MANA;
    const decks = sampler.get(config.deckKey, () => expandCards(config.cards));
    el.innerHTML = decks.map((library, i) => {
        const revealed = library.slice(0, config.x);
        let permanents = 0;
        let manaValue = 0;
        let lands = 0;
        const rows = revealed.map(card => {
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
        const scored = scoreBattlefieldValue({ manaValue, lands, cards: permanents }, { ...config.settings, threshold });
        const shown = rows.slice(0, CONFIG.SAMPLE_ROWS);
        const hidden = rows.length - shown.length;
        return sampleCardHTML({
            title: `Shuffle ${i + 1}`,
            tag: scored.paidForItself ? 'Pays for itself' : 'Falls short',
            tone: scored.paidForItself ? 'good' : 'bad',
            rows: shown,
            more: hidden > 0 ? `+ ${plural(hidden, 'more card')} (${plural(rows.slice(CONFIG.SAMPLE_ROWS).filter(r => r.state === 'hit').length, 'permanent')})` : '',
            footer: `<strong>${plural(permanents, 'permanent')}</strong> · value <strong>${avg(scored.effectiveValue)}</strong> of ${threshold} needed`
        });
    }).join('');
}

function renderDetails(config, results, a) {
    const rows = [];
    for (let x = 1; x <= Math.min(config.maxX, CONFIG.TABLE_MAX_X); x++) {
        const r = results[x];
        if (!r) continue;
        rows.push({ x, r, delta: results[x - 1] ? r.expectedPermanents - results[x - 1].expectedPermanents : null });
    }
    const hasPayback = config.library.hasList;
    renderSweepTable('wave-comparisonTable', {
        current: config.x,
        recommended: a.reliableX,
        rows,
        columns: [
            { label: 'X', align: 'left', render: row => `${row.x}` },
            { label: 'Mana', render: row => `${row.r.mana}` },
            { label: 'Permanents', render: row => avg(row.r.expectedPermanents) },
            { label: 'Change', render: row => row.delta == null ? '—' : `+${avg(row.delta, 2)}` },
            { label: 'Hit rate', align: 'left', render: row => pBarCell(row.r.revealed ? row.r.expectedPermanents / row.r.revealed : 0, 'var(--tx-flat)') },
            { label: 'Pays for itself', render: row => hasPayback ? `<span style="color:${toneColor(toneFor(row.r.payback.paybackProbability))}">${pct(row.r.payback.paybackProbability)}</span>` : '—' }
        ]
    });
}

function setX(x) {
    const slider = document.getElementById('wave-xSlider');
    const input = document.getElementById('wave-xValue');
    if (slider) slider.value = x;
    if (input) input.value = x;
    updateUI();
}

export function updateUI() {
    const { config, results } = calculate();
    syncXControl('wave', config.x, config.maxX, `${config.x + CONFIG.EXTRA_MANA} mana · {X}{G}{G}{G}`);

    if (config.deckSize === 0 || !results[config.x]) {
        const el = document.getElementById('wave-stats');
        if (el) el.innerHTML = renderBottomLine({ html: 'Add cards to your deck to see what Genesis Wave does.', tone: 'flat' });
        const dots = document.getElementById('wave-dots');
        if (dots) dots.innerHTML = '';
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
        init: debouncedUpdate => {
            bindXPresets('wave', setX);
            ['wave-land-value', 'wave-card-value'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', debouncedUpdate);
            });
            document.getElementById('wave-reshuffle-btn')?.addEventListener('click', () => {
                sampler.reshuffle();
                renderSamples(getDeckConfig());
            });
            document.getElementById('wave-cast-btn')?.addEventListener('click', castIt);
            document.getElementById('wave-cast')?.addEventListener('cast-closed', () => {
                document.getElementById('wave-cast-btn')?.focus({ preventScroll: true });
            });
            document.getElementById('wave-dots-view')?.addEventListener('click', e => {
                const view = e.target.closest('[data-wave-view]')?.dataset.waveView;
                if (!view || view === dotView) return;
                dotView = view;
                updateUI();
            });
        }
    });
}
