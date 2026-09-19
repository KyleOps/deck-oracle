/**
 * Single registry for calculator modules and navigation metadata.
 * Adding a calculator to the app shell should require one entry here rather
 * than separate initialization and tab-render branches in main.js.
 */

import * as Portent from '../calculators/portent.js';
import * as Surge from '../calculators/surge.js';
import * as Wave from '../calculators/wave.js';
import * as Vow from '../calculators/vow.js';
import * as Vortex from '../calculators/vortex.js';
import * as Lands from '../calculators/lands.js';
import * as Rashmi from '../calculators/rashmi.js';
import * as Lumra from '../calculators/lumra.js';
import * as Mulligan from '../calculators/mulligan.js';
import * as Mara from '../calculators/mara.js';
import * as DreamHarvest from '../calculators/dreamharvest.js';
import * as Abstract from '../calculators/abstract.js';
import * as MindsDilation from '../calculators/mindsdilation.js';
import * as Chimil from '../calculators/chimil.js';
import * as WildPair from '../calculators/wildpair.js';
import * as Versus from '../calculators/versus.js';

export const CALCULATORS = Object.freeze({
    // ENGINES — recurring permanents
    wildpair: { name: 'Wild Pair', group: 'engines', module: WildPair },
    vortex: { name: 'Monstrous Vortex', group: 'engines', module: Vortex },
    chimil: { name: 'Chimil, the Inner Sun', group: 'engines', module: Chimil },
    rashmi: { name: 'Rashmi', group: 'engines', module: Rashmi },

    // SPELLS — one-shot payoffs
    portent: { name: 'Portent of Calamity', group: 'spells', module: Portent },
    wave: { name: 'Genesis Wave', group: 'spells', module: Wave },
    vow: { name: 'Kamahl\'s Druidic Vow', group: 'spells', module: Vow },
    surge: { name: 'Primal Surge', group: 'spells', module: Surge },
    abstract: { name: 'Abstract Performance', group: 'spells', module: Abstract },
    lumra: { name: 'Lumra', group: 'spells', module: Lumra },

    // TOOLS — deck-level, not card-specific
    mulligan: { name: 'Mulligan Strategy', group: 'deck-tools', module: Mulligan },
    lands: { name: 'Land Drops', group: 'deck-tools', module: Lands },
    versus: { name: 'Head to Head', group: 'deck-tools', module: Versus },

    // MULTI — opponent-facing
    mara: { name: 'Ensnared by the Mara', group: 'multiplayer', module: Mara },
    dreamharvest: { name: 'Dream Harvest', group: 'multiplayer', module: DreamHarvest },
    mindsdilation: { name: "Mind's Dilation", group: 'multiplayer', module: MindsDilation }
});

export function getCalculator(name) {
    return CALCULATORS[name] ?? null;
}

export function initializeCalculators() {
    Object.values(CALCULATORS).forEach(calculator => calculator.module.init());
}
