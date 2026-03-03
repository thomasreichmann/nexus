import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { s3 } from '@/lib/storage';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB, matches server service

const presignSchema = z.object({
    action: z.literal('presign'),
    filename: z.string().min(1),
    sizeBytes: z.number().positive(),
    mimeType: z.string().optional(),
});

const multipartInitSchema = z.object({
    action: z.literal('multipart-init'),
    filename: z.string().min(1),
    sizeBytes: z.number().positive(),
    mimeType: z.string().optional(),
});

const multipartCompleteSchema = z.object({
    action: z.literal('multipart-complete'),
    key: z.string().min(1),
    uploadId: z.string().min(1),
    parts: z
        .array(z.object({ partNumber: z.number(), etag: z.string() }))
        .min(1),
});

const requestSchema = z.discriminatedUnion('action', [
    presignSchema,
    multipartInitSchema,
    multipartCompleteSchema,
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const data = parsed.data;
    const prefix = `dev-uploads/${Date.now()}`;

    if (data.action === 'presign') {
        const key = `${prefix}/${data.filename}`;
        const uploadUrl = await s3.presigned.put(key, {
            contentType: data.mimeType,
            contentLength: data.sizeBytes,
            expiresIn: 900,
        });
        return NextResponse.json({ key, uploadUrl });
    }

    if (data.action === 'multipart-init') {
        const key = `${prefix}/${data.filename}`;
        const partCount = Math.ceil(data.sizeBytes / CHUNK_SIZE);
        const { uploadId } = await s3.multipart.create(key, data.mimeType);
        const partUrls = await s3.multipart.signParts({
            key,
            uploadId,
            partCount,
            expiresIn: 3600,
        });
        return NextResponse.json({
            key,
            uploadId,
            partUrls,
            chunkSize: CHUNK_SIZE,
        });
    }

    // multipart-complete
    await s3.multipart.complete(data.key, data.uploadId, data.parts);
    return NextResponse.json({ ok: true });
}
