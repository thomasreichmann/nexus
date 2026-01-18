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
]);

export default eslintConfig;
