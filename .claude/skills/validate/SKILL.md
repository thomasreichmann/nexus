---
name: validate
description: End-to-end validate a merged PR or feature against the dev environment — UI + DB assertions with screenshots
argument-hint: [PR number, commit, or free-form description] (optional)
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Task, AskUserQuestion
---

# Validate

Drive a merged change through real UI + DB to confirm it works end-to-end. Catches regressions that unit tests and CI smoke tests miss (real S3, real Supabase, real auth, real browser).

Use this **after** a PR has merged and you want eyes-on confirmation before the next deploy or before declaring the feature shipped. Not a substitute for unit/integration tests.

## Dynamic Context

**Most recent merge on main:**
!`git log -1 --pretty=format:'%h %s%n%b' origin/main 2>/dev/null | head -20 || git log -1 --pretty=format:'%h %s' 2>/dev/null`

**Files changed in last merge:**
!`git diff --name-only HEAD~1..HEAD 2>/dev/null | head -40 || echo "(no diff)"`

## Arguments

**Scope hint:** $ARGUMENTS — may be a PR number, commit SHA, or free-form description ("the new upload-batches flow"). If empty, default to the last merge on main shown above.

## When NOT to use this

- **Pure backend changes with no user-visible surface.** Static analysis + unit tests are enough; don't spin up Playwright for invisible code.
- **Trivial changes.** A typo fix doesn't need an e2e harness.
- **Pre-merge.** This is post-merge validation against shipped code. Use the regular test suite during development.

If unsure, surface the question to the user before writing tests.

## Step 1: Determine Scope

Resolve `$ARGUMENTS` to a concrete set of changes:

- **PR number** (e.g. `224`): `gh pr view 224 --json title,body,files`, then `git show <merge-commit>` or `git diff <base>..<head>` for the diff.
- **Commit SHA**: `git show <sha> --stat` and `git log -1 --pretty=full <sha>`.
- **Free-form description**: grep the codebase for keywords; ask user to clarify if ambiguous.
- **Empty**: use the last merge on main (shown in Dynamic Context above).

Read the PR body / commit message thoroughly — the "why" tells you what to validate, not just the "what".

## Step 2: Propose Test Items

Identify what's at risk, then group into validation items. Categories to consider:

1. **UI golden paths that silently switched implementations.** A code path the user still clicks the same way, but the backend now does something different (new schema, new s3 shape, new helper). These are the highest-value items.
2. **Old data still works.** When a schema or format changed, confirm pre-change rows still flow through. Often answerable by static analysis — check whether the new code parses the changed field or treats it as opaque. If opaque, drop the test.
3. **Dashboard / aggregate read paths.** If usage counters or aggregate queries changed source-of-truth, verify the dashboard reflects the new source.
4. **Boundary cases the change introduced.** New quota thresholds, new soft caps, new warning bands — confirm they trigger correctly.
5. **DB sanity.** Schema present, migrations applied, data invariants hold (no drift between source-of-truth and aggregates).

**Drop items aggressively.** Three high-leverage tests beat seven low-leverage ones. Justify drops out loud ("opaque field, no parsing, skipped").

**Present the list to the user via `AskUserQuestion`** before writing anything. Single-select if the user wants one item at a time, multi-select if they want a batch. Include "all of them" as an option when reasonable.

Then create `TaskCreate` entries — one per validation item plus one for cleanup. Mark `in_progress` as you start each.

## Step 3: DB Sanity (do this first)

It's the cheapest and the most informative — tells you whether the migration even ran. Write a temp tsx script:

**File:** `apps/web/scripts/temp-validate-<slug>.ts`

```ts
import postgres from 'postgres';
import { config } from 'dotenv';
import { PLAN_LIMITS } from '@nexus/db/plans';

config({ path: '.env.local' });
const sql = postgres(process.env.DATABASE_URL!);

async function main() {
    // 1. Schema check — confirm new columns/tables exist
    const cols = await sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = '<new-or-changed-table>'
        ORDER BY ordinal_position
    `;
    console.log(cols);

    // 2. Migration applied
    const mig = await sql`
        SELECT hash, created_at
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at DESC LIMIT 5
    `;
    console.log(mig);

    // 3. Drift check — if a source-of-truth column was introduced, confirm it
    //    matches the legacy aggregate for all users.
    const drift = await sql`<aggregation comparing new vs legacy source>`;
    console.log(drift.length === 0 ? 'OK no drift' : drift);

    await sql.end();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
```

Run: `pnpm tsx apps/web/scripts/temp-validate-<slug>.ts`

If sanity passes, move on. If it fails, stop and figure out why — the rest of the work is meaningless until the DB is in the expected state.

## Step 4: UI Validation Spec

**File:** `apps/web/e2e/smoke/_temp-validate-<slug>.spec.ts`

Required patterns (these are not negotiable — they're what made it work in real runs):

```ts
import { test, expect } from '../fixtures/authenticated';
import { findUserByEmail, getDb } from '../helpers/db';
import { REGULAR_USER } from '../helpers/auth';
import { PLAN_LIMITS } from '@nexus/db/plans';

// State is shared across tests (single user, single storage_usage row).
// Run serially so test #N's setup doesn't pollute test #M.
test.describe.configure({ mode: 'serial' });
test.use({ userRole: 'user' });

const SCREENSHOTS = 'test-results/temp-validate-<slug>';

async function getUserId(): Promise<string> {
    const u = await findUserByEmail(REGULAR_USER.email);
    if (!u) throw new Error(`regular user missing: ${REGULAR_USER.email}`);
    return u.id;
}

// Reset all user state to a deterministic baseline.
async function cleanupForUser(userId: string): Promise<void> {
    const sql = getDb();
    await sql`DELETE FROM files WHERE user_id = ${userId}`;
    await sql`DELETE FROM upload_batches WHERE user_id = ${userId}`;
    await sql`
        INSERT INTO storage_usage (id, user_id, used_bytes, file_count)
        VALUES (gen_random_uuid()::text, ${userId}, 0, 0)
        ON CONFLICT (user_id) DO UPDATE SET used_bytes = 0, file_count = 0, updated_at = now()
    `;
}

test.describe('<feature> validation', () => {
    test.beforeAll(async () => {
        await cleanupForUser(await getUserId());
    });
    test.afterAll(async () => {
        await cleanupForUser(await getUserId());
        await getDb().end({ timeout: 5 });
    });

    test('<item 1>', async ({ page }) => {
        // ...
        await page.screenshot({
            path: `${SCREENSHOTS}/01-foo.png`,
            fullPage: true,
        });
    });
});
```

### Patterns that work

- **Hidden file inputs**: `await page.setInputFiles('input[type="file"]', { name, mimeType, buffer })` is more reliable than going through the visible "Browse" proxy button.
- **DB assertions after UI action**: query directly with the `helpers/db` `sql` template; assert on `s3_key` shape, FK columns, `storage_usage` deltas.
- **Filter DB queries by test-unique names** (timestamps in filenames). Otherwise tests later in the suite see rows from earlier ones and false-fail.
- **Screenshots at every meaningful milestone**: post-selection, post-action, on success state, on the failure state you're testing. They're cheap and save a debug round.
- **For quota / error states**: drive through the UI and assert the error UI appears (e.g. `page.getByRole('button', { name: 'Retry upload' })` for failed uploads), plus a DB assertion that no row was created.

### Patterns that fail

- **Parallel tests + shared state**. Always force serial with `mode: 'serial'` + `--workers=1`. Playwright's `fullyParallel: true` will silently break shared-state tests.
- **Constructing tRPC URLs by hand**. The httpBatchLink format (`?batch=1&input=...`) is finicky; superjson wraps things. Drive through the UI instead, or use the page's own fetch via `page.evaluate`.
- **Counting all rows for a user**. After test #1 creates data and test #4 asserts "no row was created", the user-wide count is non-zero. Filter by the specific name your test used.
- **Assuming `afterEach`-style cleanup is enough**. Each test pulls from a fresh baseline only if cleanup is in `beforeAll` + you're running serial.

## Step 5: Run and Iterate

```bash
pnpm -F web exec playwright test e2e/smoke/_temp-validate-<slug>.spec.ts \
  --project=smoke --reporter=list --workers=1
```

`--workers=1` is non-optional when state is shared.

When a test fails:

1. **Read the screenshot**. Playwright auto-captures on failure to `test-results/<test-name>/`. The screenshot tells you the actual UI state, which is usually different from what you assumed.
2. **Read the error-context.md**. Playwright dumps an accessibility-tree snapshot of the page at failure — often shows the real text/role you should be asserting against.
3. **Check for state pollution** before assuming the code is wrong. If a previous test left data, your "no row was created" assertion will lie.
4. **Refine assertions, not the code under test**. The skill's job is to validate, not to fix. If the actual behavior is wrong, surface it; don't loosen the test.

## Step 6: Honest Pushback

After the run:

- If everything passes, say so plainly.
- If something failed and the code is wrong, **surface it directly** — don't bury it in a checklist.
- If you dropped an item for a defensible reason, name the reason ("opaque field, no parsing").
- If a test couldn't be written (e.g. the UI doesn't expose the behavior yet), say that too — silence is worse than "not validated".

## Step 7: Cleanup

```bash
rm apps/web/scripts/temp-validate-<slug>.ts
rm apps/web/e2e/smoke/_temp-validate-<slug>.spec.ts
# Screenshots are gitignored under test-results/, leave them.
git status  # confirm clean
```

If the validation surfaced a real bug, do NOT delete — keep the spec around as a reproducer until the fix lands.

## Output

A short summary table with one row per validation item, columns: **What / How / Result**. Link screenshots inline where helpful. End with a one-sentence verdict ("ready to ship" / "blocker: <X>").
