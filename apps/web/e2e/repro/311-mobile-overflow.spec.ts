/**
 * #311 — mobile layout blowout on /dashboard and /dashboard/files when a
 * long unbreakable filename forces the data tables past the viewport.
 *
 * Born RED (2026-07-08): these tests fail while the bug lives. They are the
 * detector #311's fix must flip green — do not "fix" the tests. On
 * graduation (fix landed, tests green with no test change): add @page/@uc
 * tags, move the file into e2e/smoke/authenticated/, and keep the dedicated
 * user — adversarial seeding must never touch the shared smoke user.
 *
 * This spec doubles as the copy-and-extend exemplar for the repro tier
 * (see "Reproducing a bug with data" in apps/web/CLAUDE.md):
 * - dedicated user via `dedicatedUserConfig`, so seeding races nothing
 * - adversarial library seeding (`seedAdversarialLibrary`) — the bug is
 *   data-dependent; an empty account renders fine and false-passes
 * - repro-tier `test.use` defaults: mobile viewport as a plain chromium
 *   viewport override (CI installs chromium only — no device presets) and
 *   dark mode (evidence is captured dark by convention)
 * - `expectNoHorizontalOverflow`, which measures inner content width;
 *   naive `document.scrollWidth` reads no overflow on these exact pages
 *
 * Both tests share one worker-scoped seed; the repro project sets
 * `fullyParallel: false`, so same-file tests stay in one worker and the
 * dedicated user is never provisioned concurrently.
 */
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import {
    type AdversarialLibrary,
    seedAdversarialLibrary,
    deleteUserData,
} from '@nexus/db/test-db';
import { expectNoHorizontalOverflow } from '../helpers/overflow';

const REPRO_USER: TestUser = {
    email: 'repro-311-e2e@test.local',
    password: 'repro-311-e2e-password-123',
    name: 'Repro 311 E2E',
};

const test = base.extend<
    NonNullable<unknown>,
    { adversarialLibrary: AdversarialLibrary }
>({
    adversarialLibrary: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const library = await seedAdversarialLibrary(db, userId);
            await use(library);
            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.use({
    dedicatedUserConfig: {
        user: REPRO_USER,
        statePath: 'e2e/.auth/repro-311.json',
    },
    // iPhone 12-class width — #311 reproduces at ≤390px.
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
});

test('dashboard does not overflow horizontally with adversarial filenames', async ({
    page,
    adversarialLibrary,
}) => {
    await page.goto('/dashboard');
    // Recent Uploads lists the 5 newest files; the long-name file is the
    // newest, so the data-dependent layout is fully rendered once it shows.
    await expect(
        page.getByText(adversarialLibrary.longNameFile.name).first()
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
});

test('files page does not overflow horizontally with adversarial filenames', async ({
    page,
    adversarialLibrary,
}) => {
    await page.goto('/dashboard/files');
    await expect(
        page.getByText(adversarialLibrary.longNameFile.name).first()
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
});
