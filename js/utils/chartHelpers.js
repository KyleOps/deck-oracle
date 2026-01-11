/**
 * Chart.js Helper Utilities
 * Standardizes chart creation and updates across all calculators.
 */
import { getChartAnimationConfig } from './simulation.js';

/**
 * Create or update a Chart.js instance.
 * @param {Object} chartInstance - The existing Chart instance (or null/undefined).
 * @param {string} canvasId - The ID of the canvas element.
 * @param {Object} config - The chart configuration object (type, data, options).
 * @returns {Object} - The created or updated Chart instance.
 */
export function createOrUpdateChart(chartInstance, canvasId, config) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    if (!chartInstance) {
        // Create new chart
        // Merge default animation config into options
        const defaultAnimation = getChartAnimationConfig();
        const options = {
            ...defaultAnimation,
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            ...config.options, // User options override defaults
            plugins: {
                legend: { display: false },
                ...config.options?.plugins
            },
            scales: {
                x: {
                    grid: { color: 'rgba(128, 128, 128, 0.1)' },
                    ticks: { color: '#a09090' },
                    ...config.options?.scales?.x
                },
                ...config.options?.scales
            }
        };

        return new Chart(ctx, {
            type: config.type || 'line',
            data: config.data,
            options: options
        });
    } else {
        // Update existing chart
        // Perform surgical update to maintain animation smoothness
        
        // Update labels
        if (config.data.labels) {
            chartInstance.data.labels = config.data.labels;
        }

        // Update datasets
        if (config.data.datasets) {
            config.data.datasets.forEach((newDataset, i) => {
                const existingDataset = chartInstance.data.datasets[i];
                if (existingDataset) {
                    // Update properties in place
                    Object.assign(existingDataset, newDataset);
                } else {
                    // New dataset found (unexpected for these calculators but handled)
                    chartInstance.data.datasets.push(newDataset);
                }
            });
            
            // Handle removed datasets if any
            if (chartInstance.data.datasets.length > config.data.datasets.length) {
                chartInstance.data.datasets.length = config.data.datasets.length;
            }
        }

        // Note: We deliberately do NOT update chartInstance.options here to preserve 
        // animation state and prevent full re-renders. 
        // If dynamic option updates are needed, we can add a flag later.

        chartInstance.update();
        return chartInstance;
    }
}
