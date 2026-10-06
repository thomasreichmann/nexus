import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { env } from '@/lib/env';

/**
 * Signed download URLs through the CloudFront distributions in front of the
 * files and retrieval-artifacts buckets (#345, `infra/terraform/cloudfront.tf`).
 * The same bytes as an S3 presigned GET, but S3 -> CloudFront transfer is free
 * and CloudFront -> user starts with 1 TB/month free, where S3 -> user bills
 * $0.09/GB from the first byte past 100 GB.
 *
 * One distribution per bucket, so a URL's path is the object key itself and
 * nothing at the edge rewrites it. Each distribution only honours URLs signed
 * by the key pair in CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY.
 *
 * Internal to `lib/storage`: callers keep using `presigned.get` and
 * `artifacts.get`, which route here when their bucket's distribution is
 * configured.
 */

export interface Distribution {
    domain: string;
    keyPairId: string;
    privateKey: string;
}

export interface SignedGetOptions {
    /** Seconds until the URL stops working. */
    expiresIn: number;
    /** Forwarded to S3 as `response-content-disposition`. */
    contentDisposition?: string;
}

/** The files bucket's distribution, or undefined to keep S3 presigned GETs. */
export function getFilesDistribution(): Distribution | undefined {
    return resolveDistribution(
        'CLOUDFRONT_FILES_DOMAIN',
        env.CLOUDFRONT_FILES_DOMAIN
    );
}

/** The artifacts bucket's distribution, or undefined to keep S3 presigned GETs. */
export function getArtifactsDistribution(): Distribution | undefined {
    return resolveDistribution(
        'CLOUDFRONT_ARTIFACTS_DOMAIN',
        env.CLOUDFRONT_ARTIFACTS_DOMAIN
    );
}

// A domain without its key pair throws instead of falling back. Falling back
// would keep downloads working while every byte quietly bills at the S3 rate,
// which is the failure #345 exists to remove. Throwing surfaces on the first
// click in dev or preview, before it reaches prod.
function resolveDistribution(
    domainVar: string,
    domain: string | undefined
): Distribution | undefined {
    if (!domain) return undefined;
    const keyPairId = env.CLOUDFRONT_KEY_PAIR_ID;
    const privateKey = env.CLOUDFRONT_PRIVATE_KEY;
    if (!keyPairId || !privateKey) {
        throw new Error(
            `${domainVar} is set but CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY are not — set both, or unset ${domainVar} to serve S3 presigned GETs`
        );
    }
    return { domain, keyPairId, privateKey };
}

/**
 * A canned-policy signed GET for `key`. The signature covers the whole URL,
 * the disposition parameter included, so the saved filename can't be edited
 * without invalidating the link.
 */
export function signGet(
    distribution: Distribution,
    key: string,
    options: SignedGetOptions
): string {
    // Segment by segment so the key's slashes stay path separators. Single-file
    // keys end in the user's filename, where `?`, `#` and `%` would otherwise
    // end the path or start an escape.
    const path = key.split('/').map(encodeURIComponent).join('/');
    const query = options.contentDisposition
        ? `?response-content-disposition=${encodeURIComponent(options.contentDisposition)}`
        : '';

    return getSignedUrl({
        url: `https://${distribution.domain}/${path}${query}`,
        keyPairId: distribution.keyPairId,
        privateKey: distribution.privateKey,
        dateLessThan: new Date(Date.now() + options.expiresIn * 1000),
        algorithm: 'SHA256',
    });
}
