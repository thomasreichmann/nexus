import * as schema from '../schema';
import { PLAN_LIMITS, getTrialEnd } from '../plans';
import type { File, NewFile } from './files';
import type { Invite } from './invites';
import type { Job, NewJob } from './jobs';
import type { Retrieval } from './retrievals';
import type {
    RetrievalArtifact,
    RetrievalRequest,
    RetrievalRequestFile,
} from './retrievalRequests';
import type { Subscription } from './subscriptions';
import type { UploadBatch } from './uploadBatches';
import type { User } from './users';
import type { WebhookEvent } from './webhooks';

export const TEST_USER_ID = 'user_test123';
export const TEST_FILE_ID = 'file_test456';
export const TEST_STORAGE_USAGE_ID = 'storage_test789';
export const TEST_JOB_ID = 'job_test101';
export const TEST_RETRIEVAL_ID = 'retrieval_test202';
export const TEST_RETRIEVAL_REQUEST_ID = 'retrieval_request_test808';
export const TEST_RETRIEVAL_ARTIFACT_ID = 'retrieval_artifact_test909';
export const TEST_SUBSCRIPTION_ID = 'sub_test303';
export const TEST_STRIPE_CUSTOMER_ID = 'cus_test303';
export const TEST_WEBHOOK_EVENT_ID = 'wh_test404';
export const TEST_BATCH_ID = 'batch_test505';
export const TEST_INVITE_ID = 'invite_test606';
export const TEST_INVITE_TOKEN = 'test-invite-token-abcdefghijklmnopqrstuvwxyz';
export const TEST_ADMIN_USER_ID = 'admin_test707';

export type { User } from './users';
export type StorageUsage = typeof schema.storageUsage.$inferSelect;

export function createFileFixture(overrides: Partial<File> = {}): File {
    const now = new Date();
    return {
        id: TEST_FILE_ID,
        userId: TEST_USER_ID,
        batchId: null,
        name: 'test-document.pdf',
        size: 1024000,
        mimeType: 'application/pdf',
        s3Key: `${TEST_USER_ID}/${TEST_FILE_ID}`,
        status: 'available',
        thumbnailStatus: 'pending',
        thumbnailWidth: null,
        thumbnailHeight: null,
        durationSeconds: null,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: null,
        deletedAt: null,
        ...overrides,
    };
}

export function createNewFileFixture(
    overrides: Partial<NewFile> = {}
): NewFile {
    return {
        id: TEST_FILE_ID,
        userId: TEST_USER_ID,
        name: 'test-document.pdf',
        size: 1024000,
        mimeType: 'application/pdf',
        s3Key: `${TEST_USER_ID}/${TEST_FILE_ID}`,
        ...overrides,
    };
}

export function createUploadBatchFixture(
    overrides: Partial<UploadBatch> = {}
): UploadBatch {
    const now = new Date();
    return {
        id: TEST_BATCH_ID,
        userId: TEST_USER_ID,
        name: 'Test Batch',
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createUserFixture(overrides: Partial<User> = {}): User {
    const now = new Date();
    const id = overrides.id ?? crypto.randomUUID();
    return {
        id,
        name: 'Test User',
        email: `${id}@test.example`,
        emailVerified: false,
        image: null,
        role: 'user',
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createStorageUsageFixture(
    overrides: Partial<StorageUsage> = {}
): StorageUsage {
    const now = new Date();
    return {
        id: overrides.id ?? crypto.randomUUID(),
        userId: overrides.userId ?? TEST_USER_ID,
        usedBytes: 0,
        fileCount: 0,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createJobFixture(overrides: Partial<Job> = {}): Job {
    const now = new Date();
    return {
        id: TEST_JOB_ID,
        type: 'delete-account',
        payload: { userId: TEST_USER_ID },
        status: 'pending',
        attempts: 0,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createNewJobFixture(overrides: Partial<NewJob> = {}): NewJob {
    return {
        type: 'delete-account',
        payload: { userId: TEST_USER_ID },
        ...overrides,
    };
}

/**
 * Defaults to a fresh trial, matching the schema default and what the signup
 * path writes. Tests that need a paid subscription pass `status` explicitly.
 */
export function createSubscriptionFixture(
    overrides: Partial<Subscription> = {}
): Subscription {
    const now = new Date();
    return {
        id: TEST_SUBSCRIPTION_ID,
        userId: TEST_USER_ID,
        stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
        stripeSubscriptionId: null,
        planTier: 'starter',
        status: 'trialing',
        storageLimit: PLAN_LIMITS.starter,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: getTrialEnd(now),
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createInviteFixture(overrides: Partial<Invite> = {}): Invite {
    const now = new Date();
    return {
        id: TEST_INVITE_ID,
        token: TEST_INVITE_TOKEN,
        email: null,
        storageLimit: null,
        status: 'pending',
        expiresAt: null,
        createdBy: TEST_ADMIN_USER_ID,
        redeemedByUserId: null,
        redeemedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createWebhookEventFixture(
    overrides: Partial<WebhookEvent> = {}
): WebhookEvent {
    const now = new Date();
    return {
        id: TEST_WEBHOOK_EVENT_ID,
        source: 'stripe',
        externalId: 'evt_test',
        eventType: 'customer.subscription.updated',
        payload: {},
        status: 'received',
        error: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createRetrievalFixture(
    overrides: Partial<Retrieval> = {}
): Retrieval {
    const now = new Date();
    return {
        id: TEST_RETRIEVAL_ID,
        fileId: TEST_FILE_ID,
        userId: TEST_USER_ID,
        status: 'pending',
        tier: 'standard',
        initiatedAt: null,
        readyAt: null,
        expiresAt: null,
        restoreDaysToKeep: null,
        failedAt: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createRetrievalRequestFixture(
    overrides: Partial<RetrievalRequest> = {}
): RetrievalRequest {
    const now = new Date();
    return {
        id: TEST_RETRIEVAL_REQUEST_ID,
        userId: TEST_USER_ID,
        uploadBatchId: null,
        tier: 'standard',
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

/**
 * One file of a retrieval request, as the partition and the zip writer see it.
 * Not a table row — the shape `findFiles` projects — so it lives here rather
 * than being rebuilt in each worker test with its own defaults.
 */
export function createRetrievalRequestFileFixture(
    overrides: Partial<RetrievalRequestFile> = {}
): RetrievalRequestFile {
    return {
        fileId: TEST_FILE_ID,
        s3Key: `${TEST_USER_ID}/${TEST_FILE_ID}/photo.cr2`,
        name: 'photo.cr2',
        size: 1024,
        createdAt: new Date('2026-08-01T12:00:00Z'),
        ...overrides,
    };
}

export function createRetrievalArtifactFixture(
    overrides: Partial<RetrievalArtifact> = {}
): RetrievalArtifact {
    const now = new Date();
    return {
        id: TEST_RETRIEVAL_ARTIFACT_ID,
        requestId: TEST_RETRIEVAL_REQUEST_ID,
        position: 0,
        status: 'pending',
        s3Key: null,
        sizeBytes: null,
        attempts: 0,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}
