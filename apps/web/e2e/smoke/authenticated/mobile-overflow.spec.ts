/**
 * #311 regression: at a mobile viewport, a long unbreakable filename used to
 * force the dashboard/files data tables past the viewport — flex/grid
 * ancestors without `min-w-0` refused to shrink, and auto-layout table
 * columns grew to the full string instead of truncating.
 *
 * Graduated from e2e/repro/ (#312): born red on the live bug, flipped green
 * by the #311 fix with no test change. It doubles as the copy-and-extend
 * exemplar for new repro specs (see "Bug Repro" in the root CLAUDE.md):
 * - dedicated user via `dedicatedUserConfig` — adversarial seeding must
 *   never touch the shared smoke user other specs assert against
 * - adversarial library seeding (`seedAdversarialLibrary`) — the bug is
 *   data-dependent; an empty account renders fine and false-passes
 * - mobile viewport as a plain chromium `test.use` viewport override (CI
 *   installs chromium only — no device presets) and dark mode
 * - `expectNoHorizontalOverflow`, which measures inner content width; naive
 *   `document.scrollWidth` reads no overflow on these exact pages
 *
 * Both tests share one worker-scoped seed. Smoke runs fullyParallel, so
 * mode 'default' keeps this file's tests in one worker — otherwise each
 * test would provision the same dedicated user concurrently and race the
 * seed inserts/deletes.
 */
import { test as base, expect } from '../../fixtures';
import { type TestUser } from '../../helpers/auth';
import {
    type AdversarialLibrary,
    seedAdversarialLibrary,
    deleteUserData,
} from '@nexus/db/test-db';
import { expectNoHorizontalOverflow } from '../../helpers/overflow';

const SPEC_USER: TestUser = {
    email: 'mobile-overflow-e2e@test.local',
    password: 'mobile-overflow-e2e-password-123',
    name: 'Mobile Overflow E2E',
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

test.describe.configure({ mode: 'default' });

test.use({
    dedicatedUserConfig: {
        user: SPEC_USER,
        statePath: 'e2e/.auth/mobile-overflow.json',
    },
    // iPhone 12-class width — #311 reproduced at ≤390px.
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
});

test(
    'dashboard does not overflow horizontally with adversarial filenames',
    { tag: ['@page:/dashboard', '@uc:mobile-no-horizontal-overflow'] },
    async ({ page, adversarialLibrary }) => {
        await page.goto('/dashboard');
        // Recent Uploads lists the 5 newest files; the long-name file is the
        // newest, so the data-dependent layout is fully rendered once it
        // shows.
        await expect(
            page.getByText(adversarialLibrary.longNameFile.name).first()
        ).toBeVisible();

        await expectNoHorizontalOverflow(page);
    }
);

test(
    'files page does not overflow horizontally with adversarial filenames',
    { tag: ['@page:/dashboard/files', '@uc:mobile-no-horizontal-overflow'] },
    async ({ page, adversarialLibrary }) => {
        await page.goto('/dashboard/files');
        await expect(
            page.getByText(adversarialLibrary.longNameFile.name).first()
        ).toBeVisible();

        await expectNoHorizontalOverflow(page);
    }
);
