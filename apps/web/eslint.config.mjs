import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tailwindPlugin from 'eslint-plugin-better-tailwindcss';

// Convention: "Main export first, helper components below" (conventions.md)
const localPlugin = {
    meta: { name: 'local' },
    rules: {
        'export-default-first': {
            meta: {
                type: 'suggestion',
                fixable: 'code',
                schema: [],
                docs: {
                    description:
                        'Default export must appear before helper functions',
                },
                messages: {
                    before: 'Helper function "{{ name }}" should appear below the default export. Convention: main export first, helpers below.',
                },
            },
            create(context) {
                let defaultExportNode = null;
                const helpers = [];

                return {
                    ExportDefaultDeclaration(node) {
                        defaultExportNode = node;
                    },
                    'Program > FunctionDeclaration:not([parent.type="ExportDefaultDeclaration"]):not([parent.type="ExportNamedDeclaration"])'(
                        node
                    ) {
                        helpers.push(node);
                    },
                    'Program:exit'() {
                        if (defaultExportNode === null) return;
                        const src = context.sourceCode;
                        const fullText = src.getText();

                        // Collect all helpers that appear before the default export
                        const violators = helpers.filter(
                            (fn) => fn.range[0] < defaultExportNode.range[0]
                        );
                        if (violators.length === 0) return;

                        // Report on the first violator with a single consolidated fix
                        context.report({
                            node: violators[0],
                            messageId: 'before',
                            data: {
                                name: violators[0].id?.name ?? 'anonymous',
                            },
                            fix(fixer) {
                                const ops = [];
                                const insertParts = [];

                                for (const fn of violators) {
                                    const comments = src.getCommentsBefore(fn);
                                    const start =
                                        comments.length > 0
                                            ? comments[0].range[0]
                                            : fn.range[0];
                                    const end = fn.range[1];

                                    // Consume trailing whitespace, capped at one blank line (2 newlines)
                                    let removeEnd = end;
                                    let newlineCount = 0;
                                    while (
                                        removeEnd < fullText.length &&
                                        newlineCount < 2
                                    ) {
                                        const ch = fullText[removeEnd];
                                        if (ch === '\n') {
                                            newlineCount++;
                                            removeEnd++;
                                        } else if (
                                            ch === '\r' ||
                                            ch === ' ' ||
                                            ch === '\t'
                                        ) {
                                            removeEnd++;
                                        } else {
                                            break;
                                        }
                                    }

                                    ops.push(
                                        fixer.removeRange([start, removeEnd])
                                    );
                                    insertParts.push(
                                        fullText.slice(start, end)
                                    );
                                }

                                ops.push(
                                    fixer.insertTextAfter(
                                        defaultExportNode,
                                        '\n\n' + insertParts.join('\n\n')
                                    )
                                );
                                return ops;
                            },
                        });

                        // Report remaining violators without a fix (so they show in lint output)
                        for (let i = 1; i < violators.length; i++) {
                            context.report({
                                node: violators[i],
                                messageId: 'before',
                                data: {
                                    name: violators[i].id?.name ?? 'anonymous',
                                },
                            });
                        }
                    },
                };
            },
        },
    },
};

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
    // Router files: also ban direct pino/logger imports (merged with service barrel ban
    // since flat config replaces, not merges, the same rule for overlapping file globs)
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
                        {
                            name: '@/server/services',
                            message:
                                'Import from specific service file: @/server/services/files, not @/server/services',
                        },
                    ],
                    patterns: [
                        {
                            group: ['**/server/lib/logger*'],
                            message:
                                'Use ctx.log instead of importing logger directly.',
                        },
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
    // Default export first in component files (conventions.md §Component Structure)
    {
        files: ['**/*.tsx'],
        plugins: { local: localPlugin },
        rules: {
            'local/export-default-first': 'warn',
        },
    },
    // Enforce canonical Tailwind class order
    {
        files: ['**/*.tsx'],
        plugins: { 'better-tailwindcss': tailwindPlugin },
        rules: {
            'better-tailwindcss/enforce-canonical-classes': [
                'warn',
                { entryPoint: 'app/globals.css' },
            ],
            'better-tailwindcss/no-duplicate-classes': [
                'warn',
                { entryPoint: 'app/globals.css' },
            ],
            'better-tailwindcss/no-conflicting-classes': [
                'warn',
                { entryPoint: 'app/globals.css' },
            ],
            'better-tailwindcss/no-unnecessary-whitespace': [
                'warn',
                { entryPoint: 'app/globals.css' },
            ],
            'better-tailwindcss/no-deprecated-classes': [
                'warn',
                { entryPoint: 'app/globals.css' },
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
