import { rmSync } from 'node:fs';
import { test as teardown } from '@playwright/test';
import { deleteUsers, findUserByEmail } from '@nexus/db/test-db';
import { ADMIN_USER, REGULAR_USER } from './helpers/auth';
import { withTestDb } from './helpers/connection';
import { RUN_AUTH_DIR } from './helpers/run-id';

// Runs once every project that depends on `setup` has finished (the setup
// project's `teardown` in playwright.config.ts). Dedicated users aren't this
// file's job: their worker fixture deletes them.
teardown("delete this run's shared users and auth state", async () => {
    await withTestDb(async (db) => {
        const users = await Promise.all(
            [ADMIN_USER, REGULAR_USER].map((u) => findUserByEmail(db, u.email))
        );
        // deleteUsers, not deleteUserByEmail: an admin spec that failed
        // before its cleanup can leave invites the admin created.
        await deleteUsers(
            db,
            users.flatMap((user) => (user ? [user.id] : []))
        );
    });
    rmSync(RUN_AUTH_DIR, { recursive: true, force: true });
});
