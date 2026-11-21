import js from '@eslint/js';
import globals from 'globals';

// Unused variables are errors everywhere: an unused import or leftover local
// is usually a refactor that stopped half way. Prefix with _ to keep one on
// purpose (an ignored argument, say).
const sharedRules = {
    ...js.configs.recommended.rules,
    'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        varsIgnorePattern: '^_'
    }]
};

export default [
    {
        ignores: [
            'node_modules/**',
            'playwright-report/**',
            'playwright-report-visual/**',
            'test-results/**',
            'coverage/**',
            '_site/**'
        ]
    },
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                Chart: 'readonly'
            }
        },
        rules: sharedRules
    },
    {
        files: ['serverless/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.worker
        },
        rules: sharedRules
    },
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: globals.serviceworker
        },
        rules: sharedRules
    },
    {
        files: [
            'eslint.config.js',
            'playwright.config.js',
            'playwright.visual.config.js',
            'scripts/**/*.mjs',
            'tests/**/*.node.test.js',
            'tests/e2e/**/*.js',
            'tests/visual/**/*.js'
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser
            }
        },
        rules: sharedRules
    }
];
