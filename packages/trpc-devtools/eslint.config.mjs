import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { importOrderConfig } from '../../eslint.import-order.mjs';

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    importOrderConfig,
    {
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            // Allow unused vars with underscore prefix
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**'],
    }
);
