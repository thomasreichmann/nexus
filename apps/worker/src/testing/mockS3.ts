import type { Mock } from 'vitest';

/**
 * The module factory for `vi.mock('@aws-sdk/client-s3', …)`, so the three
 * worker suites that need an S3 stub declare it once each instead of restating
 * the class shape.
 *
 * The real module is spread back in because every caller still constructs real
 * commands (`GetObjectCommand`, `UploadPartCommand`, …) and asserts on them —
 * only the client's `send` is replaced.
 *
 * Must be called from inside the `vi.mock` factory with a `vi.hoisted` mock:
 * the factory is hoisted above the imports, so a `send` defined at module scope
 * would not exist yet.
 */
export async function mockS3Module(
    importOriginal: () => Promise<typeof import('@aws-sdk/client-s3')>,
    send: Mock
): Promise<typeof import('@aws-sdk/client-s3')> {
    const actual = await importOriginal();
    return {
        ...actual,
        S3Client: class {
            send = send;
        },
    } as typeof import('@aws-sdk/client-s3');
}
