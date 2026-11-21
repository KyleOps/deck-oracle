/**
 * Monstrous Vortex
 *
 * {3}{G} Enchantment — "Whenever you cast a creature spell with power 5 or
 * greater, discover X, where X is that spell's mana value."
 *
 * Discover casts what it finds, so a discovered power-5+ creature triggers
 * Vortex again at its own mana value. That chain makes the outcome genuinely
 * random with a long tail, so this page samples it rather than solving it:
 * every number comes from `discoverForCreature()` / `sampleDiscoverFrom()` in
 * js/utils/discover.js — the same model, library, run count and seed the Head
 * to Head page uses, so the same creature gets the same answer on both pages.
 *
 * The page answers "how much free mana does each big creature discover?" in
 * three layers: one line for the deck, one row per big creature, and a detailed
 * look (percentiles, value by mana value, real sample triggers) at whichever
 * mana value the slider picks.
 *
 * Earlier versions solved the average with a recursion that drew WITH
 * replacement — a chaining creature could discover itself again — and divided by
 * zero (then multiplied by 100) when every eligible card chained at the same
 * mana value. Both are gone with the move to the shared simulation.
 */

import { formatNumber, formatPercentage } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable } from '../utils/components.js';
import { buildDeckFromCardData } from '../utils/sampleSimulator.js';
import {
    DISCOVER_RUNS, isBigCreature, discoverForCreature, sampleDiscoverFrom,
    simulateDiscoverChain, seededShuffle, mulberry32, hashSeed, withoutOne
} from '../utils/discover.js';
import { cardRef, term, escapeHtml } from '../data/glossary.js';
import { describeDots, dotPlot, pmfQuantiles } from '../utils/viz.js';

/** Monstrous Vortex's own mana value — the bar a trigger is measured against. */
export const VORTEX_COST = 4;
export const DEFAULT_MV = 6;

/** Sample triggers shown at first, and added per "show more". */
const SAMPLE_BATCH = 5;
const SAMPLE_MAX = 30;

// ==================== PURE ANALYSIS ====================

/**
 * The distinct power-5+ creatures in a library, with their copy counts.
 *
 * @param {Array} library - simulation-deck cards (buildDeckFromCardData shape)
 * @param {boolean} [treatStarAs5Plus=false]
 * @returns {Array<{name:string, cmc:number, power:*, toughness:*, count:number, variable:boolean}>}
 *          sorted by mana value, then name
 */
export function findBigCreatures(library, treatStarAs5Plus = false) {
    const byName = new Map();
    for (const card of (Array.isArray(library) ? library : [])) {
        if (!isBigCreature(card, treatStarAs5Plus)) continue;
        const entry = byName.get(card.name);
        if (entry) { entry.count += 1; continue; }
        const p = String(card.power ?? '');
        byName.set(card.name, {
            name: card.name,
            cmc: Math.max(0, Math.round(Number(card.cmc) || 0)),
            power: card.power,
            toughness: card.toughness,
            count: 1,
            variable: p.includes('*') || p.includes('X')
        });
    }
    return [...byName.values()].sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));
}

/**
 * The cards a discover of `mv` can hit: nonlands at or under it, minus the
 * creature being cast. Grouped by mana value for display.
 *
 * @param {Array} library
 * @param {number} mv
 * @param {string|null} [castName]
 * @param {boolean} [treatStarAs5Plus=false]
 * @returns {{total:number, chainers:number, groups:Array<{mv:number, cards:Array<{name:string, count:number, chains:boolean}>}>}}
 */
export function discoverPool(library, mv, castName = null, treatStarAs5Plus = false) {
    const byMv = new Map();
    let total = 0;
    let chainers = 0;
    for (const card of withoutOne(library, castName)) {
        const types = Array.isArray(card?.types) ? card.types : [];
        if (types.includes('land')) continue;
        const cmc = Number.isFinite(card?.cmc) ? card.cmc : 0;
        if (cmc > mv) continue;
        total += 1;
        const chains = isBigCreature(card, treatStarAs5Plus);
        if (chains) chainers += 1;
        if (!byMv.has(cmc)) byMv.set(cmc, new Map());
        const names = byMv.get(cmc);
        const entry = names.get(card.name) ?? { name: card.name, count: 0, chains };
        entry.count += 1;
        names.set(card.name, entry);
    }
    const groups = [...byMv.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([cost, names]) => ({
            mv: cost,
            cards: [...names.values()].sort((a, b) => Number(b.chains) - Number(a.chains) || a.name.localeCompare(b.name))
        }));
    return { total, chainers, groups };
}

/**
 * Everything the page shows, for one library and star-power reading.
 *
 * Each big creature is sampled with itself removed from the library. Each
 * mana value on the chart reuses a deck creature's result where one exists
 * (so the chart, the table and the sample triggers agree) and samples a
 * hypothetical caster otherwise.
 *
 * @param {Array} library
 * @param {Object} [opts]
 * @param {boolean} [opts.treatStarAs5Plus=false]
 * @param {number} [opts.runs=DISCOVER_RUNS]
 */
export function analyzeVortex(library, opts = {}) {
    const { treatStarAs5Plus = false, runs = DISCOVER_RUNS } = opts;
    const lib = Array.isArray(library) ? library : [];

    const creatures = findBigCreatures(lib, treatStarAs5Plus).map(c => ({
        ...c,
        stats: discoverForCreature(lib, c, { treatStarAs5Plus, runs })
    }));

    // Creatures with a variable power box that the current reading leaves out.
    const starSkipped = treatStarAs5Plus
        ? 0
        : findBigCreatures(lib, true).filter(c => c.variable).length;

    const costs = creatures.map(c => c.cmc);
    const minMV = Math.max(1, Math.min(3, ...costs));
    const maxMV = Math.max(10, ...costs);

    const byMV = [];
    for (let mv = minMV; mv <= maxMV; mv++) {
        const here = creatures.filter(c => c.cmc === mv);
        const cast = here[0] ?? null;
        const stats = cast
            ? cast.stats
            : sampleDiscoverFrom(lib, mv, { runs, treatStarAs5Plus, seed: hashSeed(`mv|${mv}`) });
        byMV.push({
            x: mv,
            mv,
            castName: cast?.name ?? null,
            names: here.map(c => c.name),
            pool: discoverPool(lib, mv, cast?.name ?? null, treatStarAs5Plus).total,
            stats
        });
    }

    // Deck-wide figures weight each creature by its copies.
    const copies = creatures.reduce((s, c) => s + c.count, 0);
    const weighted = (f) => copies ? creatures.reduce((s, c) => s + f(c.stats) * c.count, 0) / copies : 0;
    const byValue = [...creatures].sort((a, b) => a.stats.avgMana - b.stats.avgMana);

    return {
        hasLibrary: lib.length > 0,
        librarySize: lib.length,
        treatStarAs5Plus,
        runs,
        creatures,
        copies,
        starSkipped,
        avgMana: weighted(s => s.avgMana),
        chainRate: weighted(s => s.chainRate),
        whiffRate: weighted(s => s.whiffRate),
        worst: byValue[0] ?? null,
        best: byValue[byValue.length - 1] ?? null,
        minMV,
        maxMV,
        byMV
    };
}

/** The chart/hero point for a mana value, clamped into the analysed range. */
export function pointAt(analysis, mv) {
    const rows = analysis?.byMV ?? [];
    if (rows.length === 0) return null;
    const clamped = Math.min(analysis.maxMV, Math.max(analysis.minMV, Math.round(Number(mv) || DEFAULT_MV)));
    return rows.find(r => r.mv === clamped) ?? rows[0];
}

/**
 * "Out of 100 triggers": quantile dots of the free mana one trigger casts.
 * Rings found nothing; solid green cast at least Vortex's own mana value;
 * neutral dots cast something smaller.
 * @param {number[]} manaDist - counts by free mana (discover summary)
 * @returns {Array<{value:number, tone:'good'|'flat'|'bad'}>}
 */
export function vortexDots(manaDist) {
    return pmfQuantiles(manaDist ?? [], 100).map(value => ({
        value,
        tone: value === 0 ? 'bad' : value >= VORTEX_COST ? 'good' : 'flat'
    }));
}

/** "about 1 trigger in 8 chains…" — chain frequency in words. */
export function chainPhrase(rate) {
    if (!(rate > 0)) return 'Nothing it can find is big enough to chain into another trigger.';
    if (rate < 0.01) return 'Chains into a second free spell are rare — under 1 trigger in 100.';
    if (rate < 0.5) return `About <strong>1 trigger in ${Math.round(1 / rate)}</strong> chains into a second free spell.`;
    return `<strong>${formatPercentage(rate, 0)}</strong> of triggers chain into a second free spell.`;
}

/**
 * The bottom line: what this deck's big creatures discover, in one or two
 * sentences, with a tone for what that means against Vortex's own cost.
 *
 * @param {ReturnType<typeof analyzeVortex>} analysis
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(analysis) {
    if (!analysis?.hasLibrary) {
        return { tone: 'flat', html: 'Import a decklist to see what your big creatures discover.' };
    }
    const n = analysis.creatures.length;
    if (n === 0) {
        const hint = analysis.starSkipped > 0
            ? ` ${analysis.starSkipped} creature${analysis.starSkipped === 1 ? ' has' : 's have'} a variable power — tick “Count * power as 5 or more” if ${analysis.starSkipped === 1 ? 'it is' : 'they are'} big when you cast ${analysis.starSkipped === 1 ? 'it' : 'them'}.`
            : ' Add creatures with power 5 or more to give it something to do.';
        return { tone: 'bad', html: `No creature in this deck has power 5 or more, so Monstrous Vortex never triggers.${hint}` };
    }

    const avg = analysis.avgMana;
    let html;
    if (n === 1) {
        const c = analysis.creatures[0];
        html = `Your only big creature, ${cardRef(c.name)}, discovers about <strong>${formatNumber(c.stats.avgMana, 1)} mana</strong> of free spells when you cast it — typically ${c.stats.medianMana}, and <strong>${c.stats.p95Mana}</strong> on a ${term('p95', 'good turn')}.`;
    } else {
        const lo = analysis.worst;
        const hi = analysis.best;
        html = `Your <strong>${n} big creatures</strong> discover about <strong>${formatNumber(avg, 1)} mana</strong> of free spells per cast — from ${formatNumber(lo.stats.avgMana, 1)} off ${cardRef(lo.name)} up to <strong>${formatNumber(hi.stats.avgMana, 1)}</strong> off ${cardRef(hi.name)}.`;
    }
    html += ` ${chainPhrase(analysis.chainRate)}`;

    let tone = avg >= VORTEX_COST ? 'good' : avg >= 2.5 ? 'warn' : 'bad';
    if (analysis.copies <= 3 && tone === 'good') {
        tone = 'warn';
        html += ` With only ${analysis.copies} to cast, though, it will not trigger often.`;
    }
    return { html, tone };
}

/**
 * Real shuffled examples of one trigger at a mana value.
 *
 * Seeded by mana value, caster and round, so a sample set is stable until the
 * player asks for a new one. Each step lists exactly what discover exiled
 * before its hit.
 *
 * @returns {Array<{chainCount:number, chainMana:number, steps:Array<{discoverCMC:number, passed:Array, hit:Object|null, chains:boolean}>}>}
 */
export function drawSamples(library, mv, { castName = null, count = SAMPLE_BATCH, round = 0, treatStarAs5Plus = false } = {}) {
    const lib = withoutOne(library, castName);
    const rng = mulberry32(hashSeed(`sample|${mv}|${castName ?? ''}|${round}`));
    const out = [];
    for (let i = 0; i < count; i++) {
        const shuffled = seededShuffle(lib, rng);
        const r = simulateDiscoverChain(shuffled, mv, { treatStarAs5Plus });
        out.push({
            chainCount: r.chainCount,
            chainMana: r.chainMana,
            steps: r.steps.map(s => ({
                discoverCMC: s.discoverCMC,
                passed: shuffled.slice(s.start, s.start + s.dug),
                hit: s.hit,
                chains: s.chains
            }))
        });
    }
    return out;
}

// ==================== STATE ====================

let chart = null;
let cache = { cardsByName: null, star: null, library: [], analysis: null, version: 0 };
/** Mana value being inspected; null until the player (or a share link) moves the slider. */
let selectedMV = null;
let sampleRound = 0;
let samplesShown = SAMPLE_BATCH;
let lastSampleKey = '';

/** Read the inputs and the deck. */
export function getConfig() {
    const raw = selectedMV ?? parseInt(document.getElementById('vortex-cmcSlider')?.value, 10);
    const data = DeckConfig.getImportedCardData();
    return {
        mv: Number.isFinite(raw) ? raw : DEFAULT_MV,
        treatStarAs5Plus: document.getElementById('vortex-star-power')?.checked ?? true,
        cardsByName: data?.cardsByName ?? {}
    };
}

/**
 * Analyse the deck — once per deck and star reading. Moving the slider only
 * picks a different row of the cached result, so it never re-simulates.
 */
export function calculate() {
    const config = getConfig();
    if (cache.cardsByName !== config.cardsByName || cache.star !== config.treatStarAs5Plus || !cache.analysis) {
        const library = buildDeckFromCardData({ cardsByName: config.cardsByName });
        cache = {
            cardsByName: config.cardsByName,
            star: config.treatStarAs5Plus,
            library,
            analysis: analyzeVortex(library, { treatStarAs5Plus: config.treatStarAs5Plus }),
            version: cache.version + 1
        };
    }
    const point = pointAt(cache.analysis, config.mv);
    return { config, library: cache.library, analysis: cache.analysis, point };
}

// ==================== RENDERING ====================

const pct = (v) => formatPercentage(v, 0);
/** "a 6-mana", "an 8-mana", "an 11-mana". */
const aMana = (n) => `${/^(8|11|18)/.test(String(n)) ? 'an' : 'a'} ${n}-mana`;

/** Keep the slider's range on the analysed mana values and its readout current. */
function syncSlider(analysis, point) {
    const slider = document.getElementById('vortex-cmcSlider');
    if (slider && analysis.byMV.length) {
        slider.min = String(analysis.minMV);
        slider.max = String(analysis.maxMV);
    }
    if (point && slider) {
        slider.value = String(point.mv);
        slider.setAttribute('aria-valuetext', `mana value ${point.mv}`);
    }
    const display = document.getElementById('vortex-mv-display');
    if (display) display.textContent = point ? String(point.mv) : '—';

    const scale = document.getElementById('vortex-mv-scale');
    if (scale) scale.innerHTML = `<span>${analysis.minMV}</span><span>${analysis.maxMV}</span>`;

    const who = document.getElementById('vortex-mv-who');
    if (who) {
        who.innerHTML = !point ? ''
            : point.names.length
                ? `In your deck: ${point.names.map(n => cardRef(n)).join(', ')}`
                : 'No big creature of yours costs this — the numbers show what one would discover.';
    }
}

/** The answer: bottom line plus one row per big creature. */
function renderAnswer(analysis, point) {
    const el = document.getElementById('vortex-answer');
    if (!el) return;
    const line = summarize(analysis);

    if (!analysis.hasLibrary || analysis.creatures.length === 0) {
        el.innerHTML = renderBottomLine(line);
        return;
    }

    const rows = analysis.creatures.map(c => `
        <tr class="${point && c.cmc === point.mv ? 'active-row' : ''}" data-mv="${c.cmc}" tabindex="0" aria-label="Inspect mana value ${c.cmc}">
            <td class="ta-l">${cardRef(c.name)}${c.count > 1 ? ` <span class="vx-copies">×${c.count}</span>` : ''}</td>
            <td>${c.cmc}</td>
            <td class="vx-strong">${formatNumber(c.stats.avgMana, 1)}</td>
            <td>${c.stats.medianMana}</td>
            <td>${c.stats.p95Mana}</td>
            <td>${pct(c.stats.chainRate)}</td>
        </tr>`).join('');

    el.innerHTML = `
        ${renderBottomLine(line)}
        <div class="tx-h">
            <span>Your big creatures</span>
            <span class="tx-h-r">free mana from one cast · pick a row to look closer</span>
        </div>
        <div class="vx-table-wrap">
            <table class="tx-sweep-table vx-creatures">
                <thead><tr>
                    <th class="ta-l">Creature</th>
                    <th>MV</th>
                    <th><span class="term" data-term="ev" tabindex="0">Average</span></th>
                    <th><span class="term" data-term="p50" tabindex="0">Typical</span></th>
                    <th><span class="term" data-term="p95" tabindex="0">Good turn</span></th>
                    <th><span class="term" data-tip="How often a trigger finds another power-5+ creature, which triggers Vortex again." tabindex="0">Chains</span></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

/** Hero stats and chart for the selected mana value. */
function renderSelected(analysis, point) {
    const head = document.getElementById('vortex-selected-head');
    const hero = document.getElementById('vortex-stats');
    if (!point || !analysis.hasLibrary) {
        if (head) head.innerHTML = '<span>One trigger, up close</span>';
        if (hero) hero.innerHTML = '<div class="tx-empty">Import a decklist to simulate discover against your library.</div>';
        return;
    }
    const s = point.stats;
    if (head) {
        head.innerHTML = `
            <span>Casting ${aMana(point.mv)} big creature</span>
            <span class="tx-h-r">discover ${point.mv} · ${point.pool} cards it can hit · ${s.runs.toLocaleString('en-US')} shuffles</span>`;
    }
    if (hero) {
        hero.innerHTML = renderHeroStats([
            {
                label: 'Free mana', value: formatNumber(s.avgMana, 1), size: 'big', term: 'ev',
                sub: `average per trigger, against Vortex’s own ${VORTEX_COST}`,
                color: s.avgMana >= VORTEX_COST ? 'var(--tx-good)' : 'var(--tx-bright)'
            },
            { label: 'Typical trigger', value: s.medianMana, sub: 'mana — half do better', term: 'p50' },
            { label: 'Good turn', value: s.p95Mana, sub: 'mana — 1 trigger in 20 beats it', term: 'p95' },
            {
                label: 'Chains', value: pct(s.chainRate),
                sub: s.whiffRate > 0.005 ? `cast 2+ spells · ${pct(s.whiffRate)} find nothing` : 'of triggers cast 2+ spells',
                tip: 'How often the free spell is itself a power-5+ creature, which triggers Vortex again at its own mana value.'
            }
        ]);
    }
    renderDots(point);
    updateChart(analysis, point);
}

const DOT_LEGEND = Object.freeze([
    { tone: 'good', label: `cast ${VORTEX_COST}+ mana` },
    { tone: 'flat', label: 'cast something smaller' },
    { tone: 'bad', label: 'found nothing' }
]);

/** "Out of 100 triggers" for the selected mana value. */
function renderDots(point) {
    const el = document.getElementById('vortex-dots');
    if (!el) return;
    const s = point?.stats;
    if (!s?.runs) {
        el.innerHTML = '';
        return;
    }
    const dots = vortexDots(s.manaDist);
    const legend = DOT_LEGEND.filter(l => dots.some(d => d.tone === l.tone));
    const rows = [];
    let atLeast = 1;
    (s.manaDist ?? []).forEach((n, mana) => {
        const p = n / s.runs;
        if (n > 0 && p >= 0.0005) rows.push([`${mana} mana`, pct(p), pct(atLeast)]);
        atLeast -= p;
    });
    const spells = (s.chainDist ?? []).map((n, k) => (n / s.runs >= 0.005 ? `${k}${k === 1 ? ' spell' : ' spells'} ${pct(n / s.runs)}` : null)).filter(Boolean);
    el.innerHTML = `
        <div class="vx-dots-head"><span>Out of 100 triggers</span><span class="vx-dots-sub">free spells per trigger: ${spells.join(' · ')}</span></div>
        ${dotPlot({
            dots,
            label: `Free mana from one discover ${point.mv} trigger, out of 100 triggers. ${describeDots(dots, { unit: 'trigger', format: v => `${v} mana`, legend })}`,
            unit: 'trigger',
            format: v => String(v),
            xLabel: 'Free mana cast by one trigger (chains included)',
            threshold: VORTEX_COST,
            thresholdLabel: `${VORTEX_COST}+ = Vortex’s own cost`,
            legend,
            maxColumns: 30,
            table: {
                summary: `All ${s.runs.toLocaleString('en-US')} shuffles`,
                caption: 'Share of simulated triggers by free mana',
                head: ['Free mana', 'Triggers', 'At least this'],
                rows
            }
        })}`;
}

/**
 * Value by mana value. Percentile lines, never a sampled maximum: the maximum
 * is a property of how many shuffles were run, not of the deck.
 */
function updateChart(analysis, point) {
    if (!document.getElementById('vortex-chart')) return;
    const rows = analysis.byMV;
    const has = new Set(analysis.creatures.map(c => c.cmc));
    const colour = TX.series[4] ?? TX.blue;
    const radius = rows.map(r => (r.mv === point?.mv ? 6 : has.has(r.mv) ? 3.5 : 0));
    const fill = rows.map(r => (r.mv === point?.mv ? TX.amber : colour));

    chart = createOrUpdateChart(chart, 'vortex-chart', {
        type: 'line',
        data: {
            labels: rows.map(r => String(r.mv)),
            datasets: [
                {
                    label: 'Average',
                    data: rows.map(r => r.stats.avgMana),
                    borderColor: colour,
                    backgroundColor: colour,
                    borderWidth: 2,
                    cubicInterpolationMode: 'monotone',
                    pointRadius: radius,
                    pointHoverRadius: 6,
                    pointBackgroundColor: fill,
                    pointBorderColor: fill
                },
                {
                    label: 'Good turn (1 in 20)',
                    data: rows.map(r => r.stats.p95Mana),
                    borderColor: colour,
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [5, 4],
                    cubicInterpolationMode: 'monotone',
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Typical',
                    data: rows.map(r => r.stats.medianMana),
                    borderColor: TX.dim,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderDash: [2, 3],
                    cubicInterpolationMode: 'monotone',
                    pointRadius: 0,
                    pointHoverRadius: 3
                }
            ]
        },
        options: {
            onClick: (_e, elements) => {
                const idx = elements?.[0]?.index;
                if (Number.isInteger(idx) && rows[idx]) selectMV(rows[idx].mv);
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: { color: TX.mid, boxWidth: 14, boxHeight: 2, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        title: (items) => `Creature with mana value ${items[0]?.label ?? ''}`,
                        label: (item) => `${item.dataset.label}: ${formatNumber(item.parsed.y, item.datasetIndex === 0 ? 1 : 0)} mana`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Free mana per trigger', color: TX.dim, font: { size: 11 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, precision: 0 }
                },
                x: {
                    title: { display: true, text: 'Mana value of the creature you cast', color: TX.dim, font: { size: 11 } },
                    grid: { display: false },
                    ticks: { color: TX.dim }
                }
            }
        }
    });
}

/** Chip for one card in a sample: hover previews the card. */
function chip(card, extraClass = '') {
    const type = card?.types?.[0] ?? 'land';
    const name = escapeHtml(card?.name ?? '');
    return `<span class="reveal-card ${type} ${extraClass}" data-card="${name}" tabindex="0">${name}</span>`;
}

/** What one discover passed over: names for spells, a count for lands. */
function passedHTML(passed) {
    if (!passed.length) return '';
    const lands = passed.filter(c => c?.types?.includes('land')).length;
    const spells = passed.filter(c => !c?.types?.includes('land'));
    const shown = spells.slice(0, 4).map(c => chip(c, 'is-passed')).join('');
    const more = spells.length > 4 ? `<span class="vx-more">+${spells.length - 4}</span>` : '';
    const landNote = lands ? `<span class="vx-more">${lands} land${lands === 1 ? '' : 's'}</span>` : '';
    return `<span class="vx-passed" title="Exiled and put on the bottom">${landNote}${shown}${more}</span>`;
}

function renderSamples(library, analysis, point, config) {
    const el = document.getElementById('vortex-reveals-display');
    if (!el) return;
    if (!point || !analysis.hasLibrary) { el.innerHTML = ''; return; }

    const key = `${point.mv}|${point.castName}|${config.treatStarAs5Plus}|${cache.version}`;
    if (key !== lastSampleKey) { samplesShown = SAMPLE_BATCH; lastSampleKey = key; }

    const samples = drawSamples(library, point.mv, {
        castName: point.castName, count: samplesShown, round: sampleRound, treatStarAs5Plus: config.treatStarAs5Plus
    });

    const items = samples.map((sample, i) => {
        const steps = sample.steps.map(step => `
            <li class="vx-step${step.chains ? ' is-chain' : ''}${step.hit ? '' : ' is-whiff'}">
                <span class="vx-step-x">Discover ${step.discoverCMC}</span>
                <span class="vx-step-body">
                    ${passedHTML(step.passed)}
                    ${step.hit
                        ? `${chip(step.hit, 'is-hit')}<span class="vx-step-mv">${step.hit.cmc}</span>${step.chains ? '<span class="vx-tag">triggers again</span>' : ''}`
                        : '<span class="vx-tag is-bad">nothing left to find</span>'}
                </span>
            </li>`).join('');
        const tone = sample.chainCount === 0 ? 'is-whiff' : sample.chainCount >= 2 ? 'is-chain' : '';
        return `
            <li class="vx-sample ${tone}">
                <div class="vx-sample-head">
                    <span class="vx-sample-n">#${i + 1}</span>
                    <span class="vx-sample-sum"><strong>${sample.chainMana} mana</strong> · ${sample.chainCount} free spell${sample.chainCount === 1 ? '' : 's'}</span>
                </div>
                <ol class="vx-steps">${steps}</ol>
            </li>`;
    }).join('');

    el.innerHTML = `
        <ol class="vx-samples">${items}</ol>
        <div class="vx-sample-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-vx-action="reshuffle">Shuffle again</button>
            ${samplesShown < SAMPLE_MAX ? '<button type="button" class="btn btn-ghost btn-sm" data-vx-action="more">Show more</button>' : ''}
            <span class="vx-sample-note">${point.castName ? `${escapeHtml(point.castName)} is on the stack, so it is not in the library.` : 'Each is one real shuffle of your library.'}</span>
        </div>`;
}

/** Secondary detail: the pool, every mana value, and the full spread. */
function renderDetails(library, analysis, point, config) {
    const poolEl = document.getElementById('vortex-pool');
    const poolSummary = document.getElementById('vortex-pool-summary');

    if (!point || !analysis.hasLibrary) {
        if (poolEl) poolEl.innerHTML = '';
        renderSweepTable('vortex-comparisonTable', { rows: [], columns: [], emptyText: 'Import a decklist to fill this in.' });
        return;
    }

    const pool = discoverPool(library, point.mv, point.castName, config.treatStarAs5Plus);
    if (poolSummary) poolSummary.textContent = `What discover ${point.mv} can find · ${pool.total} cards, ${pool.chainers} of them chain`;
    if (poolEl) {
        poolEl.innerHTML = pool.groups.length ? `
            <dl class="vx-pool">
                ${pool.groups.map(g => `
                    <div class="vx-pool-row">
                        <dt>MV ${g.mv}</dt>
                        <dd>${g.cards.map(c => `${cardRef(c.name)}${c.count > 1 ? ` ×${c.count}` : ''}${c.chains ? ' <span class="vx-tag">chains</span>' : ''}`).join('<span class="vx-sep">·</span>')}</dd>
                    </div>`).join('')}
            </dl>` : '<div class="tx-empty">Nothing in the library costs this little.</div>';
    }

    renderSweepTable('vortex-comparisonTable', {
        current: point.mv,
        rows: analysis.byMV,
        columns: [
            { label: 'MV', align: 'left', render: r => r.mv },
            { label: 'Can hit', render: r => r.pool },
            { label: 'Average', render: r => formatNumber(r.stats.avgMana, 1) },
            { label: 'Typical', render: r => r.stats.medianMana },
            { label: 'Good turn', render: r => r.stats.p95Mana },
            { label: 'Great turn', render: r => r.stats.p99Mana },
            { label: 'Chains', render: r => pct(r.stats.chainRate) },
            { label: 'Finds nothing', render: r => (r.stats.whiffRate > 0 ? pct(r.stats.whiffRate) : '—') },
            { label: 'Your creatures', align: 'left', render: r => (r.names.length ? r.names.map(n => cardRef(n)).join(', ') : '<span class="vx-dim">—</span>') }
        ]
    });
}

/** Show or hide the evidence panels; without a deck only the answer remains. */
function showPanels(ids, visible) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.hidden = !visible;
    }
}

export function updateUI() {
    const { config, library, analysis, point } = calculate();
    showPanels(['vortex-selected-panel', 'vortex-samples-panel', 'vortex-more-panel'], analysis.hasLibrary);
    syncSlider(analysis, point);
    renderAnswer(analysis, point);
    renderSelected(analysis, point);
    renderSamples(library, analysis, point, config);
    renderDetails(library, analysis, point, config);
}

/** Point the slider (and everything it drives) at a mana value. */
function selectMV(mv) {
    if (!Number.isFinite(mv)) return;
    selectedMV = mv;
    updateUI();
}

// ==================== SHARE LINKS ====================

/** The mana value travels via the legacy `vortexCMC` slider param; this adds the star reading. */
export function getShareParams() {
    const star = document.getElementById('vortex-star-power');
    return star ? { vortexStar: star.checked ? 1 : 0 } : {};
}

export function applyShareParams(params) {
    const raw = params?.get?.('vortexStar');
    if (raw !== '0' && raw !== '1') return;
    const star = document.getElementById('vortex-star-power');
    if (star) {
        star.checked = raw === '1';
        updateUI();
    }
}

// ==================== INIT ====================

export function init() {
    registerCalculator({ name: 'vortex', calculate, updateUI, inputs: [] });

    // The slider re-reads a cached analysis, so it can update on every input
    // event without debouncing — nothing is re-simulated while dragging.
    const slider = document.getElementById('vortex-cmcSlider');
    slider?.addEventListener('input', () => selectMV(parseInt(slider.value, 10)));

    document.getElementById('vortex-star-power')?.addEventListener('change', () => updateUI());

    // One delegated listener for everything rendered inside the page.
    document.getElementById('vortex-tab')?.addEventListener('click', (e) => {
        const action = e.target.closest?.('[data-vx-action]')?.dataset.vxAction;
        if (action === 'reshuffle') { sampleRound += 1; updateUI(); return; }
        if (action === 'more') { samplesShown = Math.min(SAMPLE_MAX, samplesShown + SAMPLE_BATCH); updateUI(); return; }
        const row = e.target.closest?.('tr[data-mv]');
        if (row) selectMV(parseInt(row.dataset.mv, 10));
    });
    document.getElementById('vortex-tab')?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest?.('tr[data-mv]');
        if (row && e.target === row) { e.preventDefault(); selectMV(parseInt(row.dataset.mv, 10)); }
    });
}
