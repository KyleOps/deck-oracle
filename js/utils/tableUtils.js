/**
 * Table Rendering Utilities
 * Shared functions for creating and rendering consistent comparison tables
 */

/**
 * Render a multi-column comparison table to a DOM element
 * @param {string} elementId - ID of the container element
 * @param {Array<string>} headers - Array of header text
 * @param {Array<Array<string|number|Object>>} rows - Array of rows, where each cell can be a value or {value, class}
 * @param {Object} options - formatting options (highlightRowIndex, tableClass)
 */
export function renderMultiColumnTable(elementId, headers, rows, options = {}) {
    const container = document.getElementById(elementId);
    if (!container) return;

    const { highlightRowIndex = -1, tableClass = 'comparison-table' } = options;

    let html = `<table class="${tableClass}">`;
    
    // Header
    html += '<thead><tr>';
    headers.forEach(header => {
        if (typeof header === 'object' && header !== null) {
            html += `<th class="${header.class || ''}">${header.text}</th>`;
        } else {
            html += `<th>${header}</th>`;
        }
    });
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    rows.forEach((row, index) => {
        // Determine row class
        let rowClass = index === highlightRowIndex ? 'current' : '';
        
        // Check if row has custom class in its metadata (if row is passed as object with data)
        // For simplicity, we assume row is array of cells. If you need row-level data, 
        // we can check if the first cell or a special property indicates it.
        // For now, let's stick to array of cells.

        // Allow entire row to be an object { cells: [], class: '...' }
        let cells = row;
        if (!Array.isArray(row) && row.cells) {
            cells = row.cells;
            if (row.class) rowClass += ` ${row.class}`;
        }

        html += `<tr class="${rowClass.trim()}">`;
        
        cells.forEach(cell => {
            let value = cell;
            let cellClass = '';
            
            // Allow cell to be { value: '...', class: '...' }
            if (cell !== null && typeof cell === 'object' && cell.value !== undefined) {
                value = cell.value;
                cellClass = cell.class || '';
            }
            
            html += `<td class="${cellClass}">${value}</td>`;
        });
        
        html += '</tr>';
    });
    html += '</tbody></table>';

    container.innerHTML = html;
}

/**
 * Clear a table container
 * @param {string} elementId - ID of table container
 */
export function clearTable(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = '';
    }
}
