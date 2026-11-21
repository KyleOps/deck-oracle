/**
 * Static card data for calculator headers (oracle text, mana cost, art).
 * Snapshotted from Scryfall so headers render instantly and offline; art and
 * images are served from Scryfall's CDN and are decorative only.
 */

export const CARD_META = Object.freeze({
    "Wild Pair": {
        "name": "Wild Pair",
        "cost": "{4}{G}{G}",
        "type": "Enchantment",
        "text": "Whenever a creature enters, if you cast it from your hand, you may search your library for a creature card with the same total power and toughness, put it onto the battlefield, then shuffle.",
        "art": "https://cards.scryfall.io/art_crop/front/f/3/f3153d2c-9168-4889-9179-23faa9c48721.jpg",
        "image": "https://cards.scryfall.io/normal/front/f/3/f3153d2c-9168-4889-9179-23faa9c48721.jpg",
        "artist": "Lars Grant-West"
    },
    "Monstrous Vortex": {
        "name": "Monstrous Vortex",
        "cost": "{3}{G}",
        "type": "Enchantment",
        "text": "Whenever you cast a creature spell with power 5 or greater, discover X, where X is that spell's mana value. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)",
        "art": "https://cards.scryfall.io/art_crop/front/1/6/162fcdec-bf3c-43ba-9ada-212f7dec5fbd.jpg",
        "image": "https://cards.scryfall.io/normal/front/1/6/162fcdec-bf3c-43ba-9ada-212f7dec5fbd.jpg",
        "artist": "Deruchenko Alexander"
    },
    "Chimil, the Inner Sun": {
        "name": "Chimil, the Inner Sun",
        "cost": "{6}",
        "type": "Legendary Artifact",
        "text": "Spells you control can't be countered.\nAt the beginning of your end step, discover 5. (Exile cards from the top of your library until you exile a nonland card with mana value 5 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)",
        "art": "https://cards.scryfall.io/art_crop/front/7/b/7b696878-bf6c-4323-baa5-93c44dde075e.jpg",
        "image": "https://cards.scryfall.io/normal/front/7/b/7b696878-bf6c-4323-baa5-93c44dde075e.jpg",
        "artist": "Adam Paquette"
    },
    "Rashmi, Eternities Crafter": {
        "name": "Rashmi, Eternities Crafter",
        "cost": "{2}{G}{U}",
        "type": "Legendary Creature — Elf Druid",
        "text": "Whenever you cast your first spell each turn, reveal the top card of your library. You may cast it without paying its mana cost if it's a spell with lesser mana value. If you don't cast it, put it into your hand.",
        "art": "https://cards.scryfall.io/art_crop/front/e/5/e553935f-d8d8-4b98-ab4a-5a2eea3f3626.jpg",
        "image": "https://cards.scryfall.io/normal/front/e/5/e553935f-d8d8-4b98-ab4a-5a2eea3f3626.jpg",
        "artist": "Magali Villeneuve"
    },
    "Portent of Calamity": {
        "name": "Portent of Calamity",
        "cost": "{X}{U}",
        "type": "Sorcery",
        "text": "Reveal the top X cards of your library. For each card type, you may exile a card of that type from among them. Put the rest into your graveyard. You may cast a spell from among the exiled cards without paying its mana cost if you exiled four or more cards this way. Then put the rest of the exiled cards into your hand.",
        "art": "https://cards.scryfall.io/art_crop/front/8/5/8599e2dd-9164-4da3-814f-adccef3b9497.jpg",
        "image": "https://cards.scryfall.io/normal/front/8/5/8599e2dd-9164-4da3-814f-adccef3b9497.jpg",
        "artist": "Sam Guay"
    },
    "Genesis Wave": {
        "name": "Genesis Wave",
        "cost": "{X}{G}{G}{G}",
        "type": "Sorcery",
        "text": "Reveal the top X cards of your library. You may put any number of permanent cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard.",
        "art": "https://cards.scryfall.io/art_crop/front/d/4/d46f7ddb-f986-4f1f-b096-ae1a02d0bdc8.jpg",
        "image": "https://cards.scryfall.io/normal/front/d/4/d46f7ddb-f986-4f1f-b096-ae1a02d0bdc8.jpg",
        "artist": "Arif Wijaya"
    },
    "Kamahl's Druidic Vow": {
        "name": "Kamahl's Druidic Vow",
        "cost": "{X}{G}{G}",
        "type": "Legendary Sorcery",
        "text": "(You may cast a legendary sorcery only if you control a legendary creature or planeswalker.)\nLook at the top X cards of your library. You may put any number of land and/or legendary permanent cards with mana value X or less from among them onto the battlefield. Put the rest into your graveyard.",
        "art": "https://cards.scryfall.io/art_crop/front/b/f/bf95ef60-e67b-466d-a6cb-d487ffa88b72.jpg",
        "image": "https://cards.scryfall.io/normal/front/b/f/bf95ef60-e67b-466d-a6cb-d487ffa88b72.jpg",
        "artist": "Noah Bradley"
    },
    "Primal Surge": {
        "name": "Primal Surge",
        "cost": "{8}{G}{G}",
        "type": "Sorcery",
        "text": "Exile the top card of your library. If it's a permanent card, you may put it onto the battlefield. If you do, repeat this process.",
        "art": "https://cards.scryfall.io/art_crop/front/4/2/4278f7bd-afff-4a1d-a0bb-bf9ce3ad5a2e.jpg",
        "image": "https://cards.scryfall.io/normal/front/4/2/4278f7bd-afff-4a1d-a0bb-bf9ce3ad5a2e.jpg",
        "artist": "David Rapoza"
    },
    "Abstract Performance": {
        "name": "Abstract Performance",
        "cost": "{5}{U}",
        "type": "Sorcery",
        "text": "Exile the top four cards of your library in a face-down pile, then exile the top four cards of your library in a face-up pile. An opponent chooses one of those piles. Put that pile into your graveyard. Look at the cards in the other pile. You may cast a spell from among them without paying its mana cost. Put the rest into your hand.",
        "art": "https://cards.scryfall.io/art_crop/front/2/7/2795c812-0850-4405-b968-b624deaccd55.jpg",
        "image": "https://cards.scryfall.io/normal/front/2/7/2795c812-0850-4405-b968-b624deaccd55.jpg",
        "artist": "Alessandra Pisano"
    },
    "Lumra, Bellow of the Woods": {
        "name": "Lumra, Bellow of the Woods",
        "cost": "{4}{G}{G}",
        "type": "Legendary Creature — Elemental Bear",
        "text": "Reach, vigilance\nLumra's power and toughness are each equal to the number of lands you control.\nWhen Lumra enters, mill four cards. Then return all land cards from your graveyard to the battlefield tapped.",
        "art": "https://cards.scryfall.io/art_crop/front/a/e/ae4f3aaf-3960-48cd-b34b-32e4ae5ae088.jpg",
        "image": "https://cards.scryfall.io/normal/front/a/e/ae4f3aaf-3960-48cd-b34b-32e4ae5ae088.jpg",
        "artist": "Matt Stewart"
    },
    "Ensnared by the Mara": {
        "name": "Ensnared by the Mara",
        "cost": "{2}{R}{R}",
        "type": "Sorcery",
        "text": "Each opponent faces a villainous choice — They exile cards from the top of their library until they exile a nonland card, then you may cast that card without paying its mana cost, or that player exiles the top four cards of their library and Ensnared by the Mara deals damage equal to the total mana value of those exiled cards to that player.",
        "art": "https://cards.scryfall.io/art_crop/front/1/1/11454c82-3f1d-4456-8857-0dcb01d34298.jpg",
        "image": "https://cards.scryfall.io/normal/front/1/1/11454c82-3f1d-4456-8857-0dcb01d34298.jpg",
        "artist": "Andrey Kuzinskiy"
    },
    "Dream Harvest": {
        "name": "Dream Harvest",
        "cost": "{5}{U/B}{U/B}",
        "type": "Sorcery",
        "text": "Each opponent exiles cards from the top of their library until they have exiled cards with total mana value 5 or greater this way. Until end of turn, you may cast cards exiled this way without paying their mana costs.",
        "art": "https://cards.scryfall.io/art_crop/front/a/4/a4ebc0e7-02d7-4d38-9376-a39963e6d3fa.jpg",
        "image": "https://cards.scryfall.io/normal/front/a/4/a4ebc0e7-02d7-4d38-9376-a39963e6d3fa.jpg",
        "artist": "Ben Hill"
    },
    "Mind's Dilation": {
        "name": "Mind's Dilation",
        "cost": "{5}{U}{U}",
        "type": "Enchantment",
        "text": "Whenever an opponent casts their first spell each turn, that player exiles the top card of their library. If it's a nonland card, you may cast it without paying its mana cost.",
        "art": "https://cards.scryfall.io/art_crop/front/4/f/4f2980ba-2468-4a36-afdb-87e6567797a9.jpg",
        "image": "https://cards.scryfall.io/normal/front/4/f/4f2980ba-2468-4a36-afdb-87e6567797a9.jpg",
        "artist": "Iain McCaig"
    },
    "Oracle of Mul Daya": {
        "name": "Oracle of Mul Daya",
        "cost": "{3}{G}",
        "type": "Creature — Elf Shaman",
        "text": "You may play an additional land on each of your turns.\nPlay with the top card of your library revealed.\nYou may play lands from the top of your library.",
        "art": "https://cards.scryfall.io/art_crop/front/7/f/7f89a173-0b2f-4a6a-b706-9aed8dbcabec.jpg",
        "image": "https://cards.scryfall.io/normal/front/7/f/7f89a173-0b2f-4a6a-b706-9aed8dbcabec.jpg",
        "artist": "Vance Kovacs"
    },
    "Ponder": {
        "name": "Ponder",
        "cost": "{U}",
        "type": "Sorcery",
        "text": "Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.",
        "art": "https://cards.scryfall.io/art_crop/front/b/a/ba6b6fc5-5077-4812-b8e9-906783dbaf67.jpg",
        "image": "https://cards.scryfall.io/normal/front/b/a/ba6b6fc5-5077-4812-b8e9-906783dbaf67.jpg",
        "artist": "Mark Tedin"
    },
    "Serum Powder": {
        "name": "Serum Powder",
        "cost": "{3}",
        "type": "Artifact",
        "text": "{T}: Add {C}.\nAny time you could mulligan and this card is in your hand, you may exile all the cards from your hand, then draw that many cards. (You can do this in addition to taking mulligans.)",
        "art": "https://cards.scryfall.io/art_crop/front/c/8/c8753b80-aa9e-4f82-9a02-6b3997169dbb.jpg",
        "image": "https://cards.scryfall.io/normal/front/c/8/c8753b80-aa9e-4f82-9a02-6b3997169dbb.jpg",
        "artist": "Matt Thompson"
    },
    "Command Tower": {
        "name": "Command Tower",
        "cost": "",
        "type": "Land",
        "text": "{T}: Add one mana of any color in your commander's color identity.",
        "art": "https://cards.scryfall.io/art_crop/front/4/6/46982091-cc78-4171-8b3d-d07592684728.jpg",
        "image": "https://cards.scryfall.io/normal/front/4/6/46982091-cc78-4171-8b3d-d07592684728.jpg",
        "artist": "Ryan Yee"
    },
    "Brainstorm": {
        "name": "Brainstorm",
        "cost": "{U}",
        "type": "Instant",
        "text": "Draw three cards, then put two cards from your hand on top of your library in any order.",
        "art": "https://cards.scryfall.io/art_crop/front/2/e/2ea8d5cb-cf7e-4194-8019-812b3f56cf20.jpg",
        "image": "https://cards.scryfall.io/normal/front/2/e/2ea8d5cb-cf7e-4194-8019-812b3f56cf20.jpg",
        "artist": "Chris Rahn"
    },
    "Azusa, Lost but Seeking": {
        "name": "Azusa, Lost but Seeking",
        "cost": "{2}{G}",
        "type": "Legendary Creature — Human Monk",
        "text": "You may play two additional lands on each of your turns.",
        "art": "https://cards.scryfall.io/art_crop/front/9/e/9ed862a2-d3e2-4543-81a6-453a96399d14.jpg",
        "image": "https://cards.scryfall.io/normal/front/9/e/9ed862a2-d3e2-4543-81a6-453a96399d14.jpg",
        "artist": "Todd Lockwood"
    },
    "Pit Fight": {
        "name": "Pit Fight",
        "cost": "{1}{R/G}",
        "type": "Instant",
        "text": "Target creature you control fights another target creature.",
        "art": "https://cards.scryfall.io/art_crop/front/4/4/4459499c-099b-47d5-b73d-774ff120230f.jpg",
        "image": "https://cards.scryfall.io/normal/front/4/4/4459499c-099b-47d5-b73d-774ff120230f.jpg",
        "artist": ""
    },
    "Clone": {
        "name": "Clone",
        "cost": "{3}{U}",
        "type": "Creature — Shapeshifter",
        "text": "You may have this creature enter as a copy of any creature on the battlefield.",
        "art": "https://cards.scryfall.io/art_crop/front/8/8/881f6340-865f-437c-983e-df39aad032ab.jpg",
        "image": "https://cards.scryfall.io/normal/front/8/8/881f6340-865f-437c-983e-df39aad032ab.jpg",
        "artist": "Kev Walker"
    }
});
