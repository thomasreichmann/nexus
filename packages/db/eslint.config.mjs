import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { importOrderConfig } from '../../eslint.import-order.mjs';

/**
 * No fake DB in this package's tests (#496). Everything in packages/db is data
 * access (the architecture puts query code here and nowhere else), so every
 * test in it runs against a real Postgres. A mocked Drizzle chain answers
 * whatever the test told it to, so it can't see a dropped WHERE condition: on
 * the 2026-09-28 audit, repository tests on `createMockDb` killed 36% of
 * mutants, and every survivor changed which rows a query touches (#489).
 *
 * Tests elsewhere that hand a service a mock db while mocking its
 * repositories are fine, and out of this rule's reach.
 */
const NO_FAKE_DB_MESSAGE =
    'Repository and query code is tested against a real Postgres, never a mocked DB (#496). Write a *.integration.test.ts on the fixtures from `@nexus/db/test-db/integration` (`db`, `user`, `createUser`): see "Integration Tests (real database)" in docs/conventions/testing.md.';

// Written before #496 and migrated by #489, which removes each entry as it
// goes. The list must end empty; nothing new is added to it.
const FAKE_DB_EXEMPT = [
    'src/repositories/files.test.ts', // #489
    'src/repositories/invites.test.ts', // #489
    'src/repositories/jobs.test.ts', // #489
    'src/repositories/retrievals.test.ts', // #489
    'src/repositories/storage-usage.test.ts', // #489
];

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
        files: ['src/**/*.test.ts'],
        ignores: FAKE_DB_EXEMPT,
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@nexus/db/testing',
                            message: NO_FAKE_DB_MESSAGE,
                        },
                    ],
                    patterns: [
                        {
                            // The fake itself (repositories/mocks.ts) and the
                            // `testing` entrypoint that re-exports it.
                            regex: '^\\.{1,2}/(.*/)?(mocks|testing)$',
                            message: NO_FAKE_DB_MESSAGE,
                        },
                    ],
                },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    // vi.mock / vi.doMock of the connection, the package, or
                    // the drivers underneath: a fake DB by another route.
                    selector:
                        "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/][arguments.0.value=/^(@nexus\\/db(\\/.*)?|postgres|drizzle-orm(\\/.*)?|\\.{1,2}\\/(.*\\/)?(connection|index))$/]",
                    message: NO_FAKE_DB_MESSAGE,
                },
            ],
        },
    },
    {
        ignores: ['dist/**', 'drizzle/**', 'node_modules/**'],
    }
);
