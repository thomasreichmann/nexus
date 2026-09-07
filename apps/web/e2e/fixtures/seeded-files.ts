import { deleteUserData, type File } from '@nexus/db/test-db';
import { seedFiles } from '../helpers/scenarios';
import { test as base } from './data';

type SeededFilesFixtures = { seededFiles: File[] };

type SeededFilesTest = ReturnType<
    typeof base.extend<NonNullable<unknown>, SeededFilesFixtures>
>;

/**
 * A worker-scoped library of `count` plain files for a spec that runs as a
 * dedicated user: seeded once, shared by the spec's tests, torn down with the
 * user's whole data set before the user itself is deleted. Ungrouped (no
 * batchId), so they render in one flat, expanded group — the shape select-all
 * walks. Pair with `test.use({ dedicatedUserConfig })`; the fixture needs that
 * user's id.
 */
export function withSeededFiles(count: number): SeededFilesTest {
    return base.extend<NonNullable<unknown>, SeededFilesFixtures>({
        seededFiles: [
            async ({ db, dedicatedUser }, use) => {
                const userId = dedicatedUser!.userId;
                const files = await seedFiles(db, userId, count);

                await use(files);

                // Tear the library down before the dedicated user is deleted.
                await deleteUserData(db, userId);
            },
            { scope: 'worker' },
        ],
    });
}
