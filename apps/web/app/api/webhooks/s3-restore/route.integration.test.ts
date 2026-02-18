import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createDb, type DB } from '@nexus/db';
import { webhookEvents, files, retrievals, user } from '@nexus/db/schema';

// Mock SNS signature verification to always pass in tests
vi.mock('@/lib/sns/webhooks', () => ({
    verifySnsMessage: vi.fn().mockResolvedValue(undefined),
}));

const db: DB = createDb(process.env.DATABASE_URL!);

// Track created records for cleanup
const createdWebhookEventIds: string[] = [];
let testUserId: string;
let testFileId: string;
let testRetrievalId: string;

function createSnsNotification(
    messageId: string,
    eventName: string,
    s3Key: string,
    glacierEventData?: {
        restoreEventData: { lifecycleRestorationExpiryTime: string };
    }
) {
    const record: Record<string, unknown> = {
        eventName,
        s3: {
            bucket: { name: 'nexus-storage-files-dev' },
            object: { key: s3Key },
        },
    };

    if (glacierEventData) {
        record.glacierEventData = glacierEventData;
    }

    return {
        Type: 'Notification',
        MessageId: messageId,
        TopicArn: 'arn:aws:sns:us-east-1:123456789:nexus-s3-events-test',
        Subject: 'Amazon S3 Notification',
        Timestamp: new Date().toISOString(),
        Message: JSON.stringify({ Records: [record] }),
    };
}

async function postWebhook(
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
): Promise<Response> {
    // Dynamic import to pick up the mocks
    const { POST } = await import('./route');
    const request = new Request(
        'http://localhost:3000/api/webhooks/s3-restore',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        }
    );
    // NextRequest wraps Request; the handler accepts NextRequest
    const { NextRequest } = await import('next/server');
    const nextReq = new NextRequest(request);
    return POST(nextReq);
}

beforeAll(async () => {
    // Seed test user
    testUserId = `test-webhook-${crypto.randomUUID()}`;
    await db.insert(user).values({
        id: testUserId,
        name: 'Webhook Test User',
        email: `${testUserId}@test.example`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    // Seed test file
    testFileId = `test-file-${crypto.randomUUID()}`;
    await db.insert(files).values({
        id: testFileId,
        userId: testUserId,
        name: 'test-document.pdf',
        size: 1024000,
        mimeType: 'application/pdf',
        s3Key: `${testUserId}/${testFileId}/test-document.pdf`,
        storageTier: 'glacier',
        status: 'available',
    });

    // Seed test retrieval in in_progress state
    testRetrievalId = `test-retrieval-${crypto.randomUUID()}`;
    await db.insert(retrievals).values({
        id: testRetrievalId,
        fileId: testFileId,
        userId: testUserId,
        status: 'in_progress',
        tier: 'standard',
        initiatedAt: new Date(),
    });
});

afterAll(async () => {
    // Clean up webhook events
    for (const id of createdWebhookEventIds) {
        await db.delete(webhookEvents).where(eq(webhookEvents.id, id));
    }

    // Clean up seeded data
    await db.delete(retrievals).where(eq(retrievals.id, testRetrievalId));
    await db.delete(files).where(eq(files.id, testFileId));
    await db.delete(user).where(eq(user.id, testUserId));
});

describe('POST /api/webhooks/s3-restore', () => {
    it('rejects requests with invalid JSON', async () => {
        const { POST } = await import('./route');
        const { NextRequest } = await import('next/server');

        const request = new NextRequest(
            new Request('http://localhost:3000/api/webhooks/s3-restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: 'not json',
            })
        );

        const res = await POST(request);
        expect(res.status).toBe(400);
    });

    it('rejects requests with invalid SNS signature', async () => {
        const { verifySnsMessage } = await import('@/lib/sns/webhooks');
        const mockVerify = vi.mocked(verifySnsMessage);

        // Temporarily make verification fail
        mockVerify.mockRejectedValueOnce(new Error('Invalid signature'));

        // Must NOT be in development mode for signature check
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        try {
            const res = await postWebhook({
                Type: 'Notification',
                MessageId: 'sig-test',
                TopicArn: 'arn:test',
                Message: '{}',
            });
            expect(res.status).toBe(400);
        } finally {
            process.env.NODE_ENV = originalEnv;
        }
    });

    it('handles SNS subscription confirmation', async () => {
        // Mock the fetch call for subscription confirmation
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('OK'));

        const res = await postWebhook({
            Type: 'SubscriptionConfirmation',
            MessageId: 'sub-confirm-test',
            TopicArn: 'arn:aws:sns:us-east-1:123456789:nexus-events',
            Message: 'You have chosen to subscribe...',
            SubscribeURL:
                'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
            Token: 'test-token',
            Timestamp: new Date().toISOString(),
        });

        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription'
        );

        fetchSpy.mockRestore();
    });

    it('returns 200 for duplicate events (idempotency)', async () => {
        const messageId = `idempotency-test-${crypto.randomUUID()}`;
        const s3Key = `${testUserId}/${testFileId}/test-document.pdf`;

        const body = createSnsNotification(
            messageId,
            's3:ObjectRestore:Completed',
            s3Key,
            {
                restoreEventData: {
                    lifecycleRestorationExpiryTime: '2026-03-15T00:00:00.000Z',
                },
            }
        );

        // First request should process
        const res1 = await postWebhook(body);
        expect(res1.status).toBe(200);

        // Track for cleanup
        const record = await db.query.webhookEvents.findFirst({
            where: and(
                eq(webhookEvents.source, 'sns'),
                eq(webhookEvents.externalId, messageId)
            ),
        });
        if (record) createdWebhookEventIds.push(record.id);

        // Reset retrieval status back to in_progress for next test
        await db
            .update(retrievals)
            .set({ status: 'in_progress', readyAt: null, expiresAt: null })
            .where(eq(retrievals.id, testRetrievalId));

        // Second request should be detected as duplicate
        const res2 = await postWebhook(body);
        expect(res2.status).toBe(200);

        const json2 = await res2.json();
        expect(json2.duplicate).toBe(true);
    });

    it('updates retrieval status to ready on ObjectRestore:Completed', async () => {
        const messageId = `completed-test-${crypto.randomUUID()}`;
        const s3Key = `${testUserId}/${testFileId}/test-document.pdf`;
        const expiryTime = '2026-03-15T00:00:00.000Z';

        const body = createSnsNotification(
            messageId,
            's3:ObjectRestore:Completed',
            s3Key,
            {
                restoreEventData: {
                    lifecycleRestorationExpiryTime: expiryTime,
                },
            }
        );

        // Ensure retrieval is in_progress
        await db
            .update(retrievals)
            .set({ status: 'in_progress', readyAt: null, expiresAt: null })
            .where(eq(retrievals.id, testRetrievalId));

        const res = await postWebhook(body);
        expect(res.status).toBe(200);

        // Track for cleanup
        const webhookRecord = await db.query.webhookEvents.findFirst({
            where: and(
                eq(webhookEvents.source, 'sns'),
                eq(webhookEvents.externalId, messageId)
            ),
        });
        if (webhookRecord) createdWebhookEventIds.push(webhookRecord.id);

        // Verify retrieval was updated
        const retrieval = await db.query.retrievals.findFirst({
            where: eq(retrievals.id, testRetrievalId),
        });

        expect(retrieval).toBeDefined();
        expect(retrieval!.status).toBe('ready');
        expect(retrieval!.readyAt).toBeDefined();
        expect(retrieval!.expiresAt).toEqual(new Date(expiryTime));

        // Verify webhook event was marked as processed
        expect(webhookRecord).toBeDefined();
        expect(webhookRecord!.status).toBe('processed');
    });

    it('updates retrieval status to expired on ObjectRestore:Delete', async () => {
        const messageId = `expired-test-${crypto.randomUUID()}`;
        const s3Key = `${testUserId}/${testFileId}/test-document.pdf`;

        // Set retrieval to ready first (restore expiry comes after ready)
        await db
            .update(retrievals)
            .set({
                status: 'ready',
                readyAt: new Date(),
                expiresAt: new Date('2026-03-15'),
            })
            .where(eq(retrievals.id, testRetrievalId));

        const body = createSnsNotification(
            messageId,
            's3:ObjectRestore:Delete',
            s3Key
        );

        const res = await postWebhook(body);
        expect(res.status).toBe(200);

        // Track for cleanup
        const webhookRecord = await db.query.webhookEvents.findFirst({
            where: and(
                eq(webhookEvents.source, 'sns'),
                eq(webhookEvents.externalId, messageId)
            ),
        });
        if (webhookRecord) createdWebhookEventIds.push(webhookRecord.id);

        // Verify retrieval was updated
        const retrieval = await db.query.retrievals.findFirst({
            where: eq(retrievals.id, testRetrievalId),
        });

        expect(retrieval).toBeDefined();
        expect(retrieval!.status).toBe('expired');

        // Verify webhook event was marked as processed
        expect(webhookRecord).toBeDefined();
        expect(webhookRecord!.status).toBe('processed');
    });

    it('handles unknown event types gracefully', async () => {
        const messageId = `unknown-event-${crypto.randomUUID()}`;

        const body = createSnsNotification(
            messageId,
            's3:ObjectRestore:Post',
            'some/unknown/key'
        );

        const res = await postWebhook(body);
        expect(res.status).toBe(200);

        // Track for cleanup
        const webhookRecord = await db.query.webhookEvents.findFirst({
            where: and(
                eq(webhookEvents.source, 'sns'),
                eq(webhookEvents.externalId, messageId)
            ),
        });
        if (webhookRecord) createdWebhookEventIds.push(webhookRecord.id);

        // Event should still be recorded and marked as processed
        expect(webhookRecord).toBeDefined();
        expect(webhookRecord!.status).toBe('processed');
    });
});
