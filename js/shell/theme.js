/**
 * Light / dark theme.
 *
 * The <head> script applies the saved (or system) theme before first paint;
 * this module handles toggling, persistence, and re-theming the charts.
 */

import { applyChartTheme } from '../utils/chartHelpers.js';

const KEY = 'deckOracle.theme';
const listeners = [];

export function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Register a callback run after the theme changes (e.g. re-render charts). */
export function onThemeChange(cb) {
    listeners.push(cb);
}

function syncToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    btn.setAttribute('aria-label', `Switch to ${next} theme`);
    const meta = document.querySelectorAll('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--tx-bg').trim();
    meta.forEach(m => { m.removeAttribute('media'); m.setAttribute('content', bg); });
}

export function setTheme(theme, { persist = true } = {}) {
    const value = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = value;
    if (persist) {
        try { localStorage.setItem(KEY, value); } catch { /* storage blocked */ }
    }
    applyChartTheme();
    syncToggle();
    listeners.forEach(cb => {
        try { cb(value); } catch (err) { console.error('Theme listener failed:', err); }
    });
}

export function toggleTheme() {
    // Brief cross-fade instead of a hard flash, skipped for reduced motion.
    const root = document.documentElement;
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        root.classList.add('theme-fade');
        setTimeout(() => root.classList.remove('theme-fade'), 320);
    }
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
    syncToggle();
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    // Follow the OS when the user hasn't chosen explicitly.
    window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', e => {
        let saved = null;
        try { saved = localStorage.getItem(KEY); } catch { /* blocked */ }
        if (!saved) setTheme(e.matches ? 'light' : 'dark', { persist: false });
    });
}
