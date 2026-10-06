import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
}));

vi.mock('@/lib/env', () => ({ env: hoisted.env }));

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const FILES_DOMAIN = 'dfiles.cloudfront.net';
const ARTIFACTS_DOMAIN = 'dartifacts.cloudfront.net';

function configure(): void {
    for (const key of Object.keys(hoisted.env)) delete hoisted.env[key];
    Object.assign(hoisted.env, {
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIATEST',
        AWS_SECRET_ACCESS_KEY: 'secret',
        S3_BUCKET: 'files-bucket',
        S3_RETRIEVAL_ARTIFACTS_BUCKET: 'artifacts-bucket',
        CLOUDFRONT_FILES_DOMAIN: FILES_DOMAIN,
        CLOUDFRONT_ARTIFACTS_DOMAIN: ARTIFACTS_DOMAIN,
        CLOUDFRONT_KEY_PAIR_ID: 'KTESTPAIR',
        CLOUDFRONT_PRIVATE_KEY: privateKey,
    });
}

// client.ts builds the S3 client from env at import, so env must be filled
// before the storage modules load.
configure();
const { getArtifactsDistribution, getFilesDistribution, signGet } =
    await import('./cloudfront');
const presigned = await import('./presigned');
const artifacts = await import('./artifacts');

const distribution = {
    domain: FILES_DOMAIN,
    keyPairId: 'KTESTPAIR',
    privateKey,
};

beforeEach(configure);

describe('signGet', () => {
    it('keeps every key segment, hostile filename included, inside the path', () => {
        const key = 'user-1/batch-1/file-1/Q3 report? #final 50%+ (v2) ☕.pdf';

        const url = new URL(signGet(distribution, key, { expiresIn: 3600 }));

        expect(url.host).toBe(FILES_DOMAIN);
        expect(url.hash).toBe('');
        expect(
            url.pathname.split('/').slice(1).map(decodeURIComponent)
        ).toEqual(key.split('/'));
    });

    it('carries the content disposition as one query value', () => {
        const disposition = 'attachment; filename="a+b; c=d %20 & e.txt"';

        const url = new URL(
            signGet(distribution, 'k', {
                expiresIn: 3600,
                contentDisposition: disposition,
            })
        );

        expect(url.searchParams.get('response-content-disposition')).toBe(
            disposition
        );
    });

    describe('with a fixed clock', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('expires expiresIn seconds from now', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));

            const url = new URL(signGet(distribution, 'k', { expiresIn: 600 }));

            expect(Number(url.searchParams.get('Expires'))).toBe(
                Date.parse('2026-10-05T12:00:00Z') / 1000 + 600
            );
        });
    });

    it('signs the URL, disposition included, with SHA-256 under the key pair', () => {
        const signedUrl = signGet(distribution, 'user-1/a b.zip', {
            expiresIn: 3600,
            contentDisposition: 'attachment; filename="a b.zip"',
        });
        const params = new URL(signedUrl).searchParams;

        // A canned policy is never sent: CloudFront rebuilds it from the URL it
        // received, minus the trailing signing parameters, and checks the
        // signature against that. Rebuilding it the same way is the contract
        // under test, and the resource has to include the disposition.
        const resource = signedUrl.slice(0, signedUrl.indexOf('&Expires='));
        expect(resource).toContain('response-content-disposition=');
        const policy = JSON.stringify({
            Statement: [
                {
                    Resource: resource,
                    Condition: {
                        DateLessThan: {
                            'AWS:EpochTime': Number(params.get('Expires')),
                        },
                    },
                },
            ],
        });
        const signature = Buffer.from(
            params
                .get('Signature')!
                .replace(/-/g, '+')
                .replace(/_/g, '=')
                .replace(/~/g, '/'),
            'base64'
        );

        expect(params.get('Key-Pair-Id')).toBe('KTESTPAIR');
        expect(params.get('Hash-Algorithm')).toBe('SHA256');
        expect(
            verify('sha256', Buffer.from(policy), publicKey, signature)
        ).toBe(true);
    });
});

describe('distribution config', () => {
    it('is absent while the bucket has no domain, so S3 presigning stays', () => {
        hoisted.env.CLOUDFRONT_FILES_DOMAIN = undefined;
        hoisted.env.CLOUDFRONT_ARTIFACTS_DOMAIN = undefined;

        expect(getFilesDistribution()).toBeUndefined();
        expect(getArtifactsDistribution()).toBeUndefined();
    });

    it('throws when a domain is set without the key pair', () => {
        hoisted.env.CLOUDFRONT_PRIVATE_KEY = undefined;

        expect(() => getFilesDistribution()).toThrow(
            /CLOUDFRONT_FILES_DOMAIN is set but CLOUDFRONT_KEY_PAIR_ID \/ CLOUDFRONT_PRIVATE_KEY are not/
        );
        expect(() => getArtifactsDistribution()).toThrow(
            /CLOUDFRONT_ARTIFACTS_DOMAIN is set/
        );
    });
});

describe('download URL routing', () => {
    // A backslash and quotes, so the disposition's escaping shows in the URL.
    const FILENAME = 'Q3 \\ "final".pdf';
    const DISPOSITION = 'attachment; filename="Q3 \\\\ \\"final\\".pdf"';
    const NOW = Date.parse('2026-10-05T12:00:00Z');

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        [
            'presigned.get',
            presigned.get,
            'user-1/batch-1/file-1/f.pdf',
            FILES_DOMAIN,
        ],
        [
            'artifacts.get',
            artifacts.get,
            'user-1/request-1/artifact-1/nexus-part-1.zip',
            ARTIFACTS_DOMAIN,
        ],
    ])(
        '%s signs the key for its own distribution, with the caller’s filename and expiry',
        async (_, mint, key, domain) => {
            vi.useFakeTimers();
            vi.setSystemTime(NOW);

            const url = new URL(
                await mint(key, { filename: FILENAME, expiresIn: 120 })
            );

            expect(url.host).toBe(domain);
            expect(url.pathname).toBe(`/${key}`);
            expect(url.searchParams.get('Key-Pair-Id')).toBe('KTESTPAIR');
            expect(url.searchParams.get('Expires')).toBe(
                String(NOW / 1000 + 120)
            );
            expect(url.searchParams.get('response-content-disposition')).toBe(
                DISPOSITION
            );
        }
    );

    it.each([
        [
            'presigned.get',
            'CLOUDFRONT_FILES_DOMAIN',
            () => presigned.get('user-1/f.pdf'),
            'files-bucket',
        ],
        [
            'artifacts.get',
            'CLOUDFRONT_ARTIFACTS_DOMAIN',
            () => artifacts.get('user-1/r/a/nexus-part-1.zip'),
            'artifacts-bucket',
        ],
    ])(
        '%s falls back to an hour-long S3 presigned GET without %s',
        async (_, domainVar, mint, bucket) => {
            hoisted.env[domainVar] = undefined;

            const url = new URL(await mint());

            expect(url.host).toBe(`${bucket}.s3.us-east-1.amazonaws.com`);
            expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
        }
    );

    it('artifacts.get refuses to sign without the artifacts bucket', async () => {
        hoisted.env.S3_RETRIEVAL_ARTIFACTS_BUCKET = undefined;

        await expect(
            artifacts.get('user-1/r/a/nexus-part-1.zip')
        ).rejects.toThrow(/S3_RETRIEVAL_ARTIFACTS_BUCKET is not set/);
    });
});
