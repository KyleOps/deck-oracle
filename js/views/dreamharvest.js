/**
 * dreamharvest — calculator view.
 * Mounted into #dreamharvest-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Dream Harvest Calculator</h1>
<p class="card-text">"Each opponent exiles until total MV reaches 5 or greater..."</p>

<div class="main-grid single-column">
    <section class="panel" id="dreamharvest-results" aria-label="Dream Harvest analysis">
        <h2>Results</h2>
        <p style="color: var(--text-dim); text-align: center; padding: 20px;">
            Import at least one opponent's decklist to see analysis.
        </p>
    </section>

    <section class="panel" id="dreamharvest-sample-reveals" aria-label="Sample reveals">
        <h2>Sample Reveals</h2>
        <p style="color: var(--text-dim); text-align: center; padding: 20px;">
            Import opponent decklists to see sample simulations.
        </p>
    </section>
</div>
`;
