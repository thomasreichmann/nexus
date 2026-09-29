/**
 * Adds `pnpm mutate`'s own mutators (`drizzle-condition.mjs`) to Stryker's
 * run. Stryker 10 has no mutator plugin kind, so this is an Ignore plugin
 * that `mutation.mjs` names in `ignorers`:
 *
 * - Stryker creates ignorers in its main process right before it
 *   instruments the files. Creating this one appends the mutators to the
 *   instrumenter's built-in list (`allMutators`, which it reads for every
 *   file), and it ignores nothing.
 * - Stryker only warns when a plugin module fails to load, but a missing
 *   ignorer is fatal, and so is a list this can't find: the run fails
 *   instead of quietly measuring without these mutants.
 *
 * Stryker's worker processes import this file too; they never create the
 * ignorer, so loading the list there is wasted but harmless.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NAME, drizzleConditionMutator } from './drizzle-condition.mjs';

// The list as loaded by the @stryker-mutator/core this repo runs: the same
// path, so the same module instance.
let builtIns;
let loadError;
try {
    const core = createRequire(import.meta.url).resolve(
        '@stryker-mutator/core/package.json'
    );
    const instrumenter = dirname(
        createRequire(core).resolve(
            '@stryker-mutator/instrumenter/package.json'
        )
    );
    ({ allMutators: builtIns } = await import(
        pathToFileURL(join(instrumenter, 'dist/src/mutators/index.js')).href
    ));
    if (
        !Array.isArray(builtIns) ||
        !builtIns.some((m) => m?.name === 'MethodExpression')
    )
        throw new Error("it isn't the list of built-in mutators");
} catch (error) {
    loadError = error;
}

function register() {
    if (loadError)
        throw new Error(
            `${NAME}: can't add the mutator to @stryker-mutator/instrumenter's \`allMutators\` (dist/src/mutators/mutate.js); did a Stryker upgrade move it? See scripts/coverage/stryker-plugin.mjs. ${loadError.message}`
        );
    if (!builtIns.includes(drizzleConditionMutator))
        builtIns.push(drizzleConditionMutator);
    return { shouldIgnore: () => undefined };
}
register.inject = [];

// Named after the mutator: `mutation.mjs` lists `NAME` in `ignorers`.
export const strykerPlugins = [
    { kind: 'Ignore', name: NAME, factory: register },
];
