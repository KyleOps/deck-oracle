/**
 * Floating layers shared by every page: tooltips, glossary definitions, card
 * image previews and toasts.
 *
 * All three hover layers are driven by ONE delegated listener set on the
 * document, so calculators only emit attributes (`data-tip`, `data-term`,
 * `data-card`) in their HTML — no per-element wiring, nothing to clean up when
 * a page re-renders.
 */

import { GLOSSARY, escapeHtml } from '../data/glossary.js';
import { cardImageUrl, findCard } from '../data/images.js';
import { getImportedCardData } from '../utils/deckConfig.js';

/** Prefer the deck's own record (direct CDN URL) over a by-name lookup. */
const previewUrl = name => cardImageUrl(findCard(getImportedCardData().cardsByName, name) ?? name, 'normal');

let tooltipEl;
let previewEl;
let previewImg;
let activeTarget = null;
let showTimer = 0;

function position(el, target, { gap = 8, prefer = 'top' } = {}) {
    const r = target.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    el.style.left = '0px';
    el.style.top = '0px';
    const box = el.getBoundingClientRect();
    let top = prefer === 'top' ? r.top - box.height - gap : r.bottom + gap;
    if (top < 8) top = r.bottom + gap;
    if (top + box.height > vh - 8) top = Math.max(8, r.top - box.height - gap);
    let left = r.left + r.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(left, vw - box.width - 8));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
}

function positionPreview(target) {
    const r = target.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = 244;
    const h = 340;
    let left = r.right + 12;
    if (left + w > vw - 8) left = r.left - w - 12;
    if (left < 8) left = Math.max(8, Math.min(vw - w - 8, r.left));
    let top = r.top + r.height / 2 - h / 2;
    top = Math.max(8, Math.min(top, vh - h - 8));
    previewEl.style.left = `${Math.round(left)}px`;
    previewEl.style.top = `${Math.round(top)}px`;
}

function tipContent(target) {
    const termKey = target.dataset.term;
    if (termKey && GLOSSARY[termKey]) {
        const g = GLOSSARY[termKey];
        return `<strong>${escapeHtml(g.term)}</strong><span>${escapeHtml(g.def)}</span>`;
    }
    const tip = target.dataset.tip;
    return tip ? escapeHtml(tip) : '';
}

function show(target) {
    if (target.dataset.card) {
        const name = target.dataset.card;
        if (previewImg.dataset.name !== name) {
            previewEl.classList.remove('loaded');
            previewImg.dataset.name = name;
            previewImg.alt = name;
            previewImg.src = previewUrl(name);
        }
        previewEl.hidden = false;
        positionPreview(target);
        return;
    }
    const html = tipContent(target);
    if (!html) return;
    tooltipEl.innerHTML = html;
    tooltipEl.classList.toggle('tooltip-rich', Boolean(target.dataset.term));
    tooltipEl.hidden = false;
    position(tooltipEl, target);
    target.setAttribute('aria-describedby', 'tooltip');
}

function hide() {
    clearTimeout(showTimer);
    if (activeTarget) activeTarget.removeAttribute('aria-describedby');
    activeTarget = null;
    if (tooltipEl) tooltipEl.hidden = true;
    if (previewEl) previewEl.hidden = true;
}

function targetFrom(node) {
    return node?.closest?.('[data-tip], [data-term], [data-card]') ?? null;
}

function onEnter(e) {
    const target = targetFrom(e.target);
    if (!target || target === activeTarget) return;
    hide();
    activeTarget = target;
    // Small delay on hover so sweeping the pointer across a table doesn't
    // strobe tooltips; focus shows immediately.
    const delay = e.type === 'focusin' ? 0 : (target.dataset.card ? 180 : 320);
    showTimer = setTimeout(() => { if (activeTarget === target) show(target); }, delay);
}

function onLeave(e) {
    const target = targetFrom(e.target);
    if (!target || target !== activeTarget) return;
    if (e.relatedTarget && target.contains(e.relatedTarget)) return;
    hide();
}

export function initOverlays() {
    tooltipEl = document.getElementById('tooltip');
    previewEl = document.getElementById('card-preview');
    previewImg = previewEl?.querySelector('img');
    if (!tooltipEl || !previewEl || !previewImg) return;

    previewImg.addEventListener('load', () => previewEl.classList.add('loaded'));
    previewImg.addEventListener('error', () => { previewEl.hidden = true; });

    document.addEventListener('mouseover', onEnter);
    document.addEventListener('mouseout', onLeave);
    document.addEventListener('focusin', onEnter);
    document.addEventListener('focusout', onLeave);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    // Touch: a tap on a term toggles its definition instead of doing nothing.
    const touchPrimary = window.matchMedia?.('(hover: none)').matches;
    document.addEventListener('click', e => {
        if (!touchPrimary) return;
        const target = targetFrom(e.target);
        if (!target || !(target.dataset.term || target.dataset.card)) return;
        if (activeTarget === target && (!tooltipEl.hidden || !previewEl.hidden)) { hide(); return; }
        hide();
        activeTarget = target;
        show(target);
    });
}

// ── Toasts ───────────────────────────────────────────────────────────────────

/**
 * Show a short-lived notification.
 * @param {string} message - plain text
 * @param {{tone?:'info'|'good'|'bad', timeout?:number, action?:{label:string, run:Function}}} [opts]
 */
export function toast(message, { tone = 'info', timeout = 3600, action } = {}) {
    const region = document.getElementById('toasts');
    if (!region) return;
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span class="toast-msg">${escapeHtml(message)}</span>`;
    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => { action.run(); dismiss(); });
        el.appendChild(btn);
    }
    region.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    let timer = setTimeout(dismiss, timeout);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1600); });
    function dismiss() {
        clearTimeout(timer);
        el.classList.remove('in');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 400);
    }
}
