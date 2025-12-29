---
title: Useful Prompts
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
    - ai
    - prompts
    - workflow
aliases:
    - Prompt Templates
    - AI Prompts
ai_summary: 'Copy-paste prompts for common development tasks'
---

# Useful Prompts

Prompt templates for common development tasks. Copy and customize as needed.

## Feature Implementation

### New Feature

```
Implement [feature name] for Nexus.

Requirements:
- [requirement 1]
- [requirement 2]

Follow the patterns in docs/ai/patterns.md.
Use Server Components where possible.
Add proper error handling.
Update docs/ai/changelog.md when done.
```

### New Component

```
Create a [ComponentName] component that [description].

Props:
- prop1: type - description
- prop2: type - description

Follow conventions in docs/ai/conventions.md.
Put in components/features/ if feature-specific, components/ui/ if reusable.
```

### New Server Action

```
Create a Server Action to [description].

Input: [describe input]
Output: [describe output]

Include:
- Zod validation
- Auth check
- Error handling
- Path revalidation

Follow the Server Action pattern in docs/ai/patterns.md.
```

## Bug Fixes

### Debug Issue

```
There's an issue with [description].

Expected: [expected behavior]
Actual: [actual behavior]

Investigate and fix. Explain what caused the issue.
```

### Fix Type Error

```
Fix the TypeScript error in [file]:

[paste error]

Don't use `any` - find the correct type.
```

## Code Review

### Review PR

```
Review this code for:
- TypeScript correctness
- Error handling
- Security issues
- Performance concerns
- Adherence to project conventions (see docs/ai/conventions.md)

[paste code or describe changes]
```

### Refactor Code

```
Refactor [file/component] to:
- [improvement 1]
- [improvement 2]

Keep functionality the same.
Follow existing patterns.
```

## Database

### Add Database Table

```
Add a new table [table_name] to Supabase with:
- [column1]: type
- [column2]: type

Include:
- RLS policies for user access
- Indexes for common queries
- TypeScript types in types/
```

### Add Database Query

```
Add a query function to get [description].

Put in lib/supabase/queries.ts.
Include proper typing and error handling.
Follow the Supabase Query pattern in docs/ai/patterns.md.
```

## Documentation

### Document Feature

```
Document [feature] for the docs.

Include:
- What it does
- How to use it
- Code examples
- Edge cases

Put in appropriate docs/ folder.
Use Obsidian conventions (wikilinks, callouts).
```

### Write ADR

```
Write an ADR for the decision to use [choice] for [problem].

Include:
- Context (why we needed to decide)
- Options considered
- Decision and rationale
- Consequences

Use the ADR template in docs/templates/adr-template.md.
Save as docs/decisions/[NNN]-[description].md.
```

## Testing

### Write Tests

```
Write tests for [file/component].

Test:
- Happy path
- Error cases
- Edge cases

Use Playwright for E2E, Vitest for unit tests.
```

## API

### Add API Route

```
Add an API route for [description].

Endpoint: [METHOD] /api/[path]
Input: [describe]
Output: [describe]

Include auth check, validation, error handling.
Follow API Route pattern in docs/ai/patterns.md.
```

## Stripe

### Add Subscription Feature

```
Implement [subscription feature] with Stripe.

Include:
- Checkout flow
- Webhook handling
- Subscription status sync

Use Stripe best practices.
```

## S3

### Add S3 Operation

```
Add S3 operation for [description].

Include:
- Presigned URL handling
- Error handling
- Proper content types

Put in lib/s3/.
```

## Ending Session

### Update Changelog

```
Update docs/ai/changelog.md with today's changes:
- What was created/modified
- Why the changes were made
- Any notes for future sessions
```

## Tips for Better Prompts

1. **Be specific** - Include file paths, expected behavior
2. **Reference docs** - Point to patterns.md, conventions.md
3. **State constraints** - What NOT to do
4. **Request changelog update** - Maintain context for future sessions

## Related

- [[patterns|Code Patterns]] - Implementation templates
- [[conventions|Conventions]] - Style rules
- [[ai/_index|Back to AI Docs]]
