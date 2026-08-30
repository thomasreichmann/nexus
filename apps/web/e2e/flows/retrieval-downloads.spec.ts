/**
 * Delivery of a completed multi-file restore (#426) — the `?request={id}` deep
 * link the ready email points at, and the dashboard card that lists the same
 * requests.
 *
 * Its own dedicated user, like the file-browser flows, so the exact-count
 * assertions here can't race a spec sharing the regular user.
 *
 * The download click is intercepted rather than executed: the seeded artifacts
 * have no real objects behind them, and what this spec is proving is the wiring
 * — link → the right tRPC procedure with the right artifact id. That the
 * presigned URL reads real bytes is `e2e/validate/zip-pipeline.spec.ts`'s job,
 * against a zip the pipeline actually built.
 *
 * The load-bearing seeding detail is the two windows: `retrievals.expiresAt` is
 * deliberately in the PAST here (the thawed originals lapse after
 * ZIP_BUILD_RESTORE_DAYS) while the artifacts were built recently. A surface
 * that reads the window off the retrieval rows shows this request as expired;
 * one that reads it off the artifacts shows five more days.
 */
import {
    type File,
    type RetrievalRequest,
    deleteUserData,
    insertFile,
    insertRetrieval,
    insertRetrievalArtifact,
    insertRetrievalRequest,
    insertRetrievalRequestItem,
} from '@nexus/db/test-db';
import { artifactWindowEnd } from '@nexus/db/objectState';
import { daysAgo } from '@nexus/db/seed';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { interceptTrpcCalls } from '../helpers/trpc';

const DOWNLOADS_USER: TestUser = {
    email: 'retrieval-downloads-e2e@test.local',
    password: 'retrieval-downloads-e2e-password-123',
    name: 'Retrieval Downloads E2E',
};
const STATE_PATH = 'e2e/.auth/retrieval-downloads.json';

/** Built two days ago: well inside the artifacts' seven-day window. */
const BUILT_DAYS_AGO = 2;

interface SeededDelivery {
    request: RetrievalRequest;
    files: File[];
    artifactIds: string[];
}

const test = base.extend<
    NonNullable<unknown>,
    { seededDelivery: SeededDelivery }
>({
    seededDelivery: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const request = await insertRetrievalRequest(db, {
                userId,
                tier: 'bulk',
                completedAt: daysAgo(BUILT_DAYS_AGO),
            });

            const files: File[] = [];
            for (const name of ['shoot-a.cr2', 'shoot-b.cr2', 'shoot-c.cr2']) {
                const file = await insertFile(db, {
                    userId,
                    name,
                    size: 5_000_000,
                    status: 'available',
                });
                // Lapsed on purpose: the thawed original only had to outlive
                // the build. The zip below is still downloadable.
                const retrieval = await insertRetrieval(db, {
                    userId,
                    fileId: file.id,
                    status: 'ready',
                    expiresAt: daysAgo(1),
                });
                await insertRetrievalRequestItem(db, {
                    requestId: request.id,
                    fileId: file.id,
                    retrievalId: retrieval.id,
                });
                files.push(file);
            }

            const artifactIds: string[] = [];
            for (const position of [0, 1]) {
                const artifact = await insertRetrievalArtifact(db, {
                    requestId: request.id,
                    position,
                    status: 'ready',
                    s3Key: `${userId}/${request.id}/part-${position}/nexus-part-${position + 1}.zip`,
                    sizeBytes: 2_000_000_000,
                    completedAt: daysAgo(BUILT_DAYS_AGO),
                });
                artifactIds.push(artifact.id);
            }

            await use({ request, files, artifactIds });

            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.describe.configure({ mode: 'serial' });
test.use({
    dedicatedUserConfig: { user: DOWNLOADS_USER, statePath: STATE_PATH },
});

test(
    'deep-linking to a ready request lists its parts with download links',
    { tag: ['@page:/dashboard/files', '@uc:retrieval-request-downloads'] },
    async ({ page, seededDelivery }) => {
        await page.goto(
            `/dashboard/files?request=${seededDelivery.request.id}`
        );

        await expect(
            page.getByRole('heading', { name: 'Your restore is ready' })
        ).toBeVisible();
        await expect(
            page.getByText(/^3 files · .+ · 2 archives$/)
        ).toBeVisible();
        await expect(page.getByText('Part 1 of 2')).toBeVisible();
        await expect(page.getByText('Part 2 of 2')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Download' })
        ).toHaveCount(2);
    }
);

test(
    "the window shown is the artifact's, not the lapsed originals'",
    {
        tag: ['@page:/dashboard/files', '@uc:retrieval-artifact-expiry-window'],
    },
    async ({ page, seededDelivery }) => {
        await page.goto(
            `/dashboard/files?request=${seededDelivery.request.id}`
        );

        // Seven days from the build, which is five days after the thawed
        // originals seeded above lapsed.
        const expected = artifactWindowEnd(daysAgo(BUILT_DAYS_AGO));
        const label = expected.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });

        await expect(
            page.getByText(`Downloadable until ${label}`)
        ).toBeVisible();
        await expect(page.getByText('expired', { exact: false })).toHaveCount(
            0
        );
    }
);

test(
    'downloading a part asks the server to presign that artifact',
    { tag: ['@page:/dashboard/files', '@uc:retrieval-request-downloads'] },
    async ({ page, seededDelivery }) => {
        // Aborted before it reaches the server: the seeded key has no object,
        // and what's under test is that the click carries the right id.
        const calls = await interceptTrpcCalls(
            page,
            'retrievals.artifactDownloadUrl'
        );

        await page.goto(
            `/dashboard/files?request=${seededDelivery.request.id}`
        );
        await page.getByRole('button', { name: 'Download' }).first().click();

        await expect
            .poll(() => calls.length, { timeout: 5000 })
            .toBeGreaterThan(0);
        // A query, so the input rides the URL rather than a body.
        expect(decodeURIComponent(calls[0])).toContain(
            seededDelivery.artifactIds[0]
        );
    }
);

test(
    'a request with no artifacts yet explains itself instead of erroring',
    {
        tag: [
            '@page:/dashboard/files',
            '@uc:retrieval-request-not-deliverable',
        ],
    },
    async ({ page, db, dedicatedUser }) => {
        const building = await insertRetrievalRequest(db, {
            userId: dedicatedUser!.userId,
            completedAt: null,
        });

        await page.goto(`/dashboard/files?request=${building.id}`);

        await expect(
            page.getByRole('heading', {
                name: 'Your files are still being prepared',
            })
        ).toBeVisible();
        // 48 hours because Bulk is the default tier (#406). This is this
        // card's own copy, written new here; the "within 12 hours" string
        // elsewhere in the app is still #363's to fix.
        await expect(page.getByText('up to 48 hours')).toBeVisible();
    }
);

test(
    'the dashboard lists the ready request and links to its parts',
    { tag: ['@page:/dashboard', '@uc:dashboard-ready-downloads'] },
    async ({ page, seededDelivery }) => {
        await page.goto('/dashboard');

        const card = page.getByText('Ready downloads');
        await expect(card).toBeVisible();

        await page
            .getByRole('link', { name: /3 files/ })
            .first()
            .click();

        await expect(page).toHaveURL(
            new RegExp(`request=${seededDelivery.request.id}`)
        );
        await expect(
            page.getByRole('heading', { name: 'Your restore is ready' })
        ).toBeVisible();
    }
);
