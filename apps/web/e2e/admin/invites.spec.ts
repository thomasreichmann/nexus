import { test, expect } from '../fixtures';
import {
    insertInvite,
    deleteInvite,
    deleteInvitesByEmail,
    deleteInviteByToken,
    findUserByEmail,
    type Invite,
} from '@nexus/db/test-db';
import { ADMIN_USER } from '../helpers/auth';
import { waitForTableLoad } from '../helpers/table';

const PAGE_URL = '/dashboard/admin/invites';

// Unique per run so a crashed previous run can't collide; cleaned in afterAll.
const RUN_ID = `${Date.now()}-${process.pid}`;
const SEEDED_EMAIL = `invite-seeded-${RUN_ID}@test.local`;
const REVOKE_EMAIL = `invite-revoke-${RUN_ID}@test.local`;
const CREATED_EMAIL = `invite-created-${RUN_ID}@test.local`;

// Admin project applies the admin storageState at the project level; align the
// fixture chain's storageState override to it.
test.use({ userRole: 'admin' });

// Run serially — tests share seeded rows and mutate the same table.
test.describe.configure({ mode: 'serial' });

test.describe('admin invites', () => {
    let seeded: Invite[] = [];
    // Token of the link-only invite created through the UI, for cleanup.
    let createdToken: string | undefined;

    test.beforeAll(async ({ db }) => {
        const admin = await findUserByEmail(db, ADMIN_USER.email);
        if (!admin) throw new Error('Shared admin e2e user not found');

        seeded = await Promise.all([
            insertInvite(db, {
                createdBy: admin.id,
                email: SEEDED_EMAIL,
                // 2 TB, to assert the formatted storage cell
                storageLimit: 2 * 1024 ** 4,
                expiresAt: new Date(Date.now() + 7 * 86_400_000),
            }),
            insertInvite(db, { createdBy: admin.id, status: 'revoked' }),
            insertInvite(db, { createdBy: admin.id, email: REVOKE_EMAIL }),
        ]);
    });

    test.afterAll(async ({ db }) => {
        await Promise.all(seeded.map((invite) => deleteInvite(db, invite.id)));
        await deleteInvitesByEmail(db, CREATED_EMAIL);
        if (createdToken) await deleteInviteByToken(db, createdToken);
    });

    test(
        'table renders seeded invites with recipient, status, and details',
        { tag: ['@page:/dashboard/admin/invites', '@uc:admin-invites-table'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForTableLoad(page, 'No invites found');

            const headers = page.locator('thead th');
            await expect(headers.nth(0)).toHaveText('Recipient');
            await expect(headers.nth(1)).toHaveText('Status');
            await expect(headers.nth(2)).toHaveText('Storage');
            await expect(headers.nth(3)).toHaveText('Created');
            await expect(headers.nth(4)).toHaveText('Expires');

            const row = page
                .locator('tbody tr')
                .filter({ hasText: SEEDED_EMAIL });
            await expect(row.getByText('Pending')).toBeVisible();
            await expect(row.getByText('2 TB')).toBeVisible();
        }
    );

    test(
        'status filters update the table',
        { tag: ['@page:/dashboard/admin/invites', '@uc:admin-invites-filter'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForTableLoad(page, 'No invites found');

            await page
                .getByRole('button', { name: 'Revoked', exact: true })
                .click();
            await waitForTableLoad(page, 'No invites found');

            const badges = page.locator('tbody td:nth-child(2)');
            const count = await badges.count();
            expect(count).toBeGreaterThan(0);
            for (let i = 0; i < count; i++) {
                await expect(badges.nth(i)).toHaveText('Revoked');
            }

            await page
                .getByRole('button', { name: 'All', exact: true })
                .click();
            await waitForTableLoad(page, 'No invites found');
        }
    );

    test(
        'creating a link-only invite shows the shareable URL',
        { tag: ['@page:/dashboard/admin/invites', '@uc:admin-invites-create'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForTableLoad(page, 'No invites found');

            await page.getByRole('button', { name: 'Create invite' }).click();

            // Locate by message text, not role="status" — Sonner's toast
            // also carries that role and would trip strict mode.
            const message = page.getByText(
                'Invite link created — share it manually'
            );
            await expect(message).toBeVisible();

            const url =
                (await message
                    .locator('..')
                    .locator('p')
                    .nth(1)
                    .textContent()) ?? '';
            const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
            expect(token).toBeTruthy();
            createdToken = token;
        }
    );

    test(
        'creating an email-bound invite confirms the recipient and lists it',
        { tag: ['@page:/dashboard/admin/invites', '@uc:admin-invites-create'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForTableLoad(page, 'No invites found');

            await page.getByLabel(/email/i).fill(CREATED_EMAIL);
            await page.getByRole('button', { name: 'Create invite' }).click();

            await expect(
                page.getByText(`Invite emailed to ${CREATED_EMAIL}`)
            ).toBeVisible();

            // The list invalidates on creation — the new invite appears.
            await expect(
                page.locator('tbody tr').filter({ hasText: CREATED_EMAIL })
            ).toBeVisible();
        }
    );

    test(
        'revoking a pending invite flips its status badge',
        { tag: ['@page:/dashboard/admin/invites', '@uc:admin-invites-revoke'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForTableLoad(page, 'No invites found');

            const row = page
                .locator('tbody tr')
                .filter({ hasText: REVOKE_EMAIL });
            await expect(row.getByText('Pending')).toBeVisible();

            await row.getByRole('button', { name: 'Revoke invite' }).click();

            await expect(row.getByText('Revoked')).toBeVisible();
            // Revoked rows lose their pending-only actions.
            await expect(
                row.getByRole('button', { name: 'Revoke invite' })
            ).toHaveCount(0);
        }
    );
});
