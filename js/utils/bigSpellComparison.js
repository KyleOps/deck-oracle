/**
 * How the four big spells compare for one deck at the same total mana:
 * Genesis Wave, Kamahl's Druidic Vow, Primal Surge and Portent of Calamity.
 *
 * Everything here is DOM-free. It reads the deck from DeckConfig (or from
 * explicit options) and calls each spell's model (js/utils/models/), never a
 * page, so it is safe to run from any page — including before the other three
 * pages have ever been opened, when their inputs don't exist.
 */

import * as DeckConfig from './deckConfig.js';
import { simulateGenesisWave } from './models/wave.js';
import { simulateVow, commanderCopiesVow } from './models/vow.js';
import { simulatePrimalSurge } from './models/surge.js';
import { portentOutcomes } from './models/portent.js';
import { deckCardList, listSize } from './models/cardList.js';
import { commanderNamesOf, frontTypeLine, isLand, isPermanent, sameCard } from './library.js';
import { avg, pct } from './text.js';
import { cardRef, escapeHtml } from '../data/glossary.js';

const SURGE_COST = 10;

/** Total mana a source page's X stands for. */
export function totalManaFor(sourceSpell, x) {
    const n = Math.max(0, Math.floor(Number(x) || 0));
    switch (sourceSpell) {
        case 'wave': return n + 3;     // {X}{G}{G}{G}
        case 'vow': return n + 2;      // {X}{G}{G}
        case 'portent': return n + 1;  // {X}{U}
        case 'surge': return SURGE_COST;
        default: return n;
    }
}

/**
 * Compare the four spells for a deck at the mana the source page is spending.
 *
 * @param {number} inputX - X on the source page (ignored for Surge)
 * @param {'wave'|'vow'|'portent'|'surge'|'generic'} [sourceSpell='generic']
 * @param {{deck?:Object, cards?:Array, commanderName?:string|null, vowDoubleCast?:boolean}} [options]
 *   deck: a DeckConfig snapshot (default: the live deck); cards: its card list;
 *   vowDoubleCast: whether Vow is copied (default: true for commanders that copy it)
 * @returns {Object|null} null when there is no card list to compare
 */
export function compareBigSpells(inputX, sourceSpell = 'generic', options = {}) {
    const deck = options.deck ?? DeckConfig.getDeckConfig();
    const cards = options.cards ?? deckCardList(deck);
    if (!cards.length) return null;

    const commanders = options.commanderName !== undefined
        ? (options.commanderName ? [options.commanderName] : [])
        : commanderNamesOf(deck);
    const vowCopied = options.vowDoubleCast ?? commanderCopiesVow(commanders);
    const totalMana = totalManaFor(sourceSpell, inputX);
    const waveX = Math.max(0, totalMana - 3);
    const vowX = Math.max(0, totalMana - 2);
    const portentX = Math.max(0, totalMana - 1);
    const deckSize = listSize(cards);

    const waveDistribution = {};
    const vowDistribution = {};
    let permanentCount = 0;
    let nonPermanentCount = 0;
    let legendaryPermanentCount = 0;
    let landCount = 0;
    let permanentManaValue = 0;
    let waveManaValue = 0;

    for (const card of cards) {
        const typeLine = card.type_line;
        const mv = Math.floor(card.cmc);
        if (isPermanent(typeLine)) {
            const land = isLand(typeLine);
            const isLegendary = /\blegendary\b/.test(frontTypeLine(typeLine));
            permanentCount += card.count;
            permanentManaValue += card.cmc * card.count;
            waveDistribution[mv] = (waveDistribution[mv] ?? 0) + card.count;
            if (mv <= waveX) waveManaValue += card.cmc * card.count;
            if (land || isLegendary) vowDistribution[mv] = (vowDistribution[mv] ?? 0) + card.count;
            if (isLegendary) legendaryPermanentCount += card.count;
            if (land) landCount += card.count;
        } else {
            nonPermanentCount += card.count;
            waveDistribution.nonperm = (waveDistribution.nonperm ?? 0) + card.count;
        }
    }

    // Genesis Wave
    const wave = simulateGenesisWave(deckSize, waveDistribution, waveX);
    const waveRevealed = Math.min(waveX, deckSize);

    // Kamahl's Druidic Vow (the copy looks at the next X cards)
    const cardsByName = Object.fromEntries(cards.map(card => [card.name, card]));
    const vow = simulateVow(deckSize, vowDistribution, vowX, vowCopied, { cardsByName });

    // Primal Surge — the cast copy is on the stack, not in the library.
    const surgeOnStack = cards.some(card => sameCard(card.name, 'Primal Surge'));
    const surgeLibrarySize = surgeOnStack ? deckSize - 1 : deckSize;
    const surgeNonPerms = surgeOnStack ? nonPermanentCount - 1 : nonPermanentCount;
    const surgePerms = surgeLibrarySize - surgeNonPerms;
    const surge = simulatePrimalSurge(surgeLibrarySize, surgeNonPerms, surgePerms);

    // Portent of Calamity
    const portent = portentX > 0 ? portentOutcomes({ cards, counts: deck, x: portentX }) : null;

    const spells = [
        {
            key: 'wave',
            name: 'Genesis Wave',
            cardName: 'Genesis Wave',
            x: waveX,
            cmc: waveX + 3,
            expected: wave?.expectedPermanents ?? 0,
            unit: 'permanents',
            manaValue: deckSize > 0 ? waveRevealed * waveManaValue / deckSize : 0,
            restriction: `Permanents with mana value ${waveX} or less`,
            metric: 'expected permanents'
        },
        {
            key: 'vow',
            name: vowCopied ? 'Kamahl\'s Druidic Vow (×2)' : 'Kamahl\'s Druidic Vow',
            cardName: 'Kamahl\'s Druidic Vow',
            copied: vowCopied,
            x: vowX,
            cmc: vowX + 2,
            expected: vow?.expectedHits ?? 0,
            unit: 'lands & legends',
            manaValue: vow?.expectedManaValue ?? 0,
            restriction: `Lands and legendary permanents with mana value ${vowX} or less${vowCopied ? ', cast twice' : ''}`,
            metric: 'expected permanents'
        },
        {
            key: 'surge',
            name: 'Primal Surge',
            cardName: 'Primal Surge',
            x: null,
            cmc: SURGE_COST,
            expected: surge?.expectedPermanents ?? 0,
            unit: 'permanents',
            manaValue: permanentCount > 0 ? (surge?.expectedPermanents ?? 0) * permanentManaValue / permanentCount : 0,
            restriction: 'Every permanent until the first instant or sorcery',
            metric: 'expected permanents'
        },
        {
            key: 'portent',
            name: 'Portent of Calamity',
            cardName: 'Portent of Calamity',
            x: portentX,
            cmc: portentX + 1,
            expected: portent?.expectedTypes ?? 0,
            unit: 'cards',
            freeChance: portent?.prob4Plus ?? 0,
            manaValue: null,
            restriction: `Exile one card of each type from the top ${portentX}`,
            metric: 'expected cards kept'
        }
    ];
    spells.forEach(spell => {
        spell.affordable = spell.cmc <= totalMana;
        spell.efficiency = spell.cmc > 0 ? spell.expected / spell.cmc : 0;
    });
    spells.sort((a, b) => b.expected - a.expected);

    return {
        spells,
        totalMana,
        deckSize,
        permanentCount,
        nonPermanentCount,
        legendaryPermanentCount,
        landCount,
        insight: generateDeckInsight(spells, {
            permanentCount, legendaryPermanentCount, surgeNonPerms, surgePerms
        })
    };
}

/**
 * One deck-building observation, based on which spell comes out ahead.
 * @returns {{text:string}|null}
 */
function generateDeckInsight(spells, { permanentCount, legendaryPermanentCount, surgeNonPerms, surgePerms }) {
    const best = spells.find(s => s.affordable) ?? spells[0];
    const legendaryRatio = permanentCount > 0 ? legendaryPermanentCount / permanentCount : 0;
    const share = `${Math.round(legendaryRatio * 100)}%`;

    switch (best?.key) {
        case 'surge':
            if (surgeNonPerms <= 0) return { text: `With no other instants or sorceries, Primal Surge puts your whole library (${surgePerms} cards) onto the battlefield.` };
            if (surgeNonPerms <= 2) return { text: `Only ${surgeNonPerms} other instant${surgeNonPerms > 1 ? 's or sorceries' : ' or sorcery'} in the library — ideal for Primal Surge.` };
            return { text: `Primal Surge stops at any of your ${surgeNonPerms} instants and sorceries; each one you cut makes it go noticeably further.` };
        case 'wave':
            return legendaryRatio < 0.15
                ? { text: `Only ${share} of your permanents are legendary, so Genesis Wave beats the Vow here.` }
                : { text: 'Genesis Wave hits any permanent, so it gets the most from a deck full of them.' };
        case 'vow':
            return legendaryRatio >= 0.4
                ? { text: `${share} of your permanents are legendary — the Vow’s best case.` }
                : { text: 'Lands plus your legends give the Vow plenty to hit.' };
        case 'portent':
            return { text: 'A wide spread of card types makes Portent the strongest card-for-mana option — though its cards go to your hand, not the battlefield.' };
        default:
            return null;
    }
}

const NAMES = { wave: 'Genesis Wave', vow: 'Kamahl’s Druidic Vow', surge: 'Primal Surge', portent: 'Portent of Calamity' };

function resultText(spell) {
    return `${avg(spell.expected)} ${spell.unit}`;
}

/**
 * The comparison's one-sentence takeaway, from the source page's point of view.
 * @param {Object} comparison - compareBigSpells() output
 * @param {string} [current] - the page asking
 * @returns {string} HTML
 */
export function comparisonLead(comparison, current) {
    if (!comparison?.spells?.length) return '';
    const ranked = comparison.spells.filter(s => s.affordable);
    const best = ranked[0] ?? comparison.spells[0];
    const here = comparison.spells.find(s => s.key === current);
    const mana = comparison.totalMana;
    if (!here || here.key === best.key) {
        const runnerUp = ranked.find(s => s.key !== best.key);
        return `For ${mana} mana, <strong>${NAMES[best.key]}</strong> gets this deck the most: about <strong>${resultText(best)}</strong>`
            + (runnerUp ? `, ahead of ${NAMES[runnerUp.key]} (${avg(runnerUp.expected)}).` : '.');
    }
    if (!here.affordable) {
        return `${NAMES[here.key]} needs ${here.cmc} mana. For ${mana}, <strong>${NAMES[best.key]}</strong> does best here: about <strong>${resultText(best)}</strong>.`;
    }
    return `For ${mana} mana, <strong>${NAMES[best.key]}</strong> gets this deck more — about <strong>${resultText(best)}</strong>, against ${resultText(here)} from ${NAMES[here.key]}.`;
}

/**
 * Render the "How it compares" section.
 * @param {Object|null} comparison - compareBigSpells() output
 * @param {{current?:string}} [opts] - the page it is shown on (highlighted)
 * @returns {string} HTML
 */
export function renderComparison(comparison, { current = null } = {}) {
    if (!comparison) {
        return '<p class="bsc-empty">Import a decklist to compare the big spells for your deck.</p>';
    }
    const peak = Math.max(...comparison.spells.map(s => s.expected), 0.0001);
    const rows = comparison.spells.map(spell => {
        const isCurrent = spell.key === current;
        const cast = spell.x == null ? `${spell.cmc} mana` : `X=${spell.x} · ${spell.cmc}`;
        const detail = spell.key === 'portent'
            ? `${pct(spell.freeChance)} free spell`
            : (spell.manaValue != null ? `${avg(spell.manaValue)} mana value` : '');
        const badges = [
            isCurrent ? '<span class="bsc-badge">this page</span>' : '',
            spell.copied ? '<span class="bsc-badge">copied ×2</span>' : '',
            spell.affordable ? '' : `<span class="bsc-badge">needs ${spell.cmc}</span>`
        ].join('');
        const width = Math.max(0, Math.min(100, spell.expected / peak * 100));
        return `
            <li class="bsc-row${isCurrent ? ' is-current' : ''}" title="${escapeHtml(spell.restriction)}">
                <span class="bsc-name">${cardRef(spell.cardName)}${badges}</span>
                <span class="bsc-cast">${cast}</span>
                <span class="bsc-result">
                    <span class="bs-bar"><span style="width:${width.toFixed(1)}%"></span></span>
                    <span class="bsc-value"><strong>${avg(spell.expected)}</strong> ${spell.unit}${detail ? ` · ${detail}` : ''}</span>
                </span>
            </li>`;
    }).join('');

    const note = [
        comparison.insight?.text ?? '',
        'Averages per cast. Portent’s cards go to your hand; the others go onto the battlefield.'
    ].filter(Boolean).join(' ');

    return `
        <p class="bsc-lead">${comparisonLead(comparison, current)}</p>
        <ol class="bsc-list">${rows}</ol>
        <p class="bsc-note">${note}</p>`;
}
