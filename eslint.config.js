import js from '@eslint/js';
import globals from 'globals';

const sharedRules = {
    ...js.configs.recommended.rules,
    // Unused-variable cleanup is tracked separately from this first correctness
    // gate so legacy warnings do not bury actionable failures in CI.
    'no-unused-vars': 'off'
};

const strictUnusedVars = ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        varsIgnorePattern: '^_'
    }];

export default [
    {
        ignores: [
            'node_modules/**',
            'playwright-report/**',
            'test-results/**'
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
            'tests/**/*.node.test.js',
            'tests/e2e/**/*.js'
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
    },
    {
        files: [
            'eslint.config.js',
            'playwright.config.js',
            'tests/e2e/**/*.js',
            'js/main.js',
            'js/utils/calculatorBase.js',
            'js/utils/calculatorRegistry.js'
        ],
        rules: {
            'no-unused-vars': strictUnusedVars
        }
    }
];
