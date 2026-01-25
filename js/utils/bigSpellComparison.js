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
            color: '#10b981'
        },
        {
            name: isSixthDoctor ? 'Kamahl\'s Druidic Vow (×2)' : 'Kamahl\'s Druidic Vow',
            x: vowX,
            expected: vowExpected,
            cmc: vowCMC,
            efficiency: vowEfficiency,
            restriction: isSixthDoctor ? `Lands or Legends CMC ≤ ${vowX} (Doubled)` : `Lands or Legends CMC ≤ ${vowX}`,
            metric: 'expected permanents',
            color: '#22c55e'
        },
        {
            name: 'Primal Surge',
            x: null, // N/A
            expected: surgeExpected,
            cmc: surgeCMC,
            efficiency: surgeEfficiency,
            restriction: 'All permanents until non-permanent',
            metric: 'expected permanents',
            color: '#84cc16'
        },
        {
            name: 'Portent of Calamity',
            x: portentX,
            expected: portentExpected,
            cmc: portentCMC,
            efficiency: portentEfficiency,
            restriction: `Exile ${portentX}, draw cards equal to types`,
            metric: 'expected card types',
            color: '#c084fc'
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
                icon: '✅',
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
            icon: '⚔️',
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
 * Render comparison HTML
 */
export function renderComparison(comparison) {
    if (!comparison) {
        return '<p style="color: var(--text-dim);">Import a deck to see spell comparison</p>';
    }

    const { spells, insight, totalMana } = comparison;

    let html = '<div class="big-spell-comparison-container">';
    html += `<h3 style="margin-top: 0;">🎯 Big Spell Comparison (${totalMana} Mana)</h3>`;

    // Spell comparison grid
    const numSpells = spells.length;
    html += `<div class="big-spell-grid" style="grid-template-columns: repeat(${numSpells}, 1fr);">`;

    spells.forEach((spell, idx) => {
        const isWinner = idx === 0;
        const xDisplay = spell.x !== null ? `X=${spell.x}` : 'Fixed';
        const borderColor = isWinner ? spell.color : 'transparent';

        html += `<div class="big-spell-card" style="border-color: ${borderColor};">`;
        html += `<h4 class="big-spell-title" style="color: ${spell.color};" title="${spell.name}">${isWinner ? '👑 ' : ''}${spell.name}</h4>`;

        html += `<div class="big-spell-x-value">${xDisplay}</div>`;
        html += `<div class="big-spell-value" style="color: ${spell.color};">${spell.expected.toFixed(2)}</div>`;
        html += `<div class="big-spell-metric">${spell.metric}</div>`;

        html += `<div class="big-spell-details">`;
        html += `<div>CMC: ${spell.cmc}</div>`;
        html += `<div>Eff: ${spell.efficiency.toFixed(3)}</div>`;
        html += `<div class="big-spell-restriction">${spell.restriction}</div>`;
        html += `</div></div>`;
    });

    html += '</div>';

    // Single deck insight (if available)
    if (insight) {
        html += `<div style="margin-top: var(--spacing-sm); padding: var(--spacing-sm); background: var(--panel-bg-alt); border-radius: var(--radius-sm); font-size: 0.9em;">`;
        html += `<span style="margin-right: 6px;">${insight.icon}</span>${insight.text}`;
        html += `</div>`;
    }

    html += '</div>';
    return html;
}
