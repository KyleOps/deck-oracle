import { defineConfig } from '@playwright/test';

// PW_PORT lets several checkouts (git worktrees) run the browser suite at the
// same time without one checkout's server answering another's tests.
const port = Number(process.env.PW_PORT) || 4173;
const baseURL = `http://127.0.0.1:${port}`;

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
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        { name: 'e2e', testIgnore: '**/performance.spec.js' },
        // Budgets measure time, so they run alone: after the functional tests
        // (never alongside them), one test at a time. To run only these:
        // npx playwright test --project=performance --no-deps
        {
            name: 'performance',
            testMatch: '**/performance.spec.js',
            dependencies: ['e2e'],
            fullyParallel: false
        }
    ],
    webServer: {
        command: `npx http-server . -p ${port} -c-1 -s`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe'
    }
});
