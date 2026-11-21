/**
 * Deck Overview — view.
 * The landing page: who this deck is, how healthy it is, and which calculators
 * apply to it. Everything inside the containers is rendered by
 * js/calculators/overview.js.
 */

export const template = `
<div class="ov">
    <section class="ov-hero" id="ov-hero" aria-label="Deck summary"></section>

    <section class="ov-section" aria-labelledby="ov-health-title">
        <div class="ov-section-head">
            <h2 class="ov-section-title" id="ov-health-title">Deck health</h2>
            <p class="ov-section-sub" id="ov-health-sub">Plain-language checks on lands, colours, opening hands and card roles.</p>
        </div>
        <div class="ov-findings" id="ov-findings"></div>
    </section>

    <div class="ov-grid">
        <section class="ov-card" aria-labelledby="ov-curve-title">
            <div class="ov-card-head">
                <h3 class="ov-card-title" id="ov-curve-title">Mana curve</h3>
                <span class="ov-card-meta" id="ov-curve-meta"></span>
            </div>
            <div id="ov-curve"></div>
        </section>

        <section class="ov-card" aria-labelledby="ov-hands-title">
            <div class="ov-card-head">
                <h3 class="ov-card-title" id="ov-hands-title">Opening hands</h3>
                <span class="ov-card-meta" id="ov-hands-meta"></span>
            </div>
            <div id="ov-hands"></div>
        </section>

        <section class="ov-card" aria-labelledby="ov-colors-title">
            <div class="ov-card-head">
                <h3 class="ov-card-title" id="ov-colors-title">Colours</h3>
                <a class="ov-card-link" href="?tab=manabase" data-tab-link="manabase">Mana Base →</a>
            </div>
            <div id="ov-colors"></div>
        </section>

        <section class="ov-card" aria-labelledby="ov-roles-title">
            <div class="ov-card-head">
                <h3 class="ov-card-title" id="ov-roles-title">Deck profile</h3>
                <span class="ov-card-meta">against typical decks</span>
            </div>
            <div id="ov-roles"></div>
        </section>
    </div>

    <section class="ov-section" aria-labelledby="ov-tools-title">
        <div class="ov-section-head">
            <h2 class="ov-section-title" id="ov-tools-title">Calculators for this deck</h2>
            <p class="ov-section-sub" id="ov-tools-sub"></p>
        </div>
        <div class="ov-tools" id="ov-tools"></div>
    </section>
</div>
`;

export const guide = {
    intro: 'The overview reads your whole list and turns it into a handful of plain-language checks, so you can see at a glance where a deck is strong and where it might stumble. Each check links to the calculator that goes deeper.',
    howToRead: [
        '<strong>Green</strong> checks are in the range most decks like this use. <strong>Amber</strong> is worth a look. <strong>Red</strong> means the numbers say this will cost you games.',
        'The <strong>mana curve</strong> counts nonland cards by mana value, coloured by card type.',
        '<strong>Opening hands</strong> shows how many lands your seven-card hand usually has. Two to four is the usual keep range.',
        '<strong>Colours</strong> compares the coloured pips you need with the lands that make them, and checks your hardest-to-cast card of each colour.',
        'Click a bar of the <strong>mana curve</strong> (or use the arrow keys) to list the cards at that mana value; hover a name to see the card.',
        'The <strong>deck profile</strong> puts six numbers against a shaded typical range: speed (average mana value), consistency (keepable opening hands), mana (your weakest colour on curve), ramp, card flow (draw and tutors) and interaction (removal, counterspells and wipes). The ranges are rules of thumb — hover one to see where it comes from. A ramp deck is meant to be slow; read them as context, not grades.',
        'Role counts are detected from rules text. Odd wordings can be missed — use them as a sanity check, not an audit. “Every role, with its cards” lists what was found.'
    ],
    method: 'Every number here is exact. Land and colour odds use the hypergeometric formula over your real card counts; the land target comes from Frank Karsten’s regression over thousands of real decklists (Commander: 31.42 + 3.13 × average mana value − 0.28 × cheap ramp and draw).',
    assumptions: [
        'Commander games: no one skips their first draw and the first mulligan is free. 60- and 40-card formats assume you are on the play unless you switch it.',
        'Colour checks assume you have made every land drop up to the card’s mana value, then ask whether those lands are the right colours (the convention Karsten uses).',
        'Mana value is the printed value; X counts as 0.'
    ],
    terms: ['exact', 'hypergeometric', 'mv', 'pip', 'source', 'oncurve', 'keepable', 'play']
};
