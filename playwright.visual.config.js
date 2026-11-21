import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

/**
 * Screenshot comparisons, kept out of `npm run test:e2e`.
 *
 *   npm run test:visual           compare against the committed baselines
 *   npm run test:visual:update    rewrite the baselines for this platform
 *
 * Baselines are per platform because font rendering differs between
 * operating systems; only `linux/` is committed (CI and the "Update visual
 * baselines" workflow both run on ubuntu-latest). CI runs this suite only
 * once tests/visual/__screenshots__/linux/ exists. See README → Development.
 */
export default defineConfig({
    ...base,
    testDir: './tests/visual',
    outputDir: 'test-results/visual',
    snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-visual' }]]
        : 'list',
    expect: {
        toHaveScreenshot: {
            // An absolute pixel count, not a ratio: on a 3,000 px tall page a
            // 0.2% ratio let a misplaced sticky top bar (1,306 px) through.
            // Chromium rasterises a few glyphs slightly differently from run
            // to run, even with the flags below, one worker and a page left
            // idle: each page flips between a few fixed states. Measured over
            // 192 Linux captures (CI runner, Chromium for Playwright 1.65) and
            // 168 on Windows, the largest was 187 px. A single raster thread
            // made no difference on Linux. 300 px absorbs that noise and
            // still fails any layout, spacing or colour change.
            maxDiffPixels: 300,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css'
        }
    },
    use: {
        ...base.use,
        // Rasterise text and colour the same way on every run.
        launchOptions: {
            args: [
                '--font-render-hinting=none',
                '--disable-lcd-text',
                '--disable-font-subpixel-positioning',
                '--disable-gpu',
                '--force-color-profile=srgb'
            ]
        }
    },
    projects: [
        {
            name: 'desktop',
            use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
        },
        {
            name: 'phone',
            use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
        }
    ]
});
