/**
 * Portent of Calamity — {X}{U} sorcery. The page: readInputs() (the DOM and
 * the deck → a plain object), the model, then rendering. The maths lives in
 * js/utils/models/portent.js.
 */

import { createOrUpdateChart, TX_CHART } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, renderSweepTable, pBarCell, toneColor, toneFor } from '../utils/components.js';
import { cardRef } from '../data/glossary.js';
import { CARD_TYPES } from '../utils/library.js';
import { avg, pct, plural, points, pointsShort } from '../utils/text.js';
import {
    barsHTML, createSampler, noticeHTML, renderHowItCompares, sampleCardHTML, typeLabel,
    syncXControl, bindXPresets, readX, fade
} from '../utils/bigSpells.js';
import { cardListKey, deckCardList, expandCards } from '../utils/models/cardList.js';
import {
    PORTENT, analyze, buildTypeMasks, masksKey, portentResults, resolvePortent, summarize, typeCounts
} from '../utils/models/portent.js';

const CONFIG = Object.freeze({
    TABLE_MAX_X: 20,
    DEFAULT_X: 7,
    SAMPLE_COUNT: 4
});

const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;

// ── Inputs ───────────────────────────────────────────────────────────────────

/**
 * The page's inputs plus the library they apply to. Reads Portent's own X
 * input when its page is mounted; falls back to the default otherwise.
 */
export function readInputs() {
    const deck = DeckConfig.getDeckConfig();
    const cards = deckCardList(deck);
    const masks = buildTypeMasks(cards, deck);
    const deckSize = masks.length;
    const maxX = Math.max(1, Math.min(deckSize, PORTENT.MAX_X));
    const x = Math.min(maxX, readX('portent', CONFIG.DEFAULT_X));
    const types = typeCounts(masks);
    return { deckSize, x, maxX, types, cards, masks, deckKey: cards.length ? cardListKey(cards) : masksKey(masks) };
}

/**
 * Results for every X up to the slider's maximum. Cached per library, so moving
 * the slider never re-runs the simulation.
 */
export function calculate() {
    const config = readInputs();
    if (config.deckSize === 0) return { config, results: {} };
    return { config, results: portentResults(config.masks, config.maxX) };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderAnswer(config, a) {
    const el = document.getElementById('portent-stats');
    if (!el) return;
    const { html, tone } = summarize(a);
    const next = a.next;
    const hero = renderHeroStats([
        {
            label: 'Free-spell chance', value: pct(a.prob), size: 'big', color: toneColor(toneFor(a.prob)),
            sub: `at X=${a.x} · ${a.mana} mana`,
            tip: 'The chance Portent exiles four or more cards — one per card type — so you may cast one of them without paying its mana cost.'
        },
        {
            label: 'Cards you keep', value: avg(a.cards),
            sub: `${avg(a.toHand)} to hand, plus the free spell`,
            tip: 'Portent exiles one card for each card type it reveals, and you keep all of them: one may be cast free, the rest go to your hand. Averaged over every cast.'
        },
        next ? {
            label: `At X=${a.x + 1}`, value: pct(next.prob4Plus),
            sub: `${points(next.prob4Plus - a.prob)} for one more mana`,
            tip: 'The free-spell chance if you pay one more mana.'
        } : null,
        {
            label: 'Near-certain from', value: a.reliableX != null ? `X=${a.reliableX}` : '—',
            sub: a.reliableX != null ? `${a.reliableX + 1} mana for 9 in 10` : 'never 9 in 10 here',
            tip: 'The smallest X where the free spell happens at least 9 times in 10.'
        }
    ].filter(Boolean));
    const notice = config.cards.length ? '' : noticeHTML('Using your card-type counts. Import a decklist to count dual-typed cards (an artifact creature fills only one type) and to see sample casts.', 'flat');
    el.innerHTML = renderBottomLine({ html, tone }) + notice + hero;
}

function renderChart(config, results) {
    const top = Math.min(config.maxX, Math.max(15, config.x + 5));
    const xs = Array.from({ length: top }, (_, i) => i + 1);
    const probs = xs.map(x => +((results[x]?.prob4Plus ?? 0) * 100).toFixed(1));
    const colors = xs.map((x, i) => x === config.x
        ? TX_CHART.amber
        : fade({ good: TX_CHART.green, warn: TX_CHART.amber, bad: TX_CHART.red }[toneFor(probs[i] / 100)] ?? TX_CHART.blue, 0.38));

    chart = createOrUpdateChart(chart, 'portent-combinedChart', {
        type: 'bar',
        data: {
            labels: xs.map(String),
            datasets: [
                {
                    label: 'Free-spell chance',
                    data: probs,
                    backgroundColor: colors,
                    hoverBackgroundColor: colors,
                    borderRadius: 3,
                    maxBarThickness: 34,
                    order: 2
                },
                {
                    label: '9 in 10',
                    type: 'line',
                    data: xs.map(() => 90),
                    borderColor: TX_CHART.dim,
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
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
                y: { min: 0, max: 100, ticks: { stepSize: 25, callback: v => `${v}%` } }
            },
            plugins: {
                tooltip: {
                    filter: item => item.datasetIndex === 0,
                    callbacks: {
                        title: items => `X=${items[0].label} · ${Number(items[0].label) + 1} mana`,
                        label: item => `Free spell: ${pct(item.parsed.y / 100)}`,
                        afterLabel: item => `Cards kept: ${avg(results[Number(item.label)]?.expectedTypes ?? 0)}`
                    }
                }
            }
        }
    });
}

function renderTypeMix(config) {
    const bar = document.getElementById('portent-type-bar');
    const list = document.getElementById('portent-type-grid');
    const label = document.getElementById('portent-n-label');
    if (label) label.textContent = `${config.deckSize} cards`;
    const entries = CARD_TYPES.map(type => [type, config.types[type] ?? 0]).filter(([, n]) => n > 0);
    const total = entries.reduce((sum, [, n]) => sum + n, 0) || 1;
    if (bar) {
        bar.innerHTML = entries.map(([type, n]) =>
            `<span style="flex-grow:${n}; background:var(--type-${type})" title="${typeLabel(type)}: ${n}"></span>`).join('');
    }
    if (list) {
        list.innerHTML = entries.map(([type, n]) => `
            <li title="${typeLabel(type)}: ${n} cards (${Math.round(n / total * 100)}%)"><span class="bs-dot" style="--dot: var(--type-${type})" aria-hidden="true"></span><span class="por-type-name">${typeLabel(type)}</span><span class="por-type-n">${n}</span></li>`).join('');
    }
}

function renderSamples(config) {
    const el = document.getElementById('portent-trials-container');
    const header = document.getElementById('portent-reveal-header');
    if (header) header.textContent = `Sample casts at X=${config.x}`;
    if (!el) return;
    if (!config.cards.length) {
        el.innerHTML = noticeHTML('Sample casts need a decklist with card names — import one from the deck menu.', 'flat');
        return;
    }
    const decks = sampler.get(config.deckKey, () => expandCards(config.cards));
    el.innerHTML = decks.map((library, i) => {
        const revealed = library.slice(0, config.x);
        const r = resolvePortent(revealed);
        const rows = revealed.map((card, index) => {
            const fate = r.fateOf.get(index);
            const isLand = !card.types.some(t => t !== 'land');
            return {
                name: card.name,
                type: fate?.type ?? card.types[0] ?? 'land',
                mv: isLand ? '' : card.cmc,
                fate: fate ? (fate.fate === 'cast' ? 'cast free' : `${typeLabel(fate.type).toLowerCase()} → hand`) : 'graveyard',
                state: fate ? (fate.fate === 'cast' ? 'star' : 'hit') : 'miss'
            };
        });
        const kept = r.exiled.length;
        const footer = r.freeSpell
            ? (r.free
                ? `Cast <strong>${cardRef(r.free.name)}</strong> free · ${plural(r.toHand.length, 'card')} to hand`
                : `Exiled ${kept}, but none is a spell · ${plural(r.toHand.length, 'card')} to hand`)
            : `${plural(kept, 'card')} to hand · ${plural(r.graveyard.length, 'card')} to graveyard`;
        return sampleCardHTML({
            title: `Shuffle ${i + 1}`,
            tag: r.freeSpell ? 'Free spell' : `${plural(kept, 'type')} — no free spell`,
            tone: r.freeSpell ? 'good' : 'bad',
            rows,
            footer
        });
    }).join('');
}

function renderDetails(config, results, a) {
    const rows = [];
    let prev = null;
    for (let x = 1; x <= Math.min(config.maxX, CONFIG.TABLE_MAX_X); x++) {
        const r = results[x];
        if (!r) continue;
        rows.push({ x, prob: r.prob4Plus, cards: r.expectedTypes, delta: prev == null ? null : r.prob4Plus - prev });
        prev = r.prob4Plus;
    }
    renderSweepTable('portent-sweep', {
        current: config.x,
        recommended: a.reliableX,
        rows,
        columns: [
            { label: 'X', align: 'left', render: r => `${r.x}` },
            { label: 'Mana', render: r => `${r.x + 1}` },
            { label: 'Free-spell chance', align: 'left', render: r => pBarCell(r.prob, toneColor(toneFor(r.prob))) },
            { label: '', render: r => `<span style="color:${toneColor(toneFor(r.prob))}">${pct(r.prob)}</span>` },
            { label: 'Cards kept', render: r => avg(r.cards) },
            { label: 'Change', render: r => r.delta == null ? '—' : pointsShort(r.delta) }
        ]
    });

    const dist = results[config.x]?.dist ?? [];
    const distEl = document.getElementById('portent-dist');
    const sub = document.getElementById('portent-dist-sub');
    if (sub) sub.textContent = `at X=${config.x}`;
    if (distEl) {
        const peak = Math.max(...dist, 0.0001);
        const bars = dist.map((p, k) => ({ k, p })).filter(({ p }) => p > 0).map(({ k, p }) => ({
            label: k >= PORTENT.FREE_SPELL_THRESHOLD ? `${plural(k, 'card')} · free spell` : plural(k, 'card'),
            value: p,
            tone: k >= PORTENT.FREE_SPELL_THRESHOLD ? 'good' : 'bad'
        }));
        distEl.innerHTML = `<p class="bs-caption">How often each cast exiles that many cards, over ${PORTENT.ITERATIONS.toLocaleString('en-US')} simulated casts. Four or more is a free spell.</p>`
            + barsHTML(bars, { scale: peak });
    }
}

/** Set X from a preset chip or a chart click. */
function setX(x) {
    const slider = document.getElementById('portent-xSlider');
    const input = document.getElementById('portent-xValue');
    if (slider) slider.value = x;
    if (input) input.value = x;
    updateUI();
}

/** Render the whole page. Cheap after the first run for a deck. */
export function updateUI() {
    const { config, results } = calculate();
    syncXControl('portent', config.x, config.maxX, `${config.x + 1} mana · {X}{U}`);
    renderTypeMix(config);

    if (config.deckSize === 0 || !results[config.x]) {
        const el = document.getElementById('portent-stats');
        if (el) el.innerHTML = renderBottomLine({ html: 'Add cards to your deck to see how Portent performs.', tone: 'flat' });
        chart?.destroy?.();
        chart = null;
        return;
    }

    const typesInDeck = CARD_TYPES.filter(type => config.types[type] > 0).length;
    const a = analyze(results, config.x, { typesInDeck });
    renderAnswer(config, a);
    renderChart(config, results);
    renderSamples(config);
    renderDetails(config, results, a);
    renderHowItCompares('big-spell-comparison-portent', { x: config.x, source: 'portent', deckKey: config.deckKey });
}

export function init() {
    registerCalculator({
        name: 'portent',
        calculate,
        updateUI,
        inputs: ['x'],
        init: () => {
            bindXPresets('portent', setX);
            document.getElementById('portent-reshuffle-btn')?.addEventListener('click', () => {
                sampler.reshuffle();
                renderSamples(readInputs());
            });
        }
    });
}
