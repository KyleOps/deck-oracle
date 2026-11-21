/**
 * The big-spell kit — what the four "big spell" pages share: Portent of
 * Calamity, Genesis Wave, Kamahl's Druidic Vow and Primal Surge.
 *
 *   - the sample shuffles and card-type labels
 *   - markup and CSS strings the four views render, so the pages look and
 *     behave as one family
 *   - the X-spell page kit: the X control, the value-model inputs, the
 *     deck → library read, the payback chart, sample casts that pay for
 *     themselves or fall short, the every-X table, the dots switch and the
 *     page wiring. Genesis Wave and the Vow are the same page around a
 *     different model; Portent and Primal Surge use the parts that fit.
 *
 * The deck helpers (the card list, its size and cache key) live in
 * models/cardList.js and the exact maths in the models and hypergeometric.js,
 * so the models and the comparison never import this module.
 *
 * Functions that touch the DOM ("page helpers", the kit and
 * renderHowItCompares()) are only ever called by the page that owns the
 * elements they touch. renderHowItCompares() lazy-loads the comparison so a
 * page's first paint never waits on the other three calculators.
 */

import { shuffle } from './random.js';
import { CARD_TYPES } from './library.js';
import { avg, pct, plural } from './text.js';
import { createOrUpdateChart, TX_CHART, withAlpha } from './chartHelpers.js';
import { renderBottomLine, renderSweepTable, pBarCell, toneColor, toneFor } from './components.js';
import { scoreBattlefieldValue } from './payback.js';
import * as DeckConfig from './deckConfig.js';
import { cardListKey, deckCardList } from './models/cardList.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import { cardImageUrl, findCard } from '../data/images.js';

// ── Card types ───────────────────────────────────────────────────────────────

const TYPE_LABELS = Object.freeze({
    creature: 'Creature', artifact: 'Artifact', enchantment: 'Enchantment', planeswalker: 'Planeswalker',
    battle: 'Battle', land: 'Land', instant: 'Instant', sorcery: 'Sorcery'
});

/** Display name for a card type key. */
export function typeLabel(type) {
    return TYPE_LABELS[type] ?? String(type ?? '');
}

// ── Sample shuffles ──────────────────────────────────────────────────────────

/**
 * A handful of shuffled libraries that stay put until the deck changes or the
 * player asks for new ones — so moving a slider shows the same shuffles
 * resolving differently, rather than new random cards every time.
 * @param {number} [size=4]
 */
export function createSampler(size = 4) {
    let key = null;
    let decks = [];
    return {
        /**
         * @param {string} deckKey - changes whenever the library changes
         * @param {() => Array} build - builds the unshuffled library
         */
        get(deckKey, build) {
            if (deckKey !== key) {
                const base = build() ?? [];
                decks = Array.from({ length: size }, () => shuffle(base.slice()));
                key = deckKey;
            }
            return decks;
        },
        reshuffle() {
            key = null;
        }
    };
}

// ── Markup (strings only) ────────────────────────────────────────────────────

/**
 * The X input every X spell uses: a big number box, a slider and preset chips.
 * Keeps the `<key>-xSlider` / `<key>-xValue` ids share links and
 * registerCalculator() bind to.
 */
export function xControlHTML({ key, label = 'Cards revealed (X)', hint = '', value = 7, max = 30, presets = [], costLabel = '' }) {
    const chips = presets.map(x =>
        `<button class="bs-chip" type="button" data-x="${x}" aria-pressed="false">X=${x}</button>`).join('');
    return `
        <div class="bs-field">
            <div class="bs-field-head">
                <label class="bs-label" for="${key}-xValue">${label}</label>
                <span class="bs-cost" id="${key}-cost">${costLabel}</span>
            </div>
            <div class="bs-x">
                <input class="field bs-x-num" type="number" id="${key}-xValue" value="${value}" min="1" max="50" inputmode="numeric" aria-describedby="${key}-x-hint">
                <input type="range" id="${key}-xSlider" value="${value}" min="1" max="${max}" step="1" aria-label="${escapeHtml(label)}">
            </div>
            ${chips ? `<div class="bs-presets" id="${key}-presets" role="group" aria-label="Common X values">${chips}</div>` : ''}
            ${hint ? `<p class="bs-hint" id="${key}-x-hint">${hint}</p>` : ''}
        </div>`;
}

/**
 * The value model inputs (what "pays for itself" means). Ids are kept from the
 * legacy pages so old share links still restore them.
 * @param {{key:string, fields:Array<{id:string,label:string,hint:string,value:number,min?:number,max?:number}>, intro?:string, footer?:string}} opts
 */
export function valueModelHTML({ fields = [], intro = '', footer = '' }) {
    const rows = fields.map(f => `
        <label class="bs-value-row" for="${f.id}">
            <span class="bs-value-name">${f.label}</span>
            <input type="number" class="field field-sm" id="${f.id}" value="${f.value}" min="${f.min ?? 0}" max="${f.max ?? 20}" step="0.25" inputmode="decimal">
            <small>${f.hint}</small>
        </label>`).join('');
    return `
        <div class="bs-field">
            <div class="bs-field-head"><span class="bs-label">What counts as paying for itself</span></div>
            ${intro ? `<p class="bs-hint">${intro}</p>` : ''}
            <div class="bs-value">${rows}</div>
            ${footer ? `<p class="bs-hint">${footer}</p>` : ''}
        </div>`;
}

/** A small type-coloured dot. */
export function typeDot(type) {
    const known = CARD_TYPES.includes(type) ? type : 'artifact';
    return `<span class="bs-dot" style="--dot: var(--type-${known})" aria-hidden="true"></span>`;
}

/**
 * One sample cast: header, the cards it looked at with what happened to each,
 * and a one-line result.
 * A row of `{ more: 'text' }` renders as a "+ N more" line inside the list.
 *
 * @param {{title:string, tag:string, tone:'good'|'bad'|'flat', rows:Array<{name?:string, type?:string, mv?:number|string, fate?:string, state?:'hit'|'miss'|'star', more?:string}>, more?:string, footer:string}} sample
 */
export function sampleCardHTML({ title, tag, tone = 'flat', rows = [], more = '', footer = '' }) {
    const items = rows.map(row => row.more ? `<li class="bs-more">${row.more}</li>` : `
        <li class="bs-card is-${row.state ?? 'hit'}">
            ${typeDot(row.type)}
            <span class="bs-card-name">${cardRef(row.name)}</span>
            <span class="bs-card-mv">${row.mv ?? ''}</span>
            <span class="bs-fate">${row.fate ?? ''}</span>
        </li>`).join('');
    return `
        <article class="bs-sample tone-${tone}">
            <header class="bs-sample-head">
                <span class="bs-sample-title">${title}</span>
                <span class="bs-tag">${tag}</span>
            </header>
            <ol class="bs-cards">${items}</ol>
            ${more ? `<p class="bs-more">${more}</p>` : ''}
            <footer class="bs-sample-foot">${footer}</footer>
        </article>`;
}

/**
 * Horizontal probability bars.
 * @param {Array<{label:string, value:number, tone?:string, note?:string, current?:boolean}>} rows
 * @param {{scale?:number}} [opts] - value that fills the bar (default 1)
 */
export function barsHTML(rows, { scale = 1, format = pct } = {}) {
    const items = rows.map(row => {
        const width = Math.max(0, Math.min(100, (Number(row.value) || 0) / (scale || 1) * 100));
        return `
            <li class="bs-bar-row${row.current ? ' is-current' : ''}">
                <span class="bs-bar-label">${row.label}</span>
                <span class="bs-bar tone-${row.tone ?? 'flat'}"><span style="width:${width.toFixed(1)}%"></span></span>
                <span class="bs-bar-value">${format(row.value)}</span>
                ${row.note ? `<span class="bs-bar-note">${row.note}</span>` : ''}
            </li>`;
    }).join('');
    return `<ol class="bs-bars">${items}</ol>`;
}

/** Empty / notice states. */
export function noticeHTML(html, tone = 'warn') {
    return `<p class="bs-notice tone-${tone}">${html}</p>`;
}

// ── Page helpers (only ever called by the page that owns the inputs) ─────────

function byId(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

/**
 * The page's X, or the fallback when its page has not been mounted.
 * @param {string} key - calculator key
 * @param {number} fallback
 */
export function readX(key, fallback) {
    const value = parseInt(byId(`${key}-xValue`)?.value, 10);
    return Number.isFinite(value) && value >= 1 ? value : fallback;
}

/**
 * Bring the X control in line with the value actually used (clamped to the
 * library), update the cost line and the preset chips.
 */
export function syncXControl(key, x, max, costText) {
    const slider = byId(`${key}-xSlider`);
    const input = byId(`${key}-xValue`);
    if (slider) {
        if (String(slider.max) !== String(max)) slider.max = max;
        if (String(slider.value) !== String(x)) slider.value = x;
    }
    // Never rewrite the box while someone is typing in it.
    if (input && input !== document.activeElement && String(input.value) !== String(x)) input.value = x;
    const cost = byId(`${key}-cost`);
    if (cost && cost.textContent !== costText) cost.textContent = costText;
    document.querySelectorAll?.(`#${key}-presets .bs-chip`).forEach(chip => {
        chip.setAttribute('aria-pressed', String(Number(chip.dataset.x) === x));
    });
}

/** Wire the preset chips to a setter. */
export function bindXPresets(key, onPick) {
    byId(`${key}-presets`)?.addEventListener('click', event => {
        const chip = event.target.closest?.('.bs-chip');
        if (chip) onPick(Number(chip.dataset.x));
    });
}

// ── X-spell page kit (only ever called by the page that owns the inputs) ────

/** Set the X control (slider and box) to `x`; the page renders next. */
export function setXInputs(key, x) {
    const slider = byId(`${key}-xSlider`);
    const input = byId(`${key}-xValue`);
    if (slider) slider.value = x;
    if (input) input.value = x;
}

/**
 * A value-model input (credit per land, per permanent), clamped to 0–20, or
 * the fallback when its page has not been mounted.
 * @param {string} id
 * @param {number} fallback
 */
export function readValueInput(id, fallback) {
    const value = parseFloat(byId(id)?.value);
    return Number.isFinite(value) ? Math.min(20, Math.max(0, value)) : fallback;
}

/**
 * The deck as an X spell sees it: the card list without the copy being cast,
 * the page's library model over it, how high X can go, the X chosen and a key
 * that changes whenever the library does.
 *
 * @param {string} key - calculator key (its X control is `<key>-xValue`)
 * @param {Object} deck - DeckConfig.getDeckConfig()
 * @param {Object} opts
 * @param {Object} opts.onStack - the model's ON_STACK (the card being cast)
 * @param {(cards:Array, deck:Object) => Object} opts.build - the model's library builder
 * @param {number} opts.maxX - the X control's own limit
 * @param {number} opts.defaultX - X before the page is mounted
 * @param {(library:Object) => number} [opts.size] - cards in the library (default `library.deckSize`)
 * @param {(library:Object) => string} [opts.countsKey] - the key for a counts-only deck
 * @returns {{cards:Array, library:Object, deckSize:number, maxX:number, x:number, deckKey:string}}
 */
export function readXSpell(key, deck, {
    onStack, build, maxX: limit, defaultX,
    size = library => library.deckSize,
    countsKey = library => `counts:${library.entries.map(e => e.count).join(',')}`
}) {
    const cards = deckCardList(deck, onStack);
    const library = build(cards, deck);
    const deckSize = size(library);
    const maxX = Math.max(1, Math.min(deckSize, limit));
    const x = Math.min(maxX, readX(key, defaultX));
    return { cards, library, deckSize, maxX, x, deckKey: cards.length ? cardListKey(cards) : countsKey(library) };
}

/**
 * The page with nothing to show (an empty deck): a one-line answer and no dots.
 * The page drops its own chart and cast.
 * @param {string} key
 * @param {string} html
 */
export function renderEmptyAnswer(key, html) {
    const el = byId(`${key}-stats`);
    if (el) el.innerHTML = renderBottomLine({ html, tone: 'flat' });
    const dots = byId(`${key}-dots`);
    if (dots) dots.innerHTML = '';
}

/**
 * The big-spell chart: bars for what each X (or card count) puts into play,
 * a line for the chance it pays for itself on the right axis (hidden for a
 * counts-only deck, with the legend's `[data-payback-key]`), the current
 * choice highlighted. With `onPick`, clicking a bar picks it.
 *
 * @param {Object|null} chart - the page's chart so far
 * @param {string} key - calculator key (canvas `<key>-chart`)
 * @param {Object} spec
 * @param {number[]} spec.points - the x values (X, or a card count)
 * @param {number} spec.current - the highlighted point
 * @param {{label:string, data:number[]}} spec.bars
 * @param {Array<number|null>|null} spec.payback - chance per point, in % (null: no line)
 * @param {string} spec.xTitle
 * @param {string} spec.yTitle
 * @param {(point:number) => string} spec.title - tooltip title
 * @param {(item:Object) => string} [spec.barLabel] - tooltip line for a bar
 * @param {(point:number) => void} [spec.onPick]
 * @returns {Object|null} the chart
 */
export function paybackChart(chart, key, { points, current, bars, payback, xTitle, yTitle, title, barLabel, onPick }) {
    const hasPayback = Boolean(payback);
    if (chart && chart.$hasPayback !== hasPayback) {
        // Axis options are fixed at creation; rebuild when the right axis comes or goes.
        chart.destroy();
        chart = null;
    }
    const at = point => point === current;
    const picking = onPick ? {
        onClick: (event, elements) => {
            const index = elements?.[0]?.index;
            if (index != null) onPick(points[index]);
        },
        onHover: (event, elements) => {
            const target = event?.native?.target;
            if (target) target.style.cursor = elements?.length ? 'pointer' : 'default';
        }
    } : {};
    chart = createOrUpdateChart(chart, `${key}-chart`, {
        type: 'bar',
        data: {
            labels: points.map(String),
            datasets: [
                {
                    label: bars.label,
                    data: bars.data,
                    backgroundColor: points.map(p => at(p) ? TX_CHART.amber : withAlpha(TX_CHART.blue, 0.45)),
                    hoverBackgroundColor: points.map(p => at(p) ? TX_CHART.amber : withAlpha(TX_CHART.blue, 0.7)),
                    borderRadius: 3,
                    maxBarThickness: 34,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Pays for itself',
                    type: 'line',
                    data: hasPayback ? payback : points.map(() => null),
                    borderColor: TX_CHART.green,
                    backgroundColor: TX_CHART.green,
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: points.map(p => at(p) ? 5 : 2),
                    pointBackgroundColor: points.map(p => at(p) ? TX_CHART.green : TX_CHART.bg),
                    pointBorderColor: TX_CHART.green,
                    hidden: !hasPayback,
                    yAxisID: 'y2',
                    order: 1
                }
            ]
        },
        options: {
            ...picking,
            scales: {
                x: { title: { display: true, text: xTitle, color: TX_CHART.dim }, grid: { display: false } },
                y: { beginAtZero: true, title: { display: true, text: yTitle, color: TX_CHART.dim } },
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
                        title: items => title(Number(items[0].label)),
                        label: item => item.datasetIndex === 0
                            ? (barLabel ? barLabel(item) : `${bars.label}: ${avg(item.parsed.y)}`)
                            : `Pays for itself: ${pct(item.parsed.y / 100)}`
                    }
                }
            }
        }
    });
    if (chart) chart.$hasPayback = hasPayback;
    if (typeof document !== 'undefined') {
        document.querySelectorAll(`#${key}-tab [data-payback-key]`).forEach(el => { el.hidden = !hasPayback; });
    }
    return chart;
}

/**
 * One sample cast of a spell that puts cards onto the battlefield: the first
 * `maxRows` cards it looked at, "+ N more", and whether what it put into play
 * paid for the mana spent.
 *
 * @param {Object} opts
 * @param {number} opts.index - which shuffle (0-based)
 * @param {Array} opts.rows - every card looked at (sampleCardHTML rows; `state: 'miss'` for the ones it skips)
 * @param {number} opts.maxRows
 * @param {string} opts.hitUnit - a hit, in "+ 4 more cards (2 permanents)"
 * @param {{manaValue:number, lands:number, cards:number}} opts.put - what went onto the battlefield
 * @param {Object} opts.settings - the value model (landValue, cardValue)
 * @param {number} opts.threshold - the mana spent
 * @param {string} opts.lead - the footer's start, e.g. "<strong>5 permanents</strong>"
 */
export function paybackSampleHTML({ index, rows, maxRows, hitUnit, put, settings, threshold, lead }) {
    const scored = scoreBattlefieldValue(put, { ...settings, threshold });
    const hidden = rows.slice(maxRows);
    return sampleCardHTML({
        title: `Shuffle ${index + 1}`,
        tag: scored.paidForItself ? 'Pays for itself' : 'Falls short',
        tone: scored.paidForItself ? 'good' : 'bad',
        rows: rows.slice(0, maxRows),
        more: hidden.length ? `+ ${plural(hidden.length, 'more card')} (${plural(hidden.filter(r => r.state !== 'miss').length, hitUnit)})` : '',
        footer: `${lead} · value <strong>${avg(scored.effectiveValue)}</strong> of ${threshold} needed`
    });
}

/**
 * The "every X" table of an X spell that pays for itself: X, mana, the page's
 * own columns, the change from one X less, the hit rate and the payback chance.
 *
 * @param {string} tableId
 * @param {Object} opts
 * @param {number} opts.x - the current X
 * @param {number|null} opts.recommended - the X to mark as recommended
 * @param {Object<number, Object>} opts.results - the sweep, by X (each with `mana` and `payback`)
 * @param {number} opts.maxX
 * @param {number} opts.tableMax - the table stops here
 * @param {(r:Object) => number} opts.hits - average hits at one X
 * @param {(r:Object) => number} opts.seen - cards looked at, at one X
 * @param {Array} opts.columns - the page's own columns, after Mana
 * @param {boolean} [opts.hasPayback=true]
 */
export function renderXSweep(tableId, { x, recommended, results, maxX, tableMax, hits, seen, columns, hasPayback = true }) {
    const rows = [];
    for (let i = 1; i <= Math.min(maxX, tableMax); i++) {
        const r = results[i];
        if (!r) continue;
        rows.push({ x: i, r, delta: results[i - 1] ? hits(r) - hits(results[i - 1]) : null });
    }
    renderSweepTable(tableId, {
        current: x,
        recommended,
        rows,
        columns: [
            { label: 'X', align: 'left', render: row => `${row.x}` },
            { label: 'Mana', render: row => `${row.r.mana}` },
            ...columns,
            { label: 'Change', render: row => row.delta == null ? '—' : `+${avg(row.delta, 2)}` },
            { label: 'Hit rate', align: 'left', render: row => pBarCell(seen(row.r) ? hits(row.r) / seen(row.r) : 0, 'var(--tx-flat)') },
            {
                label: 'Pays for itself',
                render: row => hasPayback
                    ? `<span style="color:${toneColor(toneFor(row.r.payback.paybackProbability))}">${pct(row.r.payback.paybackProbability)}</span>`
                    : '—'
            }
        ]
    });
}

/**
 * The table behind a "value put into play" dot plot: the exact chance of
 * falling short, of each of `bands` steps above the threshold, and of more.
 * @param {Array<{value:number, p:number}>} pmf - exact value distribution
 * @param {{threshold:number, step:number, bands:number, format?:(v:number) => string}} opts
 */
export function valueBandsTable(pmf, { threshold, step, bands, format = String }) {
    const list = [{ lo: 0, hi: threshold, label: `Under ${format(threshold)} (falls short)` }];
    for (let i = 0; i < bands; i++) {
        const lo = threshold + i * step;
        list.push({ lo, hi: lo + step, label: `${format(lo)} to under ${format(lo + step)}` });
    }
    const top = threshold + bands * step;
    list.push({ lo: top, hi: Infinity, label: `${format(top)} or more` });
    const chance = band => pmf.reduce((s, e) => s + (e.value >= band.lo - 1e-9 && e.value < band.hi - 1e-9 ? e.p : 0), 0);
    return {
        summary: 'Exact chances',
        caption: 'Exact chance of each value range',
        head: ['Value put into play', 'Chance'],
        rows: list.filter(b => b.hi > b.lo).map(b => [escapeHtml(b.label), pct(chance(b))])
    };
}

/** The dot plots' legend: casts that paid for themselves, and casts that fell short. */
export const PAYBACK_LEGEND = Object.freeze([
    { tone: 'good', label: 'paid for itself' },
    { tone: 'bad', label: 'fell short' }
]);

/**
 * The "Value / Permanents" switch over the dots (`#<key>-dots-view`, buttons
 * `[data-dots-view]`): press the view shown, hide the switch without values.
 */
export function syncDotsView(key, view, hasValue) {
    byId(`${key}-dots-view`)?.querySelectorAll?.('[data-dots-view]').forEach(btn => {
        const on = btn.dataset.dotsView === view;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    });
    const toggle = byId(`${key}-dots-view`);
    if (toggle) toggle.hidden = !hasValue;
}

/** A card's small image for the "Cast it" stage: the deck's own printing when it was imported. */
export function castImage(name) {
    const record = findCard(DeckConfig.getImportedCardData()?.cardsByName ?? {}, name);
    return cardImageUrl(record ?? name, 'small');
}

/**
 * Wire a big-spell page's controls; call from registerCalculator's init.
 * @param {string} key
 * @param {Object} handlers
 * @param {Function} handlers.update - the debounced render
 * @param {(x:number) => void} [handlers.setX] - preset chips
 * @param {string[]} [handlers.values] - value-model input ids
 * @param {Function} [handlers.reshuffle] - `<key>-reshuffle-btn`
 * @param {Function} [handlers.cast] - `<key>-cast-btn` (focus returns to it when the cast closes)
 * @param {(view:string) => void} [handlers.dotsView] - `<key>-dots-view` switch
 */
export function bindBigSpellControls(key, { update, setX, values = [], reshuffle, cast, dotsView }) {
    if (setX) bindXPresets(key, setX);
    values.forEach(id => byId(id)?.addEventListener('input', update));
    if (reshuffle) byId(`${key}-reshuffle-btn`)?.addEventListener('click', reshuffle);
    if (cast) {
        byId(`${key}-cast-btn`)?.addEventListener('click', cast);
        byId(`${key}-cast`)?.addEventListener('cast-closed', () => byId(`${key}-cast-btn`)?.focus({ preventScroll: true }));
    }
    if (dotsView) {
        byId(`${key}-dots-view`)?.addEventListener('click', e => {
            const view = e.target.closest?.('[data-dots-view]')?.dataset.dotsView;
            if (view) dotsView(view);
        });
    }
}

// ── How it compares (lazy) ───────────────────────────────────────────────────

const idle = typeof requestIdleCallback === 'function'
    ? cb => requestIdleCallback(cb, { timeout: 600 })
    : cb => setTimeout(cb, 30);

/**
 * Fill the "How it compares" panel. The comparison module (which pulls in all
 * four models) is fetched on demand and computed when the browser is
 * idle; an unchanged comparison is not recomputed.
 *
 * @param {string} containerId
 * @param {{x:number, source:string, deckKey:string, options?:Object}} opts
 */
export function renderHowItCompares(containerId, { x, source, deckKey, options = {} }) {
    const el = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
    if (!el) return;
    const key = `${deckKey}|${x}|${source}|${JSON.stringify(options)}`;
    if (el.dataset.compareKey === key) return;
    el.dataset.compareKey = key;
    import('./bigSpellComparison.js').then(({ compareBigSpells, renderComparison }) => {
        idle(() => {
            const node = document.getElementById(containerId);
            if (!node || node.dataset.compareKey !== key) return; // superseded
            try {
                node.innerHTML = renderComparison(compareBigSpells(x, source, options), { current: source });
            } catch (err) {
                console.error('Big spell comparison failed', err);
                node.innerHTML = '';
            }
        });
    }).catch(err => {
        el.dataset.compareKey = '';
        console.error('Could not load the big spell comparison', err);
    });
}

// ── Styles ───────────────────────────────────────────────────────────────────

/**
 * Add the shared big-spell CSS to the document once, however many of those pages are opened
 * (each view calls this when it loads). A no-op outside a browser.
 * @param {Document} [doc]
 */
export function injectSharedStyles(doc = globalThis.document) {
    if (!doc?.head || doc.querySelector('style[data-owner="big-spells"]')) return;
    const style = doc.createElement('style');
    style.dataset.owner = 'big-spells';
    style.textContent = sharedStyles();
    doc.head.appendChild(style);
}

/**
 * CSS shared by the four big-spell views. Scoped under `.bs-page` (the root
 * of each view's template) rather than a page id, so one copy serves every
 * page: see injectSharedStyles().
 * @param {string} [scope]
 */
export function sharedStyles(scope = '.bs-page') {
    const s = scope;
    return `
${s} .bs-h { margin: 0; font-size: var(--t-body); font-weight: 650; letter-spacing: 0; color: var(--tx-bright); }
/* The family's panels are inset 18px; captions line up with them. */
${s} .tx-caption { padding-inline: 18px; }

/* Rail */
${s} .bs-field { display: grid; gap: 10px; padding: 16px 18px; border-bottom: 1px solid var(--tx-rule); }
${s} .bs-field:last-child { border-bottom: 0; }
${s} .bs-field-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; }
${s} .bs-label { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); letter-spacing: 0; text-transform: none; margin: 0; white-space: nowrap; }
${s} .bs-cost { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-mid); white-space: nowrap; }
${s} .bs-hint { margin: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); }
${s} .bs-hint strong { color: var(--tx-text); font-weight: 600; }
${s} .bs-x { display: flex; align-items: center; gap: 14px; }
${s} .bs-x input[type="range"] { flex: 1; min-width: 0; }
${s} .bs-x-num {
    width: 76px; flex-shrink: 0; padding: 6px 4px; text-align: center;
    font-family: var(--font-mono); font-size: var(--t-xl); font-weight: 650; line-height: 1;
    border-radius: var(--radius-sm); color: var(--tx-bright);
}
${s} .bs-presets { display: flex; flex-wrap: wrap; gap: 6px; }
${s} .bs-chip {
    padding: 4px 11px; border: 1px solid var(--tx-rule-hi); border-radius: var(--radius-full);
    background: transparent; color: var(--tx-mid); font: 500 var(--t-xs)/1.4 var(--font-mono);
    cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}
${s} .bs-chip:hover { color: var(--tx-bright); border-color: var(--tx-dim); }
${s} .bs-chip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--tx-accent); color: var(--tx-accent); }
${s} .bs-check { display: flex; gap: 10px; align-items: flex-start; font-size: var(--t-sm); color: var(--tx-text); cursor: pointer; }
${s} .bs-check input { margin-top: 3px; flex-shrink: 0; }
${s} .bs-value { display: grid; gap: 2px; }
${s} .bs-value-row { display: grid; grid-template-columns: minmax(0, 1fr) 76px; gap: 2px 12px; align-items: center; padding: 6px 0; }
${s} .bs-value-name { font-size: var(--t-sm); color: var(--tx-text); }
${s} .bs-value-row input { width: 76px; text-align: right; border-radius: var(--radius-sm); }
${s} .bs-value-row small { grid-column: 1 / -1; font-size: var(--t-label); color: var(--tx-dim); line-height: 1.4; }

/* Answer */
${s} .bs-answer .tx-hero { justify-content: stretch; border-bottom: 0; }
${s} .bs-answer .tx-hero .tx-stat { border-bottom: 0; }
${s} .bs-notice { margin: 0; padding: 12px 18px; font-size: var(--t-sm); line-height: 1.5; color: var(--tx-text); border-bottom: 1px solid var(--tx-rule); }
${s} .bs-notice.tone-warn { background: var(--warn-soft); }
${s} .bs-notice.tone-flat { background: var(--tx-panel-alt); }

/* Charts */
${s} .bs-chart { position: relative; height: 270px; padding: 14px 14px 4px; }
${s} .bs-legend { display: inline-flex; gap: 14px; align-items: center; flex-wrap: wrap; }
${s} .bs-key { display: inline-flex; align-items: center; gap: 6px; }
${s} .bs-key::before { content: ''; width: 10px; height: 10px; border-radius: 2px; background: var(--key, var(--tx-flat)); }
${s} .bs-key.is-line::before { height: 3px; border-radius: 2px; }
${s} .bs-key.k-accent { --key: var(--tx-accent); }
${s} .bs-key.k-good { --key: var(--tx-good); }
${s} .bs-key.k-flat { --key: var(--tx-flat); }
${s} .bs-key.k-dim { --key: var(--tx-dim); }

/* Samples */
${s} .bs-samples { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; padding: 14px var(--pad-x) 16px; }
${s} .bs-sample { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--tx-rule); border-radius: var(--radius-md); background: var(--tx-panel-alt); overflow: hidden; }
${s} .bs-sample-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--tx-rule); font-size: var(--t-xs); }
${s} .bs-sample-title { color: var(--tx-mid); }
${s} .bs-tag { font-weight: 650; text-align: right; }
${s} .bs-sample.tone-good .bs-tag { color: var(--tx-good); }
${s} .bs-sample.tone-bad .bs-tag { color: var(--tx-bad); }
${s} .bs-sample.tone-good { box-shadow: inset 3px 0 0 var(--tx-good); }
${s} .bs-sample.tone-bad { box-shadow: inset 3px 0 0 var(--tx-bad); }
${s} .bs-cards { list-style: none; margin: 0; padding: 6px 0; }
${s} .bs-card { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 3px 12px; font-size: var(--t-xs); line-height: 1.5; }
${s} .bs-card-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${s} .bs-card .card-ref { color: var(--tx-text); }
${s} .bs-card.is-miss .card-ref { color: var(--tx-dim); text-decoration-color: transparent; }
${s} .bs-card.is-miss .bs-dot { opacity: 0.45; }
${s} .bs-card.is-star { background: var(--good-soft); }
${s} .bs-card.is-star .card-ref { color: var(--tx-bright); font-weight: 600; }
${s} .bs-card-mv { font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-mid); }
${s} .bs-fate { font-size: var(--t-label); color: var(--tx-dim); white-space: nowrap; text-align: right; min-width: 64px; }
${s} .bs-card.is-hit .bs-fate { color: var(--tx-mid); }
${s} .bs-card.is-star .bs-fate { color: var(--tx-good); font-weight: 600; }
${s} .bs-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }
${s} .bs-more { margin: 0; padding: 2px 12px 6px 28px; font-size: var(--t-label); color: var(--tx-dim); }
${s} .bs-sample-foot { margin-top: auto; padding: 8px 12px; border-top: 1px solid var(--tx-rule); font-size: var(--t-xs); line-height: 1.5; color: var(--tx-mid); }
${s} .bs-sample-foot strong { color: var(--tx-bright); font-weight: 600; }

/* Bars */
${s} .bs-bars { list-style: none; margin: 0; padding: 14px 18px; display: grid; gap: 8px; }
${s} .bs-bar-row { display: grid; grid-template-columns: minmax(110px, 1.1fr) minmax(60px, 2fr) 48px; align-items: center; gap: 12px; font-size: var(--t-sm); }
${s} .bs-bar-row.is-current .bs-bar-label { color: var(--tx-bright); font-weight: 600; }
${s} .bs-bar-label { color: var(--tx-mid); }
${s} .bs-bar-note { grid-column: 1 / -1; margin-top: -4px; font-size: var(--t-label); color: var(--tx-dim); }
${s} .bs-bar { height: 8px; border-radius: var(--radius-full); background: var(--tx-rule); overflow: hidden; }
${s} .bs-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--tx-flat); transition: width var(--transition-slow); }
${s} .bs-bar.tone-good > span { background: var(--tx-good); }
${s} .bs-bar.tone-warn > span { background: var(--tx-warn); }
${s} .bs-bar.tone-bad > span { background: var(--tx-bad); }
${s} .bs-bar.tone-accent > span { background: var(--tx-accent); }
${s} .bs-bar-value { font-family: var(--font-mono); font-size: var(--t-xs); text-align: right; color: var(--tx-bright); }

/* Details */
${s} .bs-details > .tx-collapse:first-of-type { border-top: 0; }
${s} .bs-details .tx-collapse-head {
    padding: 13px 18px; font-size: var(--t-sm); font-weight: 600; letter-spacing: 0; text-transform: none;
    color: var(--tx-text); background: transparent;
}
${s} .bs-details .tx-collapse-head::before {
    content: ''; display: inline-block; width: 6px; height: 6px; margin: 0 12px 2px 2px;
    border-right: 1.5px solid var(--tx-dim); border-bottom: 1.5px solid var(--tx-dim);
    transform: rotate(-45deg); transition: transform var(--transition-fast);
}
${s} .bs-details .tx-collapse[open] > .tx-collapse-head::before { content: ''; transform: rotate(45deg); }
${s} .bs-details .tx-collapse-head:hover::before { border-color: var(--tx-accent); }
${s} .bs-details .tx-collapse-head .bs-sub { margin-left: 6px; font-weight: 400; color: var(--tx-dim); }
${s} .bs-details .tx-collapse-body { max-height: none; overflow: visible; padding: 0 0 8px; }
${s} .bs-details .tx-collapse-body > .tx-caption { padding-top: 0; }
${s} .bs-table-wrap { overflow-x: auto; }
${s} .bs-table-wrap .tx-sweep-table td,
${s} .bs-table-wrap .tx-sweep-table th { white-space: nowrap; }

/* How it compares */
${s} .bsc-lead { margin: 0; padding: 14px 18px 4px; font-size: var(--t-sm); line-height: 1.55; color: var(--tx-text); }
${s} .bsc-lead strong { color: var(--tx-bright); }
${s} .bsc-list { list-style: none; margin: 0; padding: 8px 18px 6px; display: grid; }
${s} .bsc-row {
    display: grid; grid-template-columns: minmax(0, 1.5fr) 92px minmax(0, 2.2fr); gap: 4px 16px; align-items: center;
    padding: 9px 0; border-bottom: 1px solid var(--tx-rule); font-size: var(--t-sm);
}
${s} .bsc-row:last-child { border-bottom: 0; }
${s} .bsc-name { min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--tx-text); }
${s} .bsc-name .card-ref { color: inherit; }
${s} .bsc-row.is-current .bsc-name { color: var(--tx-bright); font-weight: 600; }
${s} .bsc-badge { font-size: var(--t-label); font-weight: 500; padding: 1px 7px; border-radius: var(--radius-full); border: 1px solid var(--tx-rule-hi); color: var(--tx-dim); white-space: nowrap; }
${s} .bsc-row.is-current .bsc-badge { border-color: var(--tx-accent); color: var(--tx-accent); }
${s} .bsc-cast { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-mid); white-space: nowrap; }
${s} .bsc-result { display: grid; grid-template-columns: minmax(48px, 2fr) minmax(0, 3fr); gap: 12px; align-items: center; min-width: 0; }
${s} .bsc-result .bs-bar > span { background: var(--tx-flat); }
${s} .bsc-row.is-current .bsc-result .bs-bar > span { background: var(--tx-accent); }
${s} .bsc-value { font-size: var(--t-xs); line-height: 1.4; color: var(--tx-mid); }
${s} .bsc-value strong { font-family: var(--font-mono); font-size: var(--t-sm); color: var(--tx-bright); font-weight: 600; }
${s} .bsc-note { margin: 0; padding: 10px 18px 14px; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); border-top: 1px solid var(--tx-rule); }
${s} .bsc-empty { margin: 0; padding: 16px 18px; font-size: var(--t-sm); color: var(--tx-dim); }

/* "Cast it": one resolution played card by card (js/utils/castAnimation.js) */
${s} .bs-actions { display: inline-flex; flex-wrap: wrap; gap: 8px; }
${s} .bs-cast-stage { padding: 14px 16px 4px; border-bottom: 1px solid var(--tx-rule); container-type: inline-size; }
${s} .cast { display: grid; gap: 12px; }
${s} .cast-top { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 16px; align-items: center; }
${s} .cast-pile { position: relative; display: grid; justify-items: center; gap: 6px; }
${s} .cast-back {
    width: 64px;
    height: 89px;
    border-radius: 6px;
    border: 1px solid var(--tx-rule-hi);
    background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--tx-flat) 22%, transparent) 0 6px, transparent 6px 12px),
        var(--tx-panel-alt);
    box-shadow: 3px 3px 0 -1px var(--tx-panel-alt), 3px 3px 0 0 var(--tx-rule-hi);
}
${s} .cast-left { font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-dim); white-space: nowrap; }
${s} .cast-slot { width: 120px; height: 167px; perspective: 700px; }
${s} .cast-card {
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 6px;
    border: 1px solid var(--tx-rule-hi);
    background: var(--tx-panel-alt);
    color: var(--tx-text);
}
${s} .cast-card img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
}
${s} .cast-card-name {
    padding: 4px;
    font-size: var(--t-label);
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
}
${s} .cast-big { width: 120px; height: 167px; box-shadow: var(--shadow-md); }
${s} .cast-big .cast-card-name { font-size: var(--t-xs); }
${s} .cast-big.is-flip { animation: cast-flip 0.22s var(--ease-out) both; transform-origin: center; }
${s} .cast-big.is-stop { outline: 2px solid var(--tx-bad); outline-offset: 2px; }
${s} .cast-big.is-graveyard { filter: saturate(0.5); }
${s} .cast-read { display: grid; gap: 10px; min-width: 0; align-content: center; }
${s} .cast-status {
    margin: 0;
    min-height: 3em;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--tx-text);
}
${s} .cast-status strong { color: var(--tx-bright); font-weight: 600; }
${s} .cast-totals { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 0; }
${s} .cast-totals dd {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: var(--t-lg);
    font-weight: 600;
    color: var(--tx-bright);
}
${s} .cast-totals dd small { font-size: var(--t-xs); font-weight: 400; color: var(--tx-dim); }
${s} .cast-totals dd.tone-good { color: var(--tx-good); }
${s} .cast-zone { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; align-items: start; }
${s} .cast-zone-label { padding-top: 6px; }
${s} .cast-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-height: 61px;
    padding: 0;
}
${s} .cast-mini { width: 44px; height: 61px; border-radius: 3px; }
${s} .cast-mini .cast-card-name { font-size: 7.5px; padding: 2px; }
${s} .cast-mini.is-new { animation: cast-land 0.2s var(--ease-out) both; }
${s} .cast-mini.is-stop { outline: 2px solid var(--tx-bad); outline-offset: 1px; }
${s} .cast-mini.is-graveyard { opacity: 0.55; filter: grayscale(0.6); }
${s} .cast-more {
    align-self: center;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
${s} .cast-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-bottom: 10px; }
${s} .cast[data-state="done"] .cast-status { color: var(--tx-bright); }
@keyframes cast-flip {
    from { transform: rotateY(90deg) translateX(-24px); opacity: 0.4; }
    to { transform: none; opacity: 1; }
}
@keyframes cast-land {
    from { transform: translateY(-16px) scale(1.25); opacity: 0; }
    to { transform: none; opacity: 1; }
}
@container (max-width: 520px) {
    ${s} .cast-top { grid-template-columns: auto minmax(0, 1fr); }
    ${s} .cast-pile { display: none; }
    ${s} .cast-slot, ${s} .cast-big { width: 92px; height: 128px; }
    ${s} .cast-zone { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    ${s} .cast-zone-label { padding-top: 0; }
    ${s} .cast-row { min-height: 51px; }
    ${s} .cast-mini { width: 36px; height: 50px; }
}
@media (prefers-reduced-motion: reduce) {
    ${s} .cast-big.is-flip, ${s} .cast-mini.is-new { animation: none; }
}

/* Narrow: lead with the answer, then the controls */
@container shell (max-width: 1039.98px) {
    ${s} .bs-answer { order: -1; }
}
@container shell (max-width: 560px) {
    ${s} .bs-samples { grid-template-columns: minmax(0, 1fr); }
    ${s} .bsc-row { grid-template-columns: minmax(0, 1fr) auto; }
    ${s} .bsc-result { grid-column: 1 / -1; }
    ${s} .bs-bar-row { grid-template-columns: minmax(92px, 1fr) minmax(48px, 1.4fr) 44px; gap: 10px; }
    ${s} .bs-chart { height: 230px; padding-inline: 8px; }
    ${s} .bs-field { padding: 14px var(--pad-x); }
}
`;
}
