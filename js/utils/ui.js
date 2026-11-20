/**
 * Small DOM helpers shared by calculators.
 */

/**
 * Synchronize a range slider with a number input
 * @param {string} sliderId - ID of the range slider
 * @param {string} inputId - ID of the number input
 * @param {Function} updateCallback - Callback function to run on change
 */
export function bindInputSync(sliderId, inputId, updateCallback) {
    const slider = document.getElementById(sliderId);
    const input = document.getElementById(inputId);

    if (!slider || !input) return;

    // Slider -> Input
    slider.addEventListener('input', (e) => {
        input.value = e.target.value;
        if (updateCallback) updateCallback(e.target.value);
    });

    // Input -> Slider
    input.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val)) {
            // Respect min/max bounds if set on slider
            const min = slider.min ? parseInt(slider.min) : -Infinity;
            const max = slider.max ? parseInt(slider.max) : Infinity;
            const clamped = Math.max(min, Math.min(val, max));
            
            slider.value = clamped;
            if (updateCallback) updateCallback(clamped);
        }
    });
}
