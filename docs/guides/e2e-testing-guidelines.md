---
title: E2E Testing Guidelines
created: 2026-03-07
updated: 2026-03-07
status: active
tags:
    - guide
    - testing
    - playwright
    - e2e
aliases:
    - E2E Testing Guide
    - Playwright Guidelines
---

# E2E Testing Guidelines

Decision framework for when AI agents should write Playwright E2E tests vs rely on smoke tests + unit tests.

## Decision Framework

| Question                                            | If YES          | If NO        |
| --------------------------------------------------- | --------------- | ------------ |
| Does the feature have multi-step user interactions? | E2E test        | Smoke + unit |
| Does it depend on auth guards or role-based access? | E2E test        | Smoke + unit |
| Does it filter, paginate, or sort server data?      | E2E test        | Smoke + unit |
| Does the page require authentication to render?     | Auth smoke test | —            |
| Is it a new page with no interactivity?             | Smoke test only | —            |
| Is it a pure utility or business logic function?    | Unit test only  | —            |

**Default: smoke test + unit tests.** Only add targeted E2E tests when the interaction complexity makes unit tests fundamentally insufficient.

## When E2E Tests Add Value

Write a Playwright E2E test when the feature involves:

- **Auth guards** — Verifying redirects, role-based access control, protected routes
- **Data-driven UI** — Filtering, pagination, sorting with real server data
- **Multi-step flows** — Wizards, multi-step forms, sequential user actions
- **Interactive state changes** — Retry buttons, status transitions, optimistic updates
- **Cross-component coordination** — Actions in one component affecting another

**Prior art:** `apps/web/e2e/admin/jobs.spec.ts` — tests auth guards, status filtering, pagination, and retry actions on the admin jobs dashboard.

## When Smoke + Unit Tests Are Sufficient

Don't write E2E tests for:

- **Static pages** — Landing pages, about pages, documentation views
- **Simple forms** — Single-step forms with basic validation (unit test the schema)
- **Display-only components** — Cards, lists, dashboards that just render data
- **Pure logic** — Utilities, formatters, validators (unit test these)
- **Layout changes** — Header, sidebar, footer updates

Smoke tests already verify these pages render without console errors. For authenticated pages, use the `authenticated` fixture in `e2e/smoke-auth/` (see [[../conventions/testing|Testing Conventions]]).

## Writing & Running Tests

See [[../conventions/testing|Testing Conventions]] for test structure patterns, helpers, gotchas, and run commands.

## Related

- [[../conventions/testing|Testing Conventions]] - Smoke test patterns, auth setup, unit test guidance
- [[../ai/conventions|Code Conventions]] - Project-wide conventions reference
