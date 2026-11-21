/**
 * Sidebar navigation, breadcrumbs, the deck switcher button, and the mobile
 * drawer. Rendered once from the registry; navigation only toggles classes.
 */

import { CALCULATORS, GROUPS, getGroup } from '../utils/calculatorRegistry.js';
import { CARD_META } from '../data/cards.js';
import { escapeHtml } from '../data/glossary.js';
import { cardImageUrl } from '../data/images.js';
import { onNavigate } from './router.js';

export function renderNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    nav.innerHTML = GROUPS.map(group => {
        const items = Object.entries(CALCULATORS).filter(([, c]) => c.group === group.key);
        if (items.length === 0) return '';
        return `
            <div class="nav-group" data-nav-group="${group.key}">
                <div class="nav-group-label" id="nav-group-${group.key}">${escapeHtml(group.label)}</div>
                <ul class="nav-list" aria-labelledby="nav-group-${group.key}">
                    ${items.map(([key, c]) => `
                        <li>
                            <a class="nav-item" href="?tab=${key}" data-tab-link="${key}" data-tab="${key}">
                                <span class="nav-code" aria-hidden="true">${escapeHtml(c.short)}</span>
                                <span class="nav-name">${escapeHtml(c.name)}</span>
                                <span class="nav-mark" hidden></span>
                            </a>
                        </li>`).join('')}
                </ul>
            </div>`;
    }).join('');
}

function setActive(name) {
    document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
        const active = el.dataset.tab === name;
        el.classList.toggle('active', active);
        if (active) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
    });
    const entry = CALCULATORS[name];
    const crumbGroup = document.getElementById('crumb-group');
    const crumbPage = document.getElementById('crumb-page');
    if (crumbGroup) crumbGroup.textContent = getGroup(entry?.group)?.label ?? '';
    if (crumbPage) crumbPage.textContent = entry?.name ?? '';
}

/**
 * Mark calculators relevant to the current deck. `ranked` is deckRadar's
 * analyzeDeck() output; only "the card is in your deck" and strong structural
 * matches get a mark, otherwise everything lights up and the signal is lost.
 */
export function markRelevance(ranked = []) {
    const byTab = new Map(ranked.map(r => [r.tab, r]));
    document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
        const match = byTab.get(el.dataset.tab);
        const mark = el.querySelector('.nav-mark');
        const level = match?.hasCard ? 'core' : match?.tier === 'likely' ? 'likely' : null;
        el.classList.toggle('is-relevant', level === 'core');
        el.classList.toggle('is-maybe', level === 'likely');
        if (!mark) return;
        mark.hidden = !level;
        if (level) {
            mark.className = `nav-mark nav-mark-${level}`;
            mark.title = match.reasons?.[0] ?? '';
            mark.setAttribute('aria-label', level === 'core' ? 'In your deck' : 'Fits your deck');
        }
    });
}

/**
 * Deck switcher button in the sidebar: name, size, format, commander art.
 * `nameTitle` / `metaTitle` are the hover text (the commanders, and how the
 * card count splits between library and command zone).
 */
export function renderDeckSwitcher({ name, meta, artName, artCard, nameTitle, metaTitle }) {
    const nameEl = document.getElementById('deck-switcher-name');
    const metaEl = document.getElementById('deck-switcher-meta');
    const artEl = document.getElementById('deck-switcher-art');
    if (nameEl) {
        nameEl.textContent = name;
        nameEl.title = nameTitle || name;
    }
    if (metaEl) {
        metaEl.textContent = meta;
        if (metaTitle) metaEl.title = metaTitle;
        else metaEl.removeAttribute('title');
    }
    if (artEl) {
        const known = artName && CARD_META[artName]?.art;
        const url = known || (artName ? cardImageUrl(artCard ?? artName, 'art_crop') : '');
        artEl.style.backgroundImage = url ? `url("${url}")` : '';
        artEl.classList.toggle('empty', !url);
    }
}

function setDrawer(open) {
    document.body.classList.toggle('nav-open', open);
    const scrim = document.getElementById('scrim');
    if (scrim) scrim.hidden = !open;
    document.getElementById('nav-toggle')?.setAttribute('aria-expanded', String(open));
    if (open) document.querySelector('.nav-item.active, .nav-item')?.focus({ preventScroll: true });
}

export function initSidebar() {
    renderNav();
    onNavigate(name => {
        setActive(name);
        setDrawer(false);
    });
    document.getElementById('nav-toggle')?.addEventListener('click', () => setDrawer(!document.body.classList.contains('nav-open')));
    document.getElementById('sidebar-close')?.addEventListener('click', () => setDrawer(false));
    document.getElementById('scrim')?.addEventListener('click', () => setDrawer(false));
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setDrawer(false);
    });
}
