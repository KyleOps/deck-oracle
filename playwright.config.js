import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never' }]]
        : 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    webServer: {
        command: 'npm run serve:test',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe'
    }
});
