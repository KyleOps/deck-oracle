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
    const surgeResult = simulatePrimalSurge(deckSize, nonPermanentCount, permanentCount);
    
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
        recommendations: generateRecommendations(spells, totalMana, {
            permanentCount,
            nonPermanentCount,
            legendaryPermanentCount,
            landCount,
            deckSize
        })
    };
}

/**
 * Generate recommendations based on deck composition
 */
function generateRecommendations(spells, totalMana, deckStats) {
    const recommendations = [];
    const { permanentCount, nonPermanentCount, legendaryPermanentCount, landCount, deckSize } = deckStats;

    const permanentRatio = permanentCount / deckSize;
    const legendaryRatio = legendaryPermanentCount / permanentCount;

    // Primal Surge recommendation
    if (nonPermanentCount === 0) {
        recommendations.push({
            spell: 'Primal Surge',
            reason: '🏆 **Perfect!** Your deck has 0 non-permanents. Primal Surge will flip your entire deck!',
            priority: 'critical'
        });
    } else if (nonPermanentCount <= 3) {
        recommendations.push({
            spell: 'Primal Surge',
            reason: `✅ **Excellent!** Only ${nonPermanentCount} non-permanent${nonPermanentCount > 1 ? 's' : ''}. Primal Surge will flip most of your deck.`, 
            priority: 'high'
        });
    } else if (nonPermanentCount <= 10 && permanentRatio >= 0.85) {
        recommendations.push({
            spell: 'Primal Surge',
            reason: `⚠️ **Good.** ${nonPermanentCount} non-permanents (${((nonPermanentCount/deckSize)*100).toFixed(1)}%). Consider cutting to maximize Primal Surge.`, 
            priority: 'medium'
        });
    }

    // Genesis Wave vs Vow comparison
    const wave = spells.find(s => s.name === 'Genesis Wave');
    const vow = spells.find(s => s.name.includes('Kamahl\'s Druidic Vow'));

    if (wave && vow && wave.expected !== undefined && vow.expected !== undefined) {
        const waveBetter = wave.expected > vow.expected;
        const diff = Math.abs(wave.expected - vow.expected);
        const maxExpected = Math.max(wave.expected, vow.expected);
        const percentDiff = maxExpected > 0 ? (diff / maxExpected) * 100 : 0;

        if (percentDiff < 5) {
            recommendations.push({
                spell: 'Genesis Wave / Kamahl\'s Druidic Vow',
                reason: `⚖️ **Roughly equal** at ${totalMana} mana. Wave: ${wave.expected.toFixed(2)}, Vow: ${vow.expected.toFixed(2)} hits.`, 
                priority: 'info'
            });
        } else if (waveBetter) {
            recommendations.push({
                spell: 'Genesis Wave',
                reason: `💪 **Better output** (${wave.expected.toFixed(2)} vs ${vow.expected.toFixed(2)} hits).`, 
                priority: 'high'
            });
        } else {
            recommendations.push({
                spell: 'Kamahl\'s Druidic Vow',
                reason: `💰 **More efficient** (${vow.expected.toFixed(2)} vs ${wave.expected.toFixed(2)} hits). Synergizes with legendary tribal.`, 
                priority: 'high'
            });
        }
    }

    // Legendary density check for Vow
    if (legendaryRatio < 0.15 && vow) {
        recommendations.push({
            spell: 'Kamahl\'s Druidic Vow',
            reason: `⚠️ **Low legendary density** (${(legendaryRatio * 100).toFixed(1)}% of permanents). Vow will mostly just hit lands.`, 
            priority: 'warning'
        });
    } else if (legendaryRatio >= 0.40 && vow) {
        recommendations.push({
            spell: 'Kamahl\'s Druidic Vow',
            reason: `🌟 **High legendary density** (${(legendaryRatio * 100).toFixed(1)}% of permanents). Excellent synergy!`, 
            priority: 'high'
        });
    }

    return recommendations;
}

/**
 * Render comparison HTML
 */
export function renderComparison(comparison) {
    if (!comparison) {
        return '<p style="color: var(--text-dim);">Import a deck to see spell comparison</p>';
    }

    const { spells, recommendations, totalMana } = comparison;

    let html = '<div class="big-spell-comparison-container">';
    html += `<h3 style="margin-top: 0;">🎯 Big Spell Comparison (Equivalent Total Mana: ${totalMana})</h3>`;

    // Spell comparison table using CSS classes
    const numSpells = spells.length;
    // We add inline style for grid columns only because it depends on numSpells, though typically it's 4
    // If numSpells is always 4, we could put it in CSS. For robustness, let's keep inline variable.
    // However, CSS classes will handle the rest.
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

    // Recommendations
    if (recommendations.length > 0) {
        html += '<div class="big-spell-recommendations">';
        html += '<h4 style="margin-top: 0;">💡 Recommendations:</h4>';

        recommendations.forEach(rec => {
            const bgColor = rec.priority === 'critical' ? 'rgba(34, 197, 94, 0.1)' :
                           rec.priority === 'high' ? 'rgba(59, 130, 246, 0.1)' :
                           rec.priority === 'warning' ? 'rgba(245, 158, 11, 0.1)' :
                           'rgba(107, 114, 128, 0.1)';

            html += `<div class="big-spell-recommendation-item" style="background: ${bgColor};">`;
            html += `<div style="font-weight: bold; margin-bottom: 4px;">${rec.spell}</div>`;
            html += `<div style="font-size: 0.9em;">${rec.reason}</div>`;
            html += `</div>`;
        });

        html += '</div>';
    }

    html += '</div>';
    return html;
}
