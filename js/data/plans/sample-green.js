/**
 * Game Plan preset: a small sample deck — mono-green ramp in 40 cards — that
 * shows how a preset bundles a deck with its plan. Card records are a
 * Scryfall snapshot (oracle text, costs, colours).
 */

export const id = 'sample-green';
export const title = 'Sample: green ramp (40 cards)';
export const deckUrl = null;
export const commanders = [];

export const plan = {
    v: 1,
    steps: [
        { turn: 2, require: { kind: 'cast', group: { is: 'mana', mv: [0, 2] } } },
        { turn: 4, require: { kind: 'mana', atLeast: 6 } },
        { turn: 4, require: { kind: 'cast', group: { is: 'creature', mv: [6, 6] } } }
    ]
};

export const notes = 'A dork on turn 2, then a power-4 creature turns Fanatic of Rhonas on: six mana and a Colossal Dreadmaw on turn 4.';

const G = ['G'];
const card = (fields, count) => ({ colors: G, color_identity: G, ...fields, count });

export const snapshot = {
    name: 'Sample green ramp',
    commanders: [],
    format: 'limited',
    counts: { creatures: 21, instants: 0, sorceries: 2, artifacts: 0, enchantments: 0, planeswalkers: 0, lands: 17, battles: 0 },
    actualCardCount: 40,
    cardsByName: {
        Forest: card({ name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, mana_cost: '', oracle_text: '({T}: Add {G}.)', category: 'lands', allCategories: ['lands'], colors: [], produced_mana: G }, 17),
        'Llanowar Elves': card({ name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, mana_cost: '{G}', oracle_text: '{T}: Add {G}.', power: '1', toughness: '1', category: 'creatures', allCategories: ['creatures'], produced_mana: G }, 4),
        'Fanatic of Rhonas': card({ name: 'Fanatic of Rhonas', type_line: 'Creature — Snake Druid', cmc: 2, mana_cost: '{1}{G}', oracle_text: '{T}: Add {G}.\nFerocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater.\nEternalize {2}{G}{G} ({2}{G}{G}, Exile this card from your graveyard: Create a token that\'s a copy of it, except it\'s a 4/4 black Zombie Snake Druid with no mana cost. Eternalize only as a sorcery.)', power: '1', toughness: '4', category: 'creatures', allCategories: ['creatures'], produced_mana: G }, 4),
        'Whisperer of the Wilds': card({ name: 'Whisperer of the Wilds', type_line: 'Creature — Human Shaman', cmc: 2, mana_cost: '{1}{G}', oracle_text: '{T}: Add {G}.\nFerocious — {T}: Add {G}{G}. Activate only if you control a creature with power 4 or greater.', power: '0', toughness: '2', category: 'creatures', allCategories: ['creatures'], produced_mana: G }, 2),
        'Grizzly Bears': card({ name: 'Grizzly Bears', type_line: 'Creature — Bear', cmc: 2, mana_cost: '{1}{G}', oracle_text: '', power: '2', toughness: '2', category: 'creatures', allCategories: ['creatures'] }, 4),
        'Topiary Stomper': card({ name: 'Topiary Stomper', type_line: 'Creature — Plant Dinosaur', cmc: 3, mana_cost: '{1}{G}{G}', oracle_text: 'Vigilance (Attacking doesn\'t cause this creature to tap.)\nWhen this creature enters, search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nThis creature can\'t attack or block unless you control seven or more lands.', power: '4', toughness: '4', category: 'creatures', allCategories: ['creatures'] }, 3),
        'Explosive Vegetation': card({ name: 'Explosive Vegetation', type_line: 'Sorcery', cmc: 4, mana_cost: '{3}{G}', oracle_text: 'Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.', category: 'sorceries', allCategories: ['sorceries'] }, 2),
        'Colossal Dreadmaw': card({ name: 'Colossal Dreadmaw', type_line: 'Creature — Dinosaur', cmc: 6, mana_cost: '{4}{G}{G}', oracle_text: 'Trample', power: '6', toughness: '6', category: 'creatures', allCategories: ['creatures'] }, 4)
    }
};
