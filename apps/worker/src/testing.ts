import type { Mock } from 'vitest';

/**
 * Test scaffolding shared by the worker's two S3 specs — the readiness poll and
 * the restore-initiation handler. Both drive the same client through the same
 * HeadObject shapes, so the fixtures live here rather than being copied.
 *
 * Excluded from coverage by `vitest.config.ts` (the `**\/testing*` pattern).
 */

/**
 * An `S3Client` stand-in whose every instance shares one `send` mock, so a spec
 * can assert on calls without holding the client the module under test built.
 *
 * Use it inside a `vi.mock('@aws-sdk/client-s3', ...)` factory, with a `send`
 * from `vi.hoisted`: the factory runs before the module graph is imported, so a
 * mock created at file scope would not exist yet.
 */
export function s3ClientMock(send: Mock): new () => { send: Mock } {
    return class {
        send = send;
    };
}

type S3Module = typeof import('@aws-sdk/client-s3');

/**
 * The real module with only the client swapped. Spelled out rather than cast
 * to `S3Module`: the stub deliberately has none of `S3Client`'s config,
 * middleware or destroy surface, so claiming it is one would be a lie the
 * compiler is right to reject.
 */
interface MockedS3Module extends Omit<S3Module, 'S3Client'> {
    S3Client: new () => { send: Mock };
}

/**
 * The module factory for `vi.mock('@aws-sdk/client-s3', …)`, for suites that
 * still construct real commands (`GetObjectCommand`, `UploadPartCommand`, …)
 * and assert on them — the real module is spread back in and only the client's
 * `send` is replaced.
 *
 * Must be called from inside the `vi.mock` factory with a `vi.hoisted` mock:
 * the factory is hoisted above the imports, so a `send` defined at module scope
 * would not exist yet.
 */
export async function mockS3Module(
    importOriginal: () => Promise<S3Module>,
    send: Mock
): Promise<MockedS3Module> {
    const actual = await importOriginal();
    return { ...actual, S3Client: s3ClientMock(send) };
}

/** The HeadObject fields both specs read. */
export interface HeadResponse {
    StorageClass?: string;
    Restore?: string;
}

/** Deep Archive, restore finished, with the expiry S3 reports. */
export const RESTORED: HeadResponse = {
    StorageClass: 'DEEP_ARCHIVE',
    Restore:
        'ongoing-request="false", expiry-date="Fri, 29 Aug 2026 00:00:00 GMT"',
};

/** Deep Archive, no restore requested — the case that needs a RestoreObject. */
export const STILL_ARCHIVED: HeadResponse = { StorageClass: 'DEEP_ARCHIVE' };

/** Deep Archive with a restore in flight — leave it alone. */
export const ALREADY_RESTORING: HeadResponse = {
    StorageClass: 'DEEP_ARCHIVE',
    Restore: 'ongoing-request="true"',
};

/** S3 omits StorageClass entirely for STANDARD, so absent means warm. */
export const WARM: HeadResponse = {};

/** What the SDK throws when HeadObject is pointed at a key that isn't there. */
export function notFound(): Error {
    return Object.assign(new Error('NotFound'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
    });
}

/** What S3 answers when the object already has a restore in flight. */
export function restoreInProgress(): Error {
    return Object.assign(new Error('RestoreAlreadyInProgress'), {
        name: 'RestoreAlreadyInProgress',
        $metadata: { httpStatusCode: 409 },
    });
}
