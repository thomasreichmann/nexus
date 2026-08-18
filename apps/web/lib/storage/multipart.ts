import {
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    ListPartsCommand,
    ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { client, bucket } from './client';

const PART_URL_EXPIRY_SECONDS = 3600; // 1 hour for large uploads

interface CreateResult {
    uploadId: string;
}

interface SignPartsOptions {
    key: string;
    uploadId: string;
    partCount: number;
    /** URL expiration in seconds (default: 3600 = 1 hour) */
    expiresIn?: number;
}

interface SignPartsByNumberOptions {
    key: string;
    uploadId: string;
    /** Specific part numbers (1-indexed) to presign — used for resume/re-presign */
    partNumbers: number[];
    /** URL expiration in seconds (default: 3600 = 1 hour) */
    expiresIn?: number;
}

export interface SignedPart {
    partNumber: number;
    url: string;
}

interface CompletePart {
    partNumber: number;
    etag: string;
}

export interface UploadedPart {
    partNumber: number;
    etag: string;
    size: number;
}

/** Initiate an S3 multipart upload, returning the upload ID needed for subsequent part operations */
export async function create(
    key: string,
    contentType?: string
): Promise<CreateResult> {
    const command = new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
    });
    const response = await client.send(command);

    if (!response.UploadId) {
        throw new Error('S3 did not return an UploadId');
    }

    return { uploadId: response.UploadId };
}

/** Generate presigned URLs for all parts in a multipart upload (1-indexed) */
export async function signParts(options: SignPartsOptions): Promise<string[]> {
    const signed = await signPartsByNumber({
        key: options.key,
        uploadId: options.uploadId,
        partNumbers: Array.from({ length: options.partCount }, (_, i) => i + 1),
        expiresIn: options.expiresIn,
    });

    // Callers of the all-parts variant index by position (partNumber - 1).
    return signed.map((part) => part.url);
}

/**
 * Generate presigned URLs for a specific set of part numbers. Used to re-presign
 * only the remaining parts on resume, and to refresh URLs that expired mid-upload
 * (part URLs live 1h) — both without restarting the whole multipart upload.
 */
export async function signPartsByNumber(
    options: SignPartsByNumberOptions
): Promise<SignedPart[]> {
    const expiresIn = options.expiresIn ?? PART_URL_EXPIRY_SECONDS;

    return Promise.all(
        options.partNumbers.map(async (partNumber) => {
            const command = new UploadPartCommand({
                Bucket: bucket,
                Key: options.key,
                UploadId: options.uploadId,
                PartNumber: partNumber,
            });
            const url = await getSignedUrl(client, command, { expiresIn });
            return { partNumber, url };
        })
    );
}

/**
 * List the parts S3 has already received for an in-progress multipart upload.
 * The authoritative source for resume reconciliation: lets the client skip
 * already-uploaded parts even when its local state is stale or lost. Pages
 * through results (S3 returns up to 1000 parts per call, 10000 parts max).
 */
export async function listParts(
    key: string,
    uploadId: string
): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let partNumberMarker: string | undefined;

    do {
        const response = await client.send(
            new ListPartsCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                PartNumberMarker: partNumberMarker,
            })
        );

        for (const part of response.Parts ?? []) {
            // S3 always returns PartNumber and ETag for uploaded parts; guard
            // narrows the SDK's optional types rather than expecting gaps.
            if (part.PartNumber == null || part.ETag == null) continue;
            parts.push({
                partNumber: part.PartNumber,
                etag: part.ETag,
                size: part.Size ?? 0,
            });
        }

        partNumberMarker = response.IsTruncated
            ? response.NextPartNumberMarker
            : undefined;
    } while (partNumberMarker);

    return parts;
}

/** Complete a multipart upload — client must provide ETags received from each part PUT */
export async function complete(
    key: string,
    uploadId: string,
    parts: CompletePart[]
): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
            Parts: parts.map((p) => ({
                PartNumber: p.partNumber,
                ETag: p.etag,
            })),
        },
    });
    await client.send(command);
}

/**
 * Keys with a multipart session S3 still considers open — parts are staged but
 * CompleteMultipartUpload hasn't run. Nothing records the upload ID against the
 * file row, so this is the only way to tell a half-finished multipart upload
 * from a single-part one that never landed.
 *
 * Bucket-wide and unpaginated per call, so it walks the markers rather than
 * trusting the first page.
 */
export async function listOpenKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;

    do {
        const response = await client.send(
            new ListMultipartUploadsCommand({
                Bucket: bucket,
                KeyMarker: keyMarker,
                UploadIdMarker: uploadIdMarker,
            })
        );

        for (const upload of response.Uploads ?? []) {
            if (upload.Key) keys.add(upload.Key);
        }

        keyMarker = response.IsTruncated ? response.NextKeyMarker : undefined;
        uploadIdMarker = response.IsTruncated
            ? response.NextUploadIdMarker
            : undefined;
    } while (keyMarker);

    return keys;
}

/** Abort a multipart upload, cleaning up any uploaded parts on S3 */
export async function abort(key: string, uploadId: string): Promise<void> {
    const command = new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
    });
    await client.send(command);
}
