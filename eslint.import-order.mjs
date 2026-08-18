import importPlugin from 'eslint-plugin-import';

/**
 * Enforces the import order from conventions.md: React → External → Internal
 * (`@/`) → Relative → Types. Shared by every package's flat config so the three
 * of them can't drift.
 *
 * Deliberately does not alphabetize or manage blank lines — the convention only
 * specifies group order, and enforcing more would churn every file in the repo
 * for something nobody agreed to.
 */
export const importOrderConfig = {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    plugins: { import: importPlugin },
    rules: {
        'import/order': [
            'error',
            {
                groups: [
                    ['builtin', 'external'],
                    'internal',
                    ['parent', 'sibling', 'index'],
                    'type',
                ],
                pathGroups: [
                    { pattern: 'react', group: 'external', position: 'before' },
                    {
                        pattern: 'react-dom',
                        group: 'external',
                        position: 'before',
                    },
                    {
                        pattern: 'react-dom/**',
                        group: 'external',
                        position: 'before',
                    },
                    { pattern: '@/**', group: 'internal' },
                ],
                // Default excludes 'external', which would stop the react
                // pathGroups above from ever applying.
                pathGroupsExcludedImportTypes: ['builtin'],
                'newlines-between': 'ignore',
            },
        ],
    },
};
