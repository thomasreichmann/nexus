import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';
import { client } from './client';
import * as artifacts from './artifacts';
import * as presigned from './presigned';

// The unit tests prove what URL the app signs. Only the real distributions can
// prove the rest of #345: that OAC and the bucket policy let CloudFront read,
// that the trusted key group rejects what the app didn't sign, that a hostile
// filename survives the trip to S3, and that the disposition and Range reach
// it. Each test puts a small object in a dev bucket, downloads it through the
// URL the app mints, and deletes it afterwards.

// Set only by ci.yml, on fork PRs: GitHub withholds repo secrets from them, so
// there are no AWS credentials or signing key. Never set it locally; missing
// CloudFront config there should fail, not skip.
const isAwsUnavailable = process.env.INTEGRATION_SKIP_AWS === '1';

// Every character a naive URL builder gets wrong: `?` and `#` end the path,
// `%` starts an escape, `+` reads as a space in a query, `&`/`=` split one,
// `'()!*[]` are left raw by encodeURIComponent, and the rest is non-ASCII.
const HOSTILE_NAME = `Q3 report? #final 50%+ (v2) [x]=y & 'z'!*. café ☕.txt`;
const BODY = 'nexus cloudfront integration test: 0123456789abcdef';
const RUN = randomUUID();

const created: { bucket: string; key: string }[] = [];

afterAll(async () => {
    for (const object of created) {
        await client.send(
            new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key })
        );
    }
});

describe.skipIf(isAwsUnavailable)('CloudFront download distributions', () => {
    it('serves a files-bucket object under a hostile key, with the requested filename', async () => {
        const { filesBucket } = requireDevConfig();
        const key = await putObject(filesBucket, HOSTILE_NAME);
        const filename = 'Q3 "final" report (v2) #1 50%+.txt';

        const url = await presigned.get(key, { filename });
        const response = await fetch(url);

        expect(new URL(url).host).toBe(env.CLOUDFRONT_FILES_DOMAIN);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(BODY);
        expect(response.headers.get('content-disposition')).toBe(
            'attachment; filename="Q3 \\"final\\" report (v2) #1 50%+.txt"'
        );
    });

    it('serves a byte range, so an interrupted download can resume', async () => {
        const { filesBucket } = requireDevConfig();
        const key = await putObject(filesBucket, 'range.bin');

        const url = await presigned.get(key);
        const response = await fetch(url, {
            headers: { Range: 'bytes=10-19' },
        });

        // S3 answers a range too; only the host proves CloudFront did.
        expect(new URL(url).host).toBe(env.CLOUDFRONT_FILES_DOMAIN);
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe(
            `bytes 10-19/${BODY.length}`
        );
        expect(await response.text()).toBe(BODY.slice(10, 20));
    });

    it('serves an artifacts-bucket object through the artifacts distribution', async () => {
        const { artifactsBucket } = requireDevConfig();
        const key = await putObject(artifactsBucket, 'nexus-part-1.zip');

        const url = await artifacts.get(key, { filename: 'nexus-part-1.zip' });
        const response = await fetch(url);

        expect(new URL(url).host).toBe(env.CLOUDFRONT_ARTIFACTS_DOMAIN);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(BODY);
        expect(response.headers.get('content-disposition')).toBe(
            'attachment; filename="nexus-part-1.zip"'
        );
    });

    // A private S3 bucket would 403 both of these too, so each one first pins
    // the CloudFront host: the refusal has to be the trusted key group's.
    it.each([
        [
            'with its signature stripped',
            (signed: URL) => new URL(signed.pathname, signed.origin),
        ],
        [
            'with its saved filename edited',
            (signed: URL) => {
                const renamed = new URL(signed);
                renamed.searchParams.set(
                    'response-content-disposition',
                    'attachment; filename="renamed.exe"'
                );
                return renamed;
            },
        ],
    ])('refuses a link %s', async (_, tamper) => {
        const { filesBucket } = requireDevConfig();
        const key = await putObject(filesBucket, 'tampered.txt');
        const signed = new URL(
            await presigned.get(key, { filename: 'tampered.txt' })
        );

        const response = await fetch(tamper(signed));

        expect(signed.host).toBe(env.CLOUDFRONT_FILES_DOMAIN);
        expect(response.status).toBe(403);
    });
});

/**
 * Upload `name` under a per-run scratch prefix. `integration-test/` is the only
 * prefix the dev app user may write in the artifacts bucket (iam.tf). The body
 * is far below 128 KB, so the files bucket's Deep Archive rule never touches it.
 */
async function putObject(bucket: string, name: string): Promise<string> {
    const key = `integration-test/${RUN}/${randomUUID()}/${name}`;
    await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: BODY })
    );
    created.push({ bucket, key });
    return key;
}

function requireDevConfig(): { filesBucket: string; artifactsBucket: string } {
    const filesBucket = env.S3_BUCKET;
    const artifactsBucket = env.S3_RETRIEVAL_ARTIFACTS_BUCKET;
    if (!env.CLOUDFRONT_FILES_DOMAIN || !env.CLOUDFRONT_ARTIFACTS_DOMAIN) {
        throw new Error(
            'CLOUDFRONT_FILES_DOMAIN / CLOUDFRONT_ARTIFACTS_DOMAIN are not set. Add the dev Terraform cloudfront_* outputs and the dev signing key to apps/web/.env.local (infra/terraform/README.md, "CloudFront signing key").'
        );
    }
    // Writes and deletes real objects, so never anywhere but dev.
    if (!filesBucket.endsWith('-dev') || !artifactsBucket?.endsWith('-dev')) {
        throw new Error(
            `Refusing to write test objects outside the dev buckets (S3_BUCKET=${filesBucket}, S3_RETRIEVAL_ARTIFACTS_BUCKET=${artifactsBucket}).`
        );
    }
    return { filesBucket, artifactsBucket };
}
