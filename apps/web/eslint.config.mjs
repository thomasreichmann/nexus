import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
        // Generated coverage output
        'coverage/**',
    ]),
    // Ban direct pino imports in routers - use ctx.log instead
    {
        files: ['**/server/trpc/routers/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'pino',
                            message:
                                'Use ctx.log instead of importing pino directly.',
                        },
                    ],
                    patterns: [
                        {
                            group: ['**/server/lib/logger*'],
                            message:
                                'Use ctx.log instead of importing logger directly.',
                        },
                    ],
                },
            ],
        },
    },
    // Enforce service import pattern - import from specific service files, not barrel
    {
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@/server/services',
                            message:
                                'Import from specific service file: @/server/services/files, not @/server/services',
                        },
                    ],
                    patterns: [
                        {
                            group: [
                                '@/server/services/index',
                                '**/server/services/index',
                            ],
                            message:
                                'Import from specific service file: @/server/services/files, not @/server/services/index',
                        },
                    ],
                },
            ],
        },
    },
    // Ban barrel re-exports in services - each service should export its own namespace
    {
        files: ['**/server/services/**/*.ts'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'ExportAllDeclaration',
                    message:
                        'Barrel re-exports are banned in services. Export a namespace object instead: export const myService = { ... } as const',
                },
            ],
        },
    },
]);

export default eslintConfig;
