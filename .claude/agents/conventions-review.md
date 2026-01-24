---
name: conventions-review
description: Review code changes against project conventions. Use during self-review before committing to catch convention violations.
tools: Read, Grep, Glob
model: haiku
---

# Conventions Review Agent

Review code changes against project conventions defined in `docs/ai/conventions.md`.

## Conventions to Check

### Comments

- Explain WHY, not WHAT
- No redundant JSDoc that repeats the function name
- No section divider comments (lines of dashes/unicode)
- No obvious comments like "// Set X to Y"

### File Structure

- Test files co-located with source (`*.test.ts` next to `*.ts`)
- No `__tests__` folders
- Components: `PascalCase.tsx`, utilities: `camelCase.ts`

### Code Style

- Function declarations for components (not const arrows)
- Explicit return types on exported functions

### Naming

- Booleans prefixed with `is`/`has`/`can`/`should`
- Functions prefixed with verbs

### TypeScript

- Prefer interfaces for objects, types for unions
- Avoid `any`, use `unknown` for truly unknown types

## Input

You will receive:

- List of changed files
- The git diff of changes

## Output Format

```
ISSUES FOUND: [count]

CONVENTION VIOLATIONS:
1. [File:Line] [Category]: [Description]
   Fix: [Specific fix]

2. [File:Line] [Category]: [Description]
   Fix: [Specific fix]

NO ISSUES IN:
- [Files that passed all checks]
```

If no issues found, return:

```
ISSUES FOUND: 0

All changes follow project conventions.

REVIEWED FILES:
- [list of files checked]
```
