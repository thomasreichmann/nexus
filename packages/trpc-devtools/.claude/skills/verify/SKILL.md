---
name: verify
description: Build, run, and drive trpc-devtools in the Nexus app to verify UI changes at runtime
---

# Verifying trpc-devtools changes

The web app consumes this package's **built dist**, not `src/`. Source edits
are invisible to the running app until you rebuild — this is the #1 gotcha
(a stale dist silently verifies old code):

```bash
pnpm -F trpc-devtools build     # after every src change you want to observe
```

Launch (from repo root; use the worktree's $PORT, not :3000):

```bash
env PORT=$PORT pnpm dev         # background; restart after rebuilding dist
```

Surfaces to drive:

- Embedded component: `http://localhost:$PORT/dev/studio` (SSR — hydration
  mismatches only reproduce here, not on the standalone route)
- Standalone route: `http://localhost:$PORT/api/trpc-devtools` (client-only
  bundle inlined by the route handler; FOUC script, html theme class)

Drive with a Playwright script placed in `apps/web/` and run from there
(`import { chromium } from '@playwright/test'`, `main().catch(...)`). Useful
context options: `colorScheme: 'dark'`, `permissions: ['clipboard-read',
'clipboard-write']` for copy buttons, `context.addCookies` for cookie
export. `debug.random` is a public procedure (no auth) that always succeeds
— good for exercising execute/response flows.

Gotchas:

- Watch `console`/`pageerror` events — React hydration warnings on
  `/dev/studio` are real findings and don't fail the smoke suite when they
  depend on state (e.g. only appear once request history exists).
- UI assertions right after a state change race framer-motion exit
  animations (~150-200ms); use `waitFor({ state: 'hidden' })`, not
  `isVisible()`.
- Delete scratch scripts before committing.
