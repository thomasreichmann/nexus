/**
 * Connection-injectable INSERT helpers for tests (unit integration + e2e).
 *
 * Each helper builds its row from the matching pure factory in
 * `repositories/fixtures.ts` — the single source of column defaults shared with
 * unit tests — then inserts via Drizzle and returns the typed select row.
 *
 * Identity/uniqueness is established HERE, not in the factory: the factories
 * deliberately ship stable `TEST_*` ids/keys so unit tests can assert on them,
 * which would collide on a second insert. So when the caller doesn't override
 * `id` (and `s3Key`/`stripeCustomerId`, which carry UNIQUE constraints), we mint
 * a fresh value. Tables with a `$defaultFn` id (background_jobs) let the DB
 * generate it.
 *
 * `DB` is a type-only import, so this module never pulls the `postgres` driver —
 * the driver only enters when the caller builds a connection via `createDb()`.
 */
import type { DB } from '../connection';
import * as schema from '../schema';
import {
    createFileFixture,
    createUploadBatchFixture,
    createUserFixture,
    createRetrievalFixture,
    createSubscriptionFixture,
    createStorageUsageFixture,
    createJobFixture,
    createInviteFixture,
    type User,
    type StorageUsage,
} from '../repositories/fixtures';
import type { File } from '../repositories/files';
import type { UploadBatch } from '../repositories/uploadBatches';
import type { Retrieval } from '../repositories/retrievals';
import type { Subscription } from '../repositories/subscriptions';
import type { Job } from '../repositories/jobs';
import type { Invite } from '../repositories/invites';

/**
 * Writes ONLY the `user` row — no BetterAuth `account`/password. A user that
 * must sign in through the UI is created via the BetterAuth sign-up API in the
 * e2e auth layer instead; reach for `insertUser` only when the session is
 * fabricated via `storageState` or the user never logs in.
 */
export async function insertUser(
    db: DB,
    overrides: Partial<User> = {}
): Promise<User> {
    // createUserFixture already mints a unique id (and id-derived email).
    const row = createUserFixture(overrides);
    const [user] = await db.insert(schema.user).values(row).returning();
    return user!;
}

export async function insertUploadBatch(
    db: DB,
    overrides: Partial<UploadBatch> = {}
): Promise<UploadBatch> {
    const row = createUploadBatchFixture(overrides);
    if (overrides.id === undefined) row.id = crypto.randomUUID();
    const [batch] = await db
        .insert(schema.uploadBatches)
        .values(row)
        .returning();
    return batch!;
}

export async function insertFile(
    db: DB,
    overrides: Partial<File> = {}
): Promise<File> {
    const row = createFileFixture(overrides);
    if (overrides.id === undefined) row.id = crypto.randomUUID();
    // s3_key is UNIQUE; derive a collision-free default from the (now unique)
    // id so back-to-back inserts don't clash. Specs that assert on s3Key shape
    // pass it explicitly.
    if (overrides.s3Key === undefined) row.s3Key = `${row.userId}/${row.id}`;
    const [file] = await db.insert(schema.files).values(row).returning();
    return file!;
}

/**
 * Inserts a retrieval defaulting to `ready` — e2e's only reason to seed a
 * retrieval directly is to reach the download path (`getDownloadUrl` needs a
 * ready retrieval, and a real Glacier restore takes hours). The factory's
 * `pending` default stays unit-test-correct; this helper opts into ready.
 */
export async function insertRetrieval(
    db: DB,
    overrides: Partial<Retrieval> = {}
): Promise<Retrieval> {
    const now = Date.now();
    const row = createRetrievalFixture({
        status: 'ready',
        tier: 'standard',
        initiatedAt: new Date(now - 3_600_000),
        readyAt: new Date(now),
        expiresAt: new Date(now + 7 * 86_400_000),
        ...overrides,
    });
    if (overrides.id === undefined) row.id = crypto.randomUUID();
    const [retrieval] = await db
        .insert(schema.retrievals)
        .values(row)
        .returning();
    return retrieval!;
}

export async function insertSubscription(
    db: DB,
    overrides: Partial<Subscription> = {}
): Promise<Subscription> {
    const row = createSubscriptionFixture(overrides);
    if (overrides.id === undefined) row.id = crypto.randomUUID();
    // stripe_customer_id is UNIQUE; derive from the user so two users don't
    // collide on the factory's fixed default.
    if (overrides.stripeCustomerId === undefined)
        row.stripeCustomerId = `cus_test_${row.userId}`;
    const [sub] = await db.insert(schema.subscriptions).values(row).returning();
    return sub!;
}

export async function insertStorageUsage(
    db: DB,
    overrides: Partial<StorageUsage> = {}
): Promise<StorageUsage> {
    // user_id is UNIQUE — upsert so re-seeding a user's usage is idempotent.
    const row = createStorageUsageFixture(overrides);
    const [usage] = await db
        .insert(schema.storageUsage)
        .values(row)
        .onConflictDoUpdate({
            target: schema.storageUsage.userId,
            set: { usedBytes: row.usedBytes, fileCount: row.fileCount },
        })
        .returning();
    return usage!;
}

/**
 * `createdBy` references a real user row — e2e callers must pass an existing
 * user's id (the fixture's `TEST_ADMIN_USER_ID` default only exists in unit
 * tests' mocked DB).
 */
export async function insertInvite(
    db: DB,
    overrides: Partial<Invite> = {}
): Promise<Invite> {
    const row = createInviteFixture(overrides);
    if (overrides.id === undefined) row.id = crypto.randomUUID();
    // token is UNIQUE; derive from the (now unique) id so back-to-back
    // inserts don't clash on the factory's fixed default.
    if (overrides.token === undefined) row.token = `test-invite-${row.id}`;
    const [invite] = await db.insert(schema.invites).values(row).returning();
    return invite!;
}

export async function insertJob(
    db: DB,
    overrides: Partial<Job> = {}
): Promise<Job> {
    // background_jobs.id has a $defaultFn — drop the factory's fixed id so the
    // DB generates a unique one, unless the caller explicitly set it.
    const { id, ...rest } = createJobFixture(overrides);
    const values = overrides.id !== undefined ? { id, ...rest } : rest;
    const [job] = await db
        .insert(schema.backgroundJobs)
        .values(values)
        .returning();
    return job!;
}
