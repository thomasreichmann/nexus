# Implementation Guide

Specialized scenarios referenced from Step 5 in the main workflow.

## Database Schema Changes

When modifying `server/db/schema.ts`:

```bash
pnpm -F web db:generate   # Generate migration from schema changes
pnpm -F web db:migrate    # Apply pending migrations
```

If migrations fail, show the error and ask the user how to proceed.

For RLS policies or database functions, use `pnpm -F web db:custom <name>` to generate an empty migration file, then edit the SQL manually.

## CSS Variable / Design Token Changes

When changing CSS variables or design tokens, invoke `visual-compare-agent` to visually compare options:

```
Task tool call:
  subagent_type: visual-compare-agent
  max_turns: 20
  prompt: |
    Compare CSS variable options:
    - variable: <variable name>
    - file: <path to CSS file>
    - mode: <light | dark | both>
    - context: <what the variable is used for>
    - autonomous: true

    Remember: complete Step 3 (Sampler Check) before generating options.
```

- Use `autonomous: true` when the change is part of a larger implementation and the agent should pick the best option.
- Use `autonomous: false` when the user should review and choose.

## Smoke Tests for UI Changes

Smoke tests are REQUIRED for any UI changes. They run post-merge in CI, so local verification is critical:

```bash
pnpm -F web test:e2e:smoke
```

New pages need a corresponding smoke test in `apps/web/e2e/smoke/` following the `home.spec.ts` pattern.

## Test Failures During Implementation

If tests fail during implementation:

1. Show the failure output
2. Use AskUserQuestion:
    - **Fix now**: Attempt to fix the failing tests
    - **Continue anyway**: Proceed (note in PR that tests need review)
    - **Abort**: Stop implementation, keep changes uncommitted
