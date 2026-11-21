/**
 * The standard page header every calculator opens with, and the "How it works"
 * guide drawer.
 *
 * One header for every page means every calculator answers the same three
 * questions in the same place before any numbers appear: what card is this,
 * what does it do, and what question is this page answering.
 */

import { CALCULATORS, getGroup } from '../utils/calculatorRegistry.js';
import { CARD_META } from '../data/cards.js';
import { GLOSSARY, escapeHtml } from '../data/glossary.js';
import { renderManaCost } from '../utils/mana.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { normalizeCardName } from '../utils/deckRadar.js';

const METHOD_TEXT = {
    'exact': { label: 'Exact odds', term: 'exact' },
    'simulation': { label: 'Simulated', term: 'simulation' },
    'exact + simulation': { label: 'Exact odds + simulation', term: 'exact' },
    'deck search': { label: 'Read straight from your list', term: null }
};

/**
 * Does the current deck contain this calculator's card — in the library, or
 * as any of its commanders?
 * @returns {true|false|null} null when the calculator isn't about one card
 */
export function deckHasCard(name) {
    const entry = CALCULATORS[name];
    if (!entry?.cardInDeck || !entry.card) return null;
    const target = normalizeCardName(entry.card);
    if (DeckConfig.getCommanderNames().some(n => normalizeCardName(n) === target)) return true;
    return Object.values(DeckConfig.getImportedCardData().cardsByName ?? {}).some(c =>
        Number(c?.count) > 0 && normalizeCardName(c.name) === target);
}

function deckBadge(name) {
    const has = deckHasCard(name);
    if (has === null) return '';
    return has
        ? '<span class="chip chip-good" data-deck-badge><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>In this deck</span>'
        : '<span class="chip" data-deck-badge data-tip="Results use this deck as if it ran the card">Not in this deck</span>';
}

export function renderPageHeader(name) {
    const entry = CALCULATORS[name];
    if (!entry || entry.header === false) return '';
    const card = entry.card ? CARD_META[entry.card] : null;
    const group = getGroup(entry.group);
    const method = METHOD_TEXT[entry.method] ?? null;
    const showRules = Boolean(entry.cardInDeck && card?.text);
    const art = card?.art
        ? `<div class="page-head-art" style="background-image:url('${card.art}')" role="img" aria-label="${escapeHtml(card.name)} art${card.artist ? ` by ${escapeHtml(card.artist)}` : ''}"></div>`
        : '';

    return `
        <header class="page-head${art ? ' has-art' : ''}">
            ${art}
            <div class="page-head-body">
                <div class="page-eyebrow">
                    <span>${escapeHtml(group?.label ?? '')}</span>
                    ${method ? `<span class="dot-sep" aria-hidden="true"></span><span ${method.term ? `class="term" data-term="${method.term}" tabindex="0"` : ''}>${method.label}</span>` : ''}
                </div>
                <h1 class="page-title">
                    <span>${escapeHtml(entry.name)}</span>
                    ${entry.cardInDeck && card?.cost ? renderManaCost(card.cost) : ''}
                </h1>
                <p class="page-question">${escapeHtml(entry.question)}</p>
                ${showRules ? `
                    <details class="rules-text">
                        <summary><span class="card-ref" data-card="${escapeHtml(card.name)}">${escapeHtml(card.type)}</span> · card text</summary>
                        <blockquote>${escapeHtml(card.text).replace(/\n/g, '<br>')}</blockquote>
                    </details>` : `<p class="page-summary">${escapeHtml(entry.summary)}</p>`}
                <div class="page-actions">
                    <span class="page-deck-badge" data-deck-badge-slot>${deckBadge(name)}</span>
                    <button class="btn btn-ghost btn-sm" type="button" data-open-guide="${name}">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/></svg>
                        How it works
                    </button>
                </div>
            </div>
        </header>`;
}

/** Update the parts of a mounted header that depend on the deck. */
export function refreshPageHeader(name) {
    const slot = document.querySelector(`#${name}-tab [data-deck-badge-slot]`);
    if (slot) slot.innerHTML = deckBadge(name);
}

// ── Guide drawer ─────────────────────────────────────────────────────────────

let lastFocus = null;

function list(items) {
    if (!Array.isArray(items) || items.length === 0) return '';
    return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
}

const GENERIC_METHOD = {
    'exact': 'Every number on this page is calculated directly from your card counts with the hypergeometric formula — the maths of drawing without replacement. There is no randomness: the same deck always gives the same answer.',
    'simulation': 'This card’s outcome depends on a long chain of random reveals, so the page shuffles your real decklist hundreds or thousands of times, resolves the card each time, and reports what happened. Run counts are shown; more runs mean steadier numbers.',
    'exact + simulation': 'Headline odds are calculated exactly from your card counts. The sample runs and distributions come from shuffling your real decklist and resolving the card many times, so you can see the spread behind the average.',
    'deck search': 'Nothing here is random: the card searches your library, so every number is read straight off your decklist.'
};

/**
 * Build guide HTML from a calculator's `guide` export (if any) plus registry
 * metadata, so every page has a guide even before it has written one.
 */
function guideHtml(name, guide = {}) {
    const entry = CALCULATORS[name];
    const terms = (guide.terms ?? []).filter(k => GLOSSARY[k]);
    return `
        <section class="guide-block">
            <h3>The question</h3>
            <p class="guide-lead">${escapeHtml(entry.question)}</p>
            <p>${guide.intro ?? escapeHtml(entry.summary)}</p>
        </section>
        ${guide.howToRead?.length ? `<section class="guide-block"><h3>How to read it</h3>${list(guide.howToRead)}</section>` : ''}
        <section class="guide-block">
            <h3>How it’s calculated</h3>
            <p>${guide.method ?? GENERIC_METHOD[entry.method] ?? ''}</p>
        </section>
        ${guide.assumptions?.length ? `<section class="guide-block"><h3>Assumptions</h3>${list(guide.assumptions)}</section>` : ''}
        ${guide.tips?.length ? `<section class="guide-block"><h3>Deck-building tips</h3>${list(guide.tips)}</section>` : ''}
        ${terms.length ? `<section class="guide-block"><h3>Terms</h3><dl class="guide-terms">${terms.map(k => `<div><dt>${escapeHtml(GLOSSARY[k].term)}</dt><dd>${escapeHtml(GLOSSARY[k].def)}</dd></div>`).join('')}</dl></section>` : ''}`;
}

export async function openGuide(name) {
    const drawer = document.getElementById('guide-drawer');
    const body = document.getElementById('guide-body');
    const title = document.getElementById('guide-title');
    const entry = CALCULATORS[name];
    if (!drawer || !body || !entry) return;

    let guide = {};
    try {
        const view = await entry.view();
        guide = view.guide ?? {};
    } catch {
        // fall back to registry metadata
    }
    title.textContent = entry.name;
    body.innerHTML = guideHtml(name, guide);
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.body.classList.add('drawer-open');
    requestAnimationFrame(() => drawer.classList.add('open'));
    document.getElementById('guide-close')?.focus();
}

export function closeGuide() {
    const drawer = document.getElementById('guide-drawer');
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('open');
    document.body.classList.remove('drawer-open');
    setTimeout(() => { drawer.hidden = true; }, 220);
    if (lastFocus?.focus) lastFocus.focus();
}

export function isGuideOpen() {
    return !document.getElementById('guide-drawer')?.hidden;
}

export function initGuide() {
    document.addEventListener('click', e => {
        const btn = e.target.closest?.('[data-open-guide]');
        if (btn) openGuide(btn.dataset.openGuide);
    });
    document.getElementById('guide-close')?.addEventListener('click', closeGuide);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isGuideOpen()) closeGuide();
    });
}
