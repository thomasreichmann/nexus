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
