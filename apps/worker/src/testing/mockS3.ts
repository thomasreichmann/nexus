import type { Mock } from 'vitest';

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
    importOriginal: () => Promise<S3Module>,
    send: Mock
): Promise<MockedS3Module> {
    const actual = await importOriginal();
    return {
        ...actual,
        S3Client: class {
            send = send;
        },
    };
}
