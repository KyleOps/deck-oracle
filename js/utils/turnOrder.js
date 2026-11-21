/**
 * The play/draw toggle — one control for every page whose answer depends on
 * who goes first: Overview, Draw Odds, Mana Base, Opening Hands, Mulligan
 * Planner, Land Drops and Mana Development.
 *
 * Each page keeps its own choice and its own share-link parameter (`draw`,
 * `hdraw`, `mullDraw`, `ldDraw`, `mddraw` — links already shared keep
 * working). What is the same everywhere lives here:
 *   - the rule: when everyone draws on turn one (multiplayer Commander), turn
 *     order changes nothing, so the maths uses "on the play" and the control
 *     is hidden — an input must change the answer for the deck as built;
 *   - the markup: `[data-turn-order]` around two `[data-play]` buttons;
 *   - keeping the buttons in step with the choice, and reading a click.
 *
 * Nothing here touches the DOM at import time, so it loads in plain Node.
 */

/**
 * Does turn order change anything in this format?
 * @param {{firstPlayerDraws?:boolean}|null|undefined} format
 * @returns {boolean}
 */
export function turnOrderMatters(format) {
    return !format?.firstPlayerDraws;
}

/**
 * The turn order the maths should use: the page's choice, or "on the play"
 * when the format makes the choice irrelevant.
 * @param {boolean} onPlay - the page's choice (anything but `false` is on the play)
 * @param {{firstPlayerDraws?:boolean}|null|undefined} format
 * @returns {boolean}
 */
export function effectiveOnPlay(onPlay, format) {
    return turnOrderMatters(format) ? onPlay !== false : true;
}

function buttonsHTML(onPlay) {
    return [[true, 'On the play'], [false, 'On the draw']].map(([play, text]) => {
        const on = play === (onPlay !== false);
        return `<button class="seg-btn${on ? ' active' : ''}" type="button" data-play="${play ? 1 : 0}" aria-pressed="${on}">${text}</button>`;
    }).join('');
}

/**
 * The toggle's markup. Without a label it is the button group alone (named
 * "Turn order" for screen readers); with one it is a field — a visible label,
 * the buttons and an optional hint — and the whole field hides with it.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.onPlay=true] - which button starts pressed
 * @param {boolean} [opts.hidden=false] - start hidden (a page that doesn't know its format yet)
 * @param {string} [opts.id] - id of the outermost element
 * @param {string} [opts.className] - extra classes for the outermost element
 * @param {string} [opts.label] - visible label (makes it a field)
 * @param {string} [opts.hint] - one line under the buttons (fields only)
 * @returns {string}
 */
export function turnOrderHTML({ onPlay = true, hidden = false, id = '', className = '', label = '', hint = '' } = {}) {
    const idAttr = id ? ` id="${id}"` : '';
    const hiddenAttr = hidden ? ' hidden' : '';
    if (!label) {
        return `<div class="seg seg-sm${className ? ` ${className}` : ''}"${idAttr} role="group" aria-label="Turn order" data-turn-order${hiddenAttr}>${buttonsHTML(onPlay)}</div>`;
    }
    const labelId = `${id || 'turn-order'}-label`;
    return `<div${className ? ` class="${className}"` : ''}${idAttr} data-turn-order${hiddenAttr}>
        <span class="field-label" id="${labelId}">${label}</span>
        <div class="seg seg-sm" role="group" aria-labelledby="${labelId}">${buttonsHTML(onPlay)}</div>${hint ? `
        <p class="field-hint">${hint}</p>` : ''}
    </div>`;
}

/**
 * Bring the turn-order controls inside `root` (or `root` itself) in line with
 * the page: hidden when turn order doesn't matter, the chosen button pressed.
 * @param {ParentNode|Element|null} root
 * @param {boolean} onPlay - the page's own choice
 * @param {{firstPlayerDraws?:boolean}|null|undefined} format
 */
export function syncTurnOrder(root, onPlay, format) {
    if (!root) return;
    const groups = root.matches?.('[data-turn-order]') ? [root] : [...(root.querySelectorAll?.('[data-turn-order]') ?? [])];
    const hidden = !turnOrderMatters(format);
    for (const group of groups) {
        if (group.hidden !== hidden) group.hidden = hidden;
        for (const btn of group.querySelectorAll?.('[data-play]') ?? []) {
            const on = (btn.dataset.play === '1') === (onPlay !== false);
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', String(on));
        }
    }
}

/**
 * What a click on the page chose: `true` (on the play), `false` (on the
 * draw), or `null` when it was not on a turn-order button. Pages call this
 * first in their own delegated click handler.
 * @param {Event} event
 * @returns {boolean|null}
 */
export function turnOrderClicked(event) {
    const btn = event?.target?.closest?.('[data-turn-order] [data-play]');
    return btn ? btn.dataset.play === '1' : null;
}
