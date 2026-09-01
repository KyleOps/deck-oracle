/**
 * Big Spell Comparison Utility
 * Compares Genesis Wave, Kamahl's Druidic Vow, and Primal Surge for a given deck
 */

import * as DeckConfig from './deckConfig.js';
import { simulateGenesisWave } from '../calculators/wave.js';
import { simulateVow } from '../calculators/vow.js';
import { simulatePrimalSurge } from '../calculators/surge.js';
import { calculate as calculatePortent } from '../calculators/portent.js';

/**
 * Analyze which big spell is best for the current deck at a given X
 * @param {number} inputX - X value from the source calculator
 * @param {string} sourceSpell - The calculator initiating the comparison ('wave', 'vow', 'portent', 'surge')
 * @returns {Object} - Comparison results
 */
export function compareBigSpells(inputX, sourceSpell = 'generic') {
    const cardData = DeckConfig.getImportedCardData();
    const deckSize = DeckConfig.getDeckSize(true);
    const config = DeckConfig.getDeckConfig();
    const commanderName = DeckConfig.getCommanderName();

    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        return null;
    }

    // Determine target total mana based on source spell
    let totalMana;
    if (sourceSpell === 'wave') {
        totalMana = inputX + 3; // {X}{G}{G}{G}
    } else if (sourceSpell === 'vow') {
        totalMana = inputX + 2; // {X}{G}{G}
    } else if (sourceSpell === 'portent') {
        totalMana = inputX + 1; // {X}{U}
    } else if (sourceSpell === 'surge') {
        totalMana = 10; // Fixed cost
    } else {
        totalMana = inputX; // Fallback
    }

    // Calculate equivalent X for each spell based on total mana
    // Ensure X is at least 0
    const waveX = Math.max(0, totalMana - 3);
    const vowX = Math.max(0, totalMana - 2);
    const portentX = Math.max(0, totalMana - 1);
    
    // Build distributions for each spell
    let waveDistribution = {};
    let vowDistribution = {};
    let permanentCount = 0;
    let nonPermanentCount = 0;
    let legendaryPermanentCount = 0;
    let landCount = 0;

    Object.values(cardData.cardsByName).forEach(card => {
        const typeLine = (card.type_line || '').toLowerCase();
        const cmc = card.cmc !== undefined ? Math.floor(card.cmc) : 0;

        const isPermanent = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land']
            .some(t => typeLine.includes(t));
        const isLand = typeLine.includes('land');
        const isLegendary = typeLine.includes('legendary');

        if (isPermanent) {
            permanentCount += card.count;

            // Wave: Any permanent with CMC <= waveX
            waveDistribution[cmc] = (waveDistribution[cmc] || 0) + card.count;

            // Vow: Land OR (Legendary Permanent with CMC <= vowX)
            if (isLand || isLegendary) {
                vowDistribution[cmc] = (vowDistribution[cmc] || 0) + card.count;
                if (isLegendary) legendaryPermanentCount += card.count;
            }

            if (isLand) landCount += card.count;
        } else {
            nonPermanentCount += card.count;
            waveDistribution['nonperm'] = (waveDistribution['nonperm'] || 0) + card.count;
        }
    });

    // Calculate expected values for each spell using their specific X
    const waveResult = simulateGenesisWave(deckSize, waveDistribution, waveX);
    const vowResult = simulateVow(deckSize, vowDistribution, vowX, false, cardData);

    // For Primal Surge: model library state after casting (Surge is on stack, not in library)
    // If deck has at least 1 non-permanent, subtract 1 from both deck size and non-perm count
    const surgeOnStack = nonPermanentCount >= 1;
    const surgeLibrarySize = surgeOnStack ? deckSize - 1 : deckSize;
    const surgeNonPerms = surgeOnStack ? nonPermanentCount - 1 : nonPermanentCount;
    const surgePerms = surgeLibrarySize - surgeNonPerms;
    const surgeResult = simulatePrimalSurge(surgeLibrarySize, surgeNonPerms, surgePerms);
    
    const portentData = calculatePortent(); 
    const portentResult = portentData?.results?.[portentX];

    // Calculate efficiency metrics
    const waveCMC = waveX + 3;
    const vowCMC = vowX + 2;
    const surgeCMC = 10;
    const portentCMC = portentX + 1;

    let waveExpected = waveResult?.expectedPermanents ?? 0;
    let vowExpected = vowResult?.expectedHits ?? 0;
    const surgeExpected = surgeResult?.expectedPermanents ?? 0;
    const portentExpected = portentResult?.expectedTypes ?? 0;

    // Double Vow expected value for "The Sixth Doctor" commander
    const isSixthDoctor = commanderName === 'The Sixth Doctor';
    if (isSixthDoctor) {
        vowExpected *= 2;
    }

    const waveEfficiency = waveCMC > 0 ? waveExpected / waveCMC : 0;
    const vowEfficiency = vowCMC > 0 ? vowExpected / vowCMC : 0;
    const surgeEfficiency = surgeExpected / surgeCMC;
    const portentEfficiency = portentCMC > 0 ? portentExpected / portentCMC : 0;

    // Determine recommendations
    const spells = [
        {
            name: 'Genesis Wave',
            x: waveX,
            expected: waveExpected,
            cmc: waveCMC,
            efficiency: waveEfficiency,
            restriction: `Permanents with CMC ≤ ${waveX}`,
            metric: 'expected permanents',
            color: '#55c97f'
        },
        {
            name: isSixthDoctor ? 'Kamahl\'s Druidic Vow (×2)' : 'Kamahl\'s Druidic Vow',
            x: vowX,
            expected: vowExpected,
            cmc: vowCMC,
            efficiency: vowEfficiency,
            restriction: isSixthDoctor ? `Lands or Legends CMC ≤ ${vowX} (Doubled)` : `Lands or Legends CMC ≤ ${vowX}`,
            metric: 'expected permanents',
            color: '#55c97f'
        },
        {
            name: 'Primal Surge',
            x: null, // N/A
            expected: surgeExpected,
            cmc: surgeCMC,
            efficiency: surgeEfficiency,
            restriction: 'All permanents until non-permanent',
            metric: 'expected permanents',
            color: '#7d8f6a'
        },
        {
            name: 'Portent of Calamity',
            x: portentX,
            expected: portentExpected,
            cmc: portentCMC,
            efficiency: portentEfficiency,
            restriction: `Exile ${portentX}, draw cards equal to types`,
            metric: 'expected card types',
            color: '#9878b8'
        }
    ];

    // Sort by expected value
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
            permanentCount,
            nonPermanentCount,
            legendaryPermanentCount,
            landCount,
            deckSize,
            // Pass Surge-specific values for accurate insights
            surgeNonPerms,
            surgePerms
        })
    };
}

/**
 * Generate a single deck insight based on composition
 * Focus on actionable deck-building advice rather than restating the comparison table
 */
function generateDeckInsight(spells, deckStats) {
    const { permanentCount, nonPermanentCount, legendaryPermanentCount, deckSize, surgeNonPerms, surgePerms } = deckStats;
    const legendaryRatio = permanentCount > 0 ? legendaryPermanentCount / permanentCount : 0;

    // Find best spell
    const best = spells[0];

    // Primal Surge specific insights - use surgeNonPerms (excluding Surge itself from library)
    if (best.name === 'Primal Surge') {
        if (surgeNonPerms === 0) {
            return {
                icon: '🏆',
                text: `All permanents! Primal Surge guarantees your entire library (${surgePerms} cards).`
            };
        } else if (surgeNonPerms <= 2) {
            return {
                icon: '✓',
                text: `Only ${surgeNonPerms} other non-permanent${surgeNonPerms > 1 ? 's' : ''} in library — excellent for Primal Surge.`
            };
        } else {
            return {
                icon: '💡',
                text: `${surgeNonPerms} other non-permanents in library. Cutting ${Math.min(surgeNonPerms, 5)} could significantly boost Primal Surge.`
            };
        }
    }

    // Genesis Wave insights
    if (best.name === 'Genesis Wave') {
        if (legendaryRatio < 0.15) {
            return {
                icon: '💡',
                text: `Low legendary count (${(legendaryRatio * 100).toFixed(0)}%) makes Genesis Wave outperform Vow here.`
            };
        }
        return {
            icon: '🌊',
            text: `Wave hits any permanent — strong with your diverse card types.`
        };
    }

    // Vow insights
    if (best.name.includes('Druidic Vow')) {
        if (legendaryRatio >= 0.40) {
            return {
                icon: '🌟',
                text: `High legendary density (${(legendaryRatio * 100).toFixed(0)}%) — perfect for Kamahl's Druidic Vow!`
            };
        }
        return {
            icon: '▲',
            text: `Legendary tribal synergy makes Vow efficient for your deck.`
        };
    }

    // Portent insights
    if (best.name === 'Portent of Calamity') {
        return {
            icon: '🔮',
            text: `Portent excels with diverse card types in your deck.`
        };
    }

    return null;
}

/**
 * Render comparison HTML — terminal flat table style
 */
export function renderComparison(comparison) {
    if (!comparison) {
        return '<div style="padding:14px; color:var(--tx-dim); font-size:10px; letter-spacing:0.08em; text-align:center;">IMPORT DECK TO SEE SPELL COMPARISON</div>';
    }

    const { spells, insight, totalMana } = comparison;

    const shortName = name => name
        .replace("Kamahl's Druidic Vow", "Druidic Vow")
        .replace("Portent of Calamity", "Portent")
        .replace("Genesis Wave", "Gen. Wave")
        .replace("Primal Surge", "P. Surge");

    const thStyle = 'padding:6px 10px; color:var(--tx-dim); font-size:9px; letter-spacing:0.12em; text-transform:uppercase; border-bottom:1px solid var(--tx-rule); font-weight:500; text-align:right;';

    let html = `<div class="tx-h"><span>08 · BIG SPELL · ${totalMana}MV</span><span class="tx-h-r">vs same mana</span></div>`;
    html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
    html += `<thead><tr>
        <th style="${thStyle} text-align:left;">SPELL</th>
        <th style="${thStyle}">X</th>
        <th style="${thStyle}">E[HITS]</th>
        <th style="${thStyle}">EFF</th>
    </tr></thead><tbody>`;

    spells.forEach((spell, idx) => {
        const isWinner = idx === 0;
        const xDisplay = spell.x !== null ? spell.x : '—';
        const nameColor = isWinner ? spell.color : 'var(--tx-mid)';
        const valColor = isWinner ? spell.color : 'var(--tx-text)';

        html += `<tr style="border-bottom:1px solid var(--tx-rule);">
            <td style="padding:7px 10px; color:${nameColor}; font-weight:${isWinner ? '600' : '400'};">
                ${isWinner ? '<span style="color:var(--tx-amber);">▶</span> ' : '&nbsp;&nbsp;'}${shortName(spell.name)}
            </td>
            <td style="text-align:right; padding:7px 10px; color:var(--tx-dim);">${xDisplay}</td>
            <td style="text-align:right; padding:7px 10px; color:${valColor}; font-weight:${isWinner ? '600' : '400'};">${spell.expected.toFixed(2)}</td>
            <td style="text-align:right; padding:7px 10px; color:var(--tx-dim);">${spell.efficiency.toFixed(3)}</td>
        </tr>`;
    });

    html += '</tbody></table>';

    if (insight) {
        html += `<div style="padding:8px 10px; border-top:1px solid var(--tx-rule); font-size:10px; color:var(--tx-mid); letter-spacing:0.04em;">${insight.text}</div>`;
    }

    return html;
}
