/**
 * Reusable UI Components
 * Creates and manages reusable UI elements
 */

/**
 * Render a single statistic card
 * @param {string} label - Top label (e.g. "Expected Permanents")
 * @param {string} value - Main value (e.g. "4.5")
 * @param {string} subtext - Bottom text (e.g. "played for free")
 * @param {string} color - Color for the value (optional)
 * @returns {string} - HTML string
 */
export function renderStatCard(label, value, subtext, color = 'var(--text-light)') {
    return `
        <div class="stat-card">
            <div style="color: var(--text-dim); font-size: 0.9em; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</div>
            <div style="font-size: 1.8em; font-weight: bold; color: ${color}; line-height: 1.2;">${value}</div>
            <div style="color: var(--text-secondary); font-size: 0.8em;">${subtext}</div>
        </div>
    `;
}

/**
 * Render a grid of stat cards
 * @param {Array<string>} cardsHTML - Array of HTML strings from renderStatCard
 * @returns {string} - HTML string
 */
export function renderStatsGrid(cardsHTML) {
    return `
        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px;">
            ${cardsHTML.join('')}
        </div>
    `;
}

/**
 * Render an insight/interpretation box
 * @param {string} title - Title (e.g. "Analysis")
 * @param {string} content - Main content
 * @param {string} footer - Optional footer text
 * @returns {string} - HTML string
 */
export function renderInsightBox(title, content, footer = '') {
    return `
        <div class="insight-box">
            ${title ? `<h3>${title}</h3>` : ''}
            <div style="margin-bottom: 8px;">${content}</div>
            ${footer ? `<div style="color: var(--text-secondary); font-size: 0.9em; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; margin-top: 8px;">${footer}</div>` : ''}
        </div>
    `;
}

/**
 * Create a collapsible panel
 * @param {string} id - Panel ID
 * @param {string} title - Panel title
 * @param {HTMLElement} content - Content element
 * @param {boolean} startOpen - Whether to start expanded
 * @returns {HTMLElement} - Panel element
 */
export function createCollapsiblePanel(id, title, content, startOpen = true) {
    const panel = document.createElement('section');
    panel.className = `panel collapsible-panel${startOpen ? ' expanded' : ''}`;
    panel.id = id;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `
        <h2>${title}</h2>
        <button class="collapse-btn" aria-label="Toggle section">
            <span class="collapse-icon">${startOpen ? '▼' : '▶'}</span>
        </button>
    `;

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'panel-content';
    contentWrapper.appendChild(content);

    panel.appendChild(header);
    panel.appendChild(contentWrapper);

    // Add click handler
    header.addEventListener('click', () => togglePanel(panel));

    return panel;
}

/**
 * Toggle a collapsible panel
 * @param {HTMLElement} panel - Panel element
 */
export function togglePanel(panel) {
    const isExpanded = panel.classList.contains('expanded');
    const icon = panel.querySelector('.collapse-icon');

    panel.classList.toggle('expanded');
    if (icon) {
        icon.textContent = isExpanded ? '▶' : '▼';
    }

    // Save state to localStorage
    if (panel.id) {
        localStorage.setItem(`panel-${panel.id}`, !isExpanded);
    }
}

/**
 * Restore panel states from localStorage
 */
export function restorePanelStates() {
    document.querySelectorAll('.collapsible-panel').forEach(panel => {
        if (panel.id) {
            const savedState = localStorage.getItem(`panel-${panel.id}`);
            if (savedState === 'false') {
                togglePanel(panel);
            }
        }
    });
}

/**
 * Initialize all collapsible panels
 */
export function initCollapsiblePanels() {
    document.querySelectorAll('.panel-header').forEach(header => {
        header.addEventListener('click', (e) => {
            const panel = header.closest('.collapsible-panel');
            if (panel) {
                togglePanel(panel);
            }
        });
    });

    // Restore saved states
    restorePanelStates();
}

/**
 * Create a type input group (reusable component)
 * @param {string} id - Input ID
 * @param {string} label - Input label
 * @param {number} defaultValue - Default value
 * @returns {HTMLElement} - Type input element
 */
export function createTypeInput(id, label, defaultValue = 0) {
    const div = document.createElement('div');
    div.className = 'type-input';
    div.innerHTML = `
        <label for="${id}">${label}</label>
        <input type="number" id="${id}" value="${defaultValue}" min="0" aria-label="${label}">
    `;
    return div;
}

/**
 * Create a deck total display
 * @param {string} id - Display ID
 * @param {number} initialTotal - Initial total
 * @returns {HTMLElement} - Deck total element
 */
export function createDeckTotal(id, initialTotal = 0) {
    const div = document.createElement('div');
    div.className = 'deck-total';
    div.innerHTML = `
        Total cards in library: <span id="${id}">${initialTotal}</span>
    `;
    return div;
}

/**
 * Auto-collapse config panels on mobile after calculation
 */
export function autoCollapseOnMobile() {
    if (window.innerWidth <= 900) {
        document.querySelectorAll('.collapsible-panel.config').forEach(panel => {
            if (panel.classList.contains('expanded')) {
                togglePanel(panel);
            }
        });

        // Expand results panels
        document.querySelectorAll('.collapsible-panel.results').forEach(panel => {
            if (!panel.classList.contains('expanded')) {
                togglePanel(panel);
            }
        });

        // Scroll to results
        const resultsPanel = document.querySelector('.collapsible-panel.results');
        if (resultsPanel) {
            setTimeout(() => {
                resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
        }
    }
}

/**
 * Generate the HTML for the Sample Reveals section
 * @param {string} prefix - ID prefix (e.g., 'portent')
 * @param {string} title - Section title (e.g., 'Sample Portent Reveals')
 * @param {Object} options - Options { requiresImport: boolean }
 * @returns {string} - HTML string
 */
export function generateSampleRevealsHTML(prefix, title, options = {}) {
    const { requiresImport = true } = options;
    
    return `
        <h2>🎴 ${title}</h2>
        <div style="display: flex; gap: var(--spacing-md); align-items: center; margin-bottom: var(--spacing-md); flex-wrap: wrap;">
            <label for="${prefix}-sample-count" style="color: var(--text-secondary);">Simulations:</label>
            <input type="number" id="${prefix}-sample-count" min="1" max="10000" value="10"
                   style="width: 100px; padding: 8px; background: var(--panel-bg-alt); border: 1px solid var(--accent); border-radius: var(--radius-md); color: var(--text-light); text-align: center;">
            <button id="${prefix}-draw-reveals-btn" class="import-btn run-sim-btn" ${requiresImport ? 'disabled' : ''}>Run Simulations</button>
            ${requiresImport ? `<span class="sim-import-note" style="color: var(--text-dim); font-size: 0.85em; margin-left: 8px;">(Import deck to enable)</span>` : ''}
            <span style="color: var(--text-dim); font-size: 0.85em;">(1-10000)</span>
        </div>
        <div id="${prefix}-reveals-display"></div>
    `;
}
