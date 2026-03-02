import {
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
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

interface CompletePart {
    partNumber: number;
    etag: string;
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
    const expiresIn = options.expiresIn ?? PART_URL_EXPIRY_SECONDS;

    const urls = await Promise.all(
        Array.from({ length: options.partCount }, (_, i) => {
            const command = new UploadPartCommand({
                Bucket: bucket,
                Key: options.key,
                UploadId: options.uploadId,
                PartNumber: i + 1,
            });
            return getSignedUrl(client, command, { expiresIn });
        })
    );

    return urls;
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

/** Abort a multipart upload, cleaning up any uploaded parts on S3 */
export async function abort(key: string, uploadId: string): Promise<void> {
    const command = new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
    });
    await client.send(command);
}
