import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { importOrderConfig } from '../../eslint.import-order.mjs';

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    importOrderConfig,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        ignores: ['dist/**', 'drizzle/**', 'node_modules/**'],
    }
);
