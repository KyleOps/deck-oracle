/**
 * "Cast it": one sample resolution of a reveal spell, played card by card.
 *
 * Primal Surge and Genesis Wave are easy to misread from numbers alone —
 * Surge keeps going until the FIRST instant or sorcery, Wave looks at exactly
 * X cards and keeps only cheap permanents. Watching one real shuffle resolve,
 * with a line saying why each card went where it did, teaches the rule the
 * averages are built on.
 *
 * The page supplies the plan (pure, tested: which card goes where and the
 * running totals); this module only plays it. Under three seconds, skippable,
 * driven by real buttons, and instant under prefers-reduced-motion. Card
 * images come from Scryfall; until one loads (or offline) the card shows its
 * name, so nothing waits on the network.
 */

import { escapeHtml } from '../data/glossary.js';

/** Longest a cast may take, and the slowest/fastest a single card plays. */
export const CAST_BUDGET_MS = 2400;
const STEP_MAX = 420;
const STEP_MIN = 80;
/** Cards drawn in the battlefield/graveyard rows before "+N more". */
const ROW_CAP = 36;

/**
 * Timing for a cast of `n` cards: how long each animated card takes, and how
 * many are animated before the rest land at once. Always within the budget.
 * @param {number} n
 * @returns {{step:number, animated:number, total:number}}
 */
export function castTiming(n) {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    if (count === 0) return { step: 0, animated: 0, total: 0 };
    const step = Math.round(Math.min(STEP_MAX, Math.max(STEP_MIN, CAST_BUDGET_MS / count)));
    const animated = Math.min(count, Math.floor(CAST_BUDGET_MS / step));
    return { step, animated, total: step * animated };
}

const reduceMotion = () => typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function cardHtml(step, imageFor, cls) {
    const url = imageFor?.(step.name) ?? '';
    return `<span class="cast-card ${cls} is-${step.fate}" title="${escapeHtml(step.name)}">
        <span class="cast-card-name">${escapeHtml(step.name)}</span>
        ${url ? `<img src="${escapeHtml(url)}" alt="" decoding="async">` : ''}
    </span>`;
}

/** Start loading image URLs; resolves when the first has loaded (or failed). */
function preload(urls) {
    if (typeof Image === 'undefined' || urls.length === 0) return null;
    const unique = [...new Set(urls)];
    const loads = unique.map(url => new Promise(resolve => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = img.onerror = () => resolve();
        img.src = url;
    }));
    return loads[0];
}

function dropBrokenImages(root) {
    root.querySelectorAll('img:not([data-watched])').forEach(img => {
        img.dataset.watched = '1';
        img.addEventListener('error', () => img.remove(), { once: true });
    });
}

/**
 * Play a planned cast into `root` (replacing what is there).
 *
 * @param {HTMLElement} root
 * @param {Object} plan
 * @param {Array<{name:string, fate:'battlefield'|'graveyard'|'stop', note:string, totals:Array<{label:string, value:string, tone?:string}>}>} plan.steps
 * @param {string} plan.outLabel - the second row's name ("Graveyard", "Stopped by")
 * @param {number} plan.librarySize - cards in the library before the cast
 * @param {Array<{label:string, value:string, tone?:string}>} plan.startTotals
 * @param {string} plan.summary - the sentence shown (and announced) at the end
 * @param {(name:string) => string} [plan.imageFor] - small card image URL
 * @param {() => void} [onReplay]
 * @returns {{skip:() => void}}
 */
export function playCast(root, plan, onReplay) {
    if (!root) return { skip() {} };
    root._castStop?.();
    const steps = plan.steps ?? [];
    const timing = castTiming(steps.length);
    const instant = reduceMotion();

    root.hidden = false;
    root.innerHTML = `
        <div class="cast" data-state="playing">
            <div class="cast-top">
                <div class="cast-pile" aria-hidden="true"><span class="cast-back"></span><span class="cast-left"></span></div>
                <div class="cast-slot" aria-hidden="true"></div>
                <div class="cast-read">
                    <p class="cast-status"></p>
                    <dl class="cast-totals"></dl>
                </div>
            </div>
            <div class="cast-zone"><span class="cast-zone-label">Battlefield</span><div class="cast-row" data-zone="battlefield"></div></div>
            <div class="cast-zone is-out"><span class="cast-zone-label">${escapeHtml(plan.outLabel ?? 'Graveyard')}</span><div class="cast-row" data-zone="out"></div></div>
            <div class="cast-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-cast="skip">Skip to the end</button>
                <button type="button" class="btn btn-ghost btn-sm" data-cast="again" hidden>Cast again</button>
                <button type="button" class="btn btn-ghost btn-sm" data-cast="close">Close</button>
                <p class="sr-only" aria-live="polite" data-cast="live"></p>
            </div>
        </div>`;
    const q = sel => root.querySelector(sel);
    const stage = q('.cast');
    const slot = q('.cast-slot');
    const status = q('.cast-status');
    const totals = q('.cast-totals');
    const left = q('.cast-left');
    const rows = { battlefield: q('[data-zone="battlefield"]'), out: q('[data-zone="out"]') };
    const placed = { battlefield: 0, out: 0 };

    const setTotals = list => {
        totals.innerHTML = (list ?? []).map(t => `<div><dt>${escapeHtml(t.label)}</dt><dd class="${t.tone ? `tone-${t.tone}` : ''}">${t.value}</dd></div>`).join('');
    };
    const setLeft = n => { left.textContent = `${Math.max(0, n)} left`; };
    const place = (step, animate) => {
        const zone = step.fate === 'battlefield' ? 'battlefield' : 'out';
        placed[zone] += 1;
        if (placed[zone] > ROW_CAP) {
            let more = rows[zone].querySelector('.cast-more');
            if (!more) {
                rows[zone].insertAdjacentHTML('beforeend', '<span class="cast-more"></span>');
                more = rows[zone].querySelector('.cast-more');
            }
            more.textContent = `+${placed[zone] - ROW_CAP} more`;
            return;
        }
        rows[zone].insertAdjacentHTML('beforeend', cardHtml(step, plan.imageFor, `cast-mini${animate ? ' is-new' : ''}`));
    };

    let timer = 0;
    let done = false;
    let shown = 0;
    const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Land everything not yet placed, then show the result.
        for (let i = shown; i < steps.length; i++) place(steps[i], false);
        shown = steps.length;
        const last = steps[steps.length - 1];
        slot.innerHTML = last ? cardHtml(last, plan.imageFor, 'cast-big') : '';
        setLeft((plan.librarySize ?? 0) - steps.length);
        setTotals(last?.totals ?? plan.startTotals);
        status.innerHTML = plan.summary ?? '';
        q('[data-cast="live"]').textContent = status.textContent;
        stage.dataset.state = 'done';
        q('[data-cast="skip"]').hidden = true;
        q('[data-cast="again"]').hidden = false;
        dropBrokenImages(root);
    };

    const tick = () => {
        if (done) return;
        if (shown >= timing.animated) { finish(); return; }
        const step = steps[shown];
        slot.innerHTML = cardHtml(step, plan.imageFor, 'cast-big is-flip');
        status.innerHTML = `<strong>${escapeHtml(step.name)}</strong> — ${step.note}`;
        setLeft((plan.librarySize ?? 0) - shown - 1);
        shown += 1;
        dropBrokenImages(root);
        // The card lands in its row half-way through its turn.
        timer = setTimeout(() => {
            if (done) return;
            place(step, true);
            setTotals(step.totals);
            timer = setTimeout(tick, Math.round(timing.step * 0.45));
        }, Math.round(timing.step * 0.55));
    };

    root._castStop = () => { done = true; clearTimeout(timer); };
    root.onclick = e => {
        const action = e.target.closest('[data-cast]')?.dataset.cast;
        if (action === 'skip') {
            finish();
            q('[data-cast="again"]')?.focus({ preventScroll: true });
        } else if (action === 'again') {
            onReplay?.();
        } else if (action === 'close') {
            root._castStop?.();
            root.hidden = true;
            root.innerHTML = '';
            root.dispatchEvent(new CustomEvent('cast-closed', { bubbles: true }));
        }
    };

    setTotals(plan.startTotals);
    setLeft(plan.librarySize ?? 0);
    status.textContent = 'Shuffling…';
    if (instant || steps.length === 0) {
        finish();
    } else {
        // Fetch the images up front; start as soon as the first card has
        // arrived (or after a short grace period — names show until then).
        const first = preload(steps.slice(0, timing.animated).map(st => plan.imageFor?.(st.name)).filter(Boolean));
        let started = false;
        const start = () => { if (!started && !done) { started = true; tick(); } };
        first?.then(start);
        timer = setTimeout(start, 360);
    }
    return { skip: finish };
}
