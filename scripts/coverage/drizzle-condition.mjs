/**
 * The `DrizzleCondition` mutator (#524): a query that has lost one of its
 * conditions, the #489 bug class, which no built-in Stryker mutator makes.
 *
 * - One term of a Drizzle `and(…)` / `or(…)` dropped, one mutant per term.
 *   Only calls with two or more terms, and only an `and` / `or` imported
 *   from drizzle-orm (a local function of that name isn't one). A nested
 *   call gets its own mutants.
 * - A query builder's `.where(…)` dropped: `db.update(t).set(…).where(x)`
 *   runs as `db.update(t).set(…)`. Only chains through `.update(`,
 *   `.delete(` or `.from(`, so a partial index's `.where` in the schema
 *   isn't one.
 *
 * Both drop by replacing the term, or the `.where`'s argument, with
 * `undefined`: drizzle-orm leaves `undefined` out of `and` / `or`, and
 * `.where(undefined)` builds no WHERE. So the mutant sits on the dropped
 * condition's own line, and a survivor reads as that condition.
 *
 * A NodeMutator as `@stryker-mutator/instrumenter` defines it; how it gets
 * into Stryker's run: `stryker-plugin.mjs`. Editing this file re-measures
 * every cached `pnpm mutate` result.
 */

export const NAME = 'DrizzleCondition';

const COMBINATORS = new Set(['and', 'or']);
// A `.where(…)` whose receiver chain calls one of these is a query builder's.
const QUERY_ROOTS = new Set(['update', 'delete', 'from']);

export const drizzleConditionMutator = {
    name: NAME,
    *mutate(path) {
        if (path.listKey !== 'arguments' || path.isSpreadElement()) return;
        if (path.isIdentifier({ name: 'undefined' })) return;
        const call = path.parentPath;
        if (!call.isCallExpression()) return;
        const args = call.node.arguments;
        if (
            (args.length >= 2 && isDrizzleCombinator(call)) ||
            (args.length === 1 && isBuilderWhere(call.node.callee))
        )
            yield { type: 'Identifier', name: 'undefined' };
    },
};

function isDrizzleCombinator(call) {
    const { callee } = call.node;
    if (callee.type !== 'Identifier') return false;
    const binding = call.scope.getBinding(callee.name);
    if (binding?.kind !== 'module' || !binding.path.isImportSpecifier())
        return false;
    const { imported } = binding.path.node;
    const name =
        imported.type === 'Identifier' ? imported.name : imported.value;
    const source = binding.path.parent.source.value;
    return COMBINATORS.has(name) && /^drizzle-orm(\/|$)/.test(source);
}

function isBuilderWhere(callee) {
    if (!isMethod(callee)) return false;
    if (callee.property.name !== 'where') return false;
    for (let node = callee.object; node.type === 'CallExpression'; ) {
        if (!isMethod(node.callee)) return false;
        if (QUERY_ROOTS.has(node.callee.property.name)) return true;
        node = node.callee.object;
    }
    return false;
}

/** `x.name` or `x?.name`, not `x[name]`. */
function isMethod(node) {
    return (
        (node.type === 'MemberExpression' ||
            node.type === 'OptionalMemberExpression') &&
        !node.computed &&
        node.property.type === 'Identifier'
    );
}
