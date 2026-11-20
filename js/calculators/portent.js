/**
 * Portent of Calamity — {X}{U} sorcery.
 *
 * "Reveal the top X cards of your library. For each card type, you may exile a
 * card of that type from among them. Put the rest into your graveyard. You may
 * cast a spell from among the exiled cards without paying its mana cost if you
 * exiled four or more cards this way. Then put the rest of the exiled cards
 * into your hand."
 *
 * A card with several types (an artifact creature) can be exiled for only one
 * of them, so the number of cards Portent exiles is a maximum matching between
 * card types and revealed cards — not simply the number of distinct types on
 * show. With at most eight types the matching is tiny, so each simulated reveal
 * grows it one card at a time with augmenting paths.
 */

import { createCache } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, renderSweepTable, pBarCell } from '../utils/components.js';
import { cardRef } from '../data/glossary.js';
import {
    CARD_TYPES, avg, barsHTML, cardListKey, chanceTone, createSampler, deckCardList, expandCards,
    noticeHTML, pct, plural, points, pointsShort, renderHowItCompares, sampleCardHTML, toneColor, typeLabel,
    syncXControl, bindXPresets, readX, fade
} from '../utils/bigSpells.js';

const CONFIG = Object.freeze({
    ITERATIONS: 25000,
    FREE_SPELL_THRESHOLD: 4,
    MAX_X: 30,
    TABLE_MAX_X: 20,
    RELIABLE: 0.9,
    DEFAULT_X: 7,
    SAMPLE_COUNT: 4
});

const ALL_TYPES = (1 << CARD_TYPES.length) - 1;
const COUNT_FIELDS = Object.freeze({
    creature: 'creatures', artifact: 'artifacts', enchantment: 'enchantments', planeswalker: 'planeswalkers',
    battle: 'battles', land: 'lands', instant: 'instants', sorcery: 'sorceries'
});

const resultCache = createCache(8);
const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;

// ── Card types as bitmasks ───────────────────────────────────────────────────

/** Bitmask of a type line's card types (bit order = CARD_TYPES). */
export function typeMask(typeLine) {
    const lower = String(typeLine ?? '').toLowerCase();
    let mask = 0;
    CARD_TYPES.forEach((type, bit) => {
        if (lower.includes(type)) mask |= 1 << bit;
    });
    return mask;
}

/**
 * One type mask per card in the library.
 * @param {Array<{type_line:string, count:number}>} cards - card list (may be empty)
 * @param {Object} [counts] - DeckConfig type counts, used when there is no list
 * @returns {Uint8Array}
 */
export function buildTypeMasks(cards = [], counts = {}) {
    const masks = [];
    if (cards.length > 0) {
        for (const card of cards) {
            const mask = typeMask(card.type_line);
            for (let i = 0; i < (card.count ?? 0); i++) masks.push(mask);
        }
    } else {
        CARD_TYPES.forEach((type, bit) => {
            const n = Math.max(0, Math.floor(Number(counts?.[COUNT_FIELDS[type]]) || 0));
            for (let i = 0; i < n; i++) masks.push(1 << bit);
        });
    }
    return Uint8Array.from(masks);
}

/**
 * Incremental maximum matching between card types and revealed cards.
 * add() reveals one more card and returns how many cards can now be exiled.
 */
function createMatcher(capacity) {
    const cardMask = new Uint8Array(Math.max(1, capacity));
    const owner = new Int16Array(CARD_TYPES.length).fill(-1);
    let size = 0;
    let matched = 0;
    let usedTypes = 0;
    let visited = 0;

    function augment(card) {
        let options = cardMask[card] & ~visited;
        while (options) {
            const bit = options & -options;
            options ^= bit;
            visited |= bit;
            const type = 31 - Math.clz32(bit);
            const holder = owner[type];
            if (holder < 0 || augment(holder)) {
                owner[type] = card;
                usedTypes |= bit;
                return true;
            }
        }
        return false;
    }

    return {
        reset() {
            owner.fill(-1);
            size = 0;
            matched = 0;
            usedTypes = 0;
        },
        add(mask) {
            const index = size++;
            cardMask[index] = mask;
            if (!mask || usedTypes === ALL_TYPES) return matched;
            const free = mask & ~usedTypes;
            if (free) {
                const bit = free & -free;
                owner[31 - Math.clz32(bit)] = index;
                usedTypes |= bit;
                return ++matched;
            }
            visited = 0;
            if (augment(index)) matched++;
            return matched;
        },
        /** type index -> card index (or -1) */
        owners() {
            return Array.from(owner);
        }
    };
}

/** How many cards Portent can exile from these revealed type masks. */
export function maxExiled(masks) {
    const matcher = createMatcher(masks.length);
    let exiled = 0;
    for (const mask of masks) exiled = matcher.add(mask);
    return exiled;
}

/**
 * Monte Carlo over shuffled libraries: for every X up to maxX, the distribution
 * of cards exiled. One pass per shuffle covers every X at once.
 *
 * @param {Uint8Array|number[]} masks - one type mask per library card
 * @param {number} maxX
 * @param {{iterations?:number, random?:() => number}} [opts]
 * @returns {Object<number, {x:number, dist:number[], expectedTypes:number, prob4Plus:number, expectedToHand:number}>}
 */
export function simulatePortent(masks, maxX, { iterations = CONFIG.ITERATIONS, random = Math.random } = {}) {
    const deck = Uint8Array.from(masks ?? []);
    const size = deck.length;
    const top = Math.max(0, Math.min(Math.floor(maxX) || 0, size));
    const results = {};
    if (top === 0 || iterations <= 0) return results;

    const counts = Array.from({ length: top + 1 }, () => new Uint32Array(CARD_TYPES.length + 1));
    const matcher = createMatcher(top);

    for (let iter = 0; iter < iterations; iter++) {
        matcher.reset();
        for (let i = 0; i < top; i++) {
            const pick = i + Math.floor(random() * (size - i));
            const card = deck[pick];
            deck[pick] = deck[i];
            deck[i] = card;
            counts[i + 1][matcher.add(card)]++;
        }
    }

    for (let x = 1; x <= top; x++) {
        const dist = Array.from(counts[x], c => c / iterations);
        const expectedTypes = dist.reduce((sum, p, k) => sum + p * k, 0);
        const prob4Plus = dist.slice(CONFIG.FREE_SPELL_THRESHOLD).reduce((a, b) => a + b, 0);
        results[x] = {
            x,
            dist,
            expectedTypes,
            prob4Plus,
            // One exiled card is cast instead of going to hand.
            expectedToHand: expectedTypes - prob4Plus
        };
    }
    return results;
}

function masksKey(masks) {
    const histogram = new Uint32Array(1 << CARD_TYPES.length);
    for (const mask of masks) histogram[mask]++;
    let key = `${masks.length}`;
    histogram.forEach((n, mask) => { if (n) key += `,${mask}:${n}`; });
    return key;
}

/** Cached simulation for a library (only the type mix matters, not names). */
function portentResults(masks, maxX) {
    const key = `${masksKey(masks)}|${maxX}`;
    let results = resultCache.get(key);
    if (!results) {
        results = simulatePortent(masks, maxX);
        resultCache.set(key, results);
    }
    return results;
}

/**
 * Portent's outcome at one X for a deck, without touching the page — the entry
 * point other calculators (the big-spell comparison) use.
 *
 * @param {{cards?:Array, counts?:Object, x:number}} opts
 * @returns {{x:number, dist:number[], expectedTypes:number, prob4Plus:number, expectedToHand:number}|null}
 */
export function portentOutcomes({ cards, counts, x } = {}) {
    const deck = counts ?? DeckConfig.getDeckConfig();
    const masks = buildTypeMasks(cards ?? deckCardList(deck), deck);
    if (masks.length === 0) return null;
    const want = Math.max(1, Math.floor(Number(x) || 1));
    const maxX = Math.min(masks.length, Math.max(CONFIG.MAX_X, want));
    return portentResults(masks, maxX)[Math.min(want, maxX)] ?? null;
}

// ── Resolving one reveal (sample casts) ──────────────────────────────────────

/**
 * Resolve one reveal the way a player would: exile as many cards as possible,
 * making sure the costliest spell is among them, then cast it free if four or
 * more were exiled.
 *
 * @param {Array<{name:string, types:string[], cmc:number}>} revealed
 * @returns {{exiled:Array<{card:Object, type:string}>, free:Object|null, freeSpell:boolean, toHand:Object[], graveyard:Object[], fateOf:Map}}
 */
export function resolvePortent(revealed = []) {
    const isSpell = card => card.types.some(type => type !== 'land');
    // Kuhn's matching never unmatches a card once matched, so offering the
    // costliest spells first guarantees the best free cast is exiled.
    const order = revealed.map((card, i) => i).sort((a, b) => {
        const ca = revealed[a];
        const cb = revealed[b];
        if (isSpell(ca) !== isSpell(cb)) return isSpell(ca) ? -1 : 1;
        return (cb.cmc ?? 0) - (ca.cmc ?? 0) || a - b;
    });
    const matcher = createMatcher(revealed.length);
    order.forEach(i => matcher.add(revealed[i].types.reduce((m, t) => m | (1 << CARD_TYPES.indexOf(t)), 0)));

    const typeOfSlot = new Map();
    matcher.owners().forEach((slot, typeIndex) => {
        if (slot >= 0) typeOfSlot.set(slot, CARD_TYPES[typeIndex]);
    });
    const exiled = [];
    order.forEach((cardIndex, slot) => {
        if (typeOfSlot.has(slot)) exiled.push({ index: cardIndex, card: revealed[cardIndex], type: typeOfSlot.get(slot) });
    });

    const freeSpell = exiled.length >= CONFIG.FREE_SPELL_THRESHOLD;
    const castable = exiled.filter(e => isSpell(e.card)).sort((a, b) => (b.card.cmc ?? 0) - (a.card.cmc ?? 0));
    const freeEntry = freeSpell ? castable[0] ?? null : null;
    const fateOf = new Map();
    exiled.forEach(e => fateOf.set(e.index, e === freeEntry ? { fate: 'cast', type: e.type } : { fate: 'hand', type: e.type }));

    return {
        exiled: exiled.map(({ card, type }) => ({ card, type })),
        free: freeEntry?.card ?? null,
        freeSpell,
        toHand: exiled.filter(e => e !== freeEntry).map(e => e.card),
        graveyard: revealed.filter((card, i) => !fateOf.has(i)),
        fateOf
    };
}

// ── Plain-English answer ─────────────────────────────────────────────────────

/**
 * Pull the numbers the answer needs out of a results table.
 * @param {Object} results - simulatePortent() output
 * @param {number} x
 * @param {{typesInDeck?:number}} [deck]
 */
export function analyze(results, x, { typesInDeck = CARD_TYPES.length } = {}) {
    const xs = Object.keys(results ?? {}).map(Number).sort((a, b) => a - b);
    const maxX = xs.length ? xs[xs.length - 1] : 0;
    const at = results?.[x] ?? null;
    const reliable = xs.find(k => (results[k]?.prob4Plus ?? 0) >= CONFIG.RELIABLE) ?? null;
    return {
        x,
        mana: x + 1,
        prob: at?.prob4Plus ?? 0,
        cards: at?.expectedTypes ?? 0,
        toHand: at?.expectedToHand ?? 0,
        next: results?.[x + 1] ?? null,
        reliableX: reliable,
        maxX,
        typesInDeck
    };
}

/**
 * The bottom line for the page: a deck-specific, plain-English answer to
 * "How often does Portent reveal four card types for a free spell?"
 * @param {ReturnType<typeof analyze>} a
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(a) {
    if (!a || a.maxX === 0) {
        return { html: 'Add cards to your deck to see how Portent performs.', tone: 'flat' };
    }
    if (a.typesInDeck < CONFIG.FREE_SPELL_THRESHOLD) {
        return {
            html: `This deck has only <strong>${plural(a.typesInDeck, 'card type')}</strong>, so Portent can never exile four cards — it will never cast a free spell. At X=${a.x} you still keep about <strong>${avg(a.cards)} cards</strong>.`,
            tone: 'bad'
        };
    }
    const lead = `At <strong>X=${a.x}</strong> (${a.mana} mana), Portent finds four card types and casts one free <strong>${pct(a.prob)}</strong> of the time, and you keep about <strong>${avg(a.cards)} cards</strong>.`;
    let follow;
    if (a.reliableX == null) {
        follow = `Even at X=${a.maxX} it stays under 9 in 10 — the deck leans on too few card types.`;
    } else if (a.reliableX > a.x) {
        follow = `It becomes a near-lock (9 in 10) at <strong>X=${a.reliableX}</strong>.`;
    } else if (a.reliableX < a.x) {
        follow = `X=${a.reliableX} is already 9 in 10 — ${plural(a.x - a.reliableX, 'mana')} cheaper.`;
    } else {
        follow = 'This is the cheapest X that makes it 9 in 10.';
    }
    return { html: `${lead} ${follow}`, tone: chanceTone(a.prob) };
}

// ── Deck and page state ──────────────────────────────────────────────────────

/**
 * The page's inputs plus the library they apply to. Reads Portent's own X
 * input when its page is mounted; falls back to the default otherwise.
 */
export function getDeckConfig() {
    const deck = DeckConfig.getDeckConfig();
    const cards = deckCardList(deck);
    const masks = buildTypeMasks(cards, deck);
    const deckSize = masks.length;
    const maxX = Math.max(1, Math.min(deckSize, CONFIG.MAX_X));
    const x = Math.min(maxX, readX('portent', CONFIG.DEFAULT_X));

    const types = {};
    CARD_TYPES.forEach((type, bit) => {
        let n = 0;
        for (const mask of masks) if (mask & (1 << bit)) n++;
        types[type] = n;
    });

    return { deckSize, x, maxX, types, cards, masks, deckKey: cards.length ? cardListKey(cards) : masksKey(masks) };
}

/**
 * Results for every X up to the slider's maximum. Cached per library, so moving
 * the slider never re-runs the simulation.
 */
export function calculate() {
    const config = getDeckConfig();
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
            label: 'Free-spell chance', value: pct(a.prob), size: 'big', color: toneColor(chanceTone(a.prob)),
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
        : fade({ good: TX_CHART.green, warn: TX_CHART.amber, bad: TX_CHART.red }[chanceTone(probs[i] / 100)] ?? TX_CHART.blue, 0.38));

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
            { label: 'Free-spell chance', align: 'left', render: r => pBarCell(r.prob, toneColor(chanceTone(r.prob))) },
            { label: '', render: r => `<span style="color:${toneColor(chanceTone(r.prob))}">${pct(r.prob)}</span>` },
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
            label: k >= CONFIG.FREE_SPELL_THRESHOLD ? `${plural(k, 'card')} · free spell` : plural(k, 'card'),
            value: p,
            tone: k >= CONFIG.FREE_SPELL_THRESHOLD ? 'good' : 'bad'
        }));
        distEl.innerHTML = `<p class="bs-caption">How often each cast exiles that many cards, over ${CONFIG.ITERATIONS.toLocaleString('en-US')} simulated casts. Four or more is a free spell.</p>`
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
                renderSamples(getDeckConfig());
            });
        }
    });
}
