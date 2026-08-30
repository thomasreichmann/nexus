import { PostHogEvent } from '@nexus/analytics/events';
import { artifactWindowEnd } from '@nexus/db/objectState';
import { retrievalArtifactKey } from '@nexus/db/repo/files';
import { createRetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import { captureWorkerEvent } from '../analytics';
import { requireEnv } from '../aws';
import { sendRetrievalRequestReadyEmail } from '../email';
import { uploadStreamMultipart } from '../multipartUpload';
import { elapsedSeconds } from '../time';
import { createZipStream } from '../zipStream';
import type { HandlerContext } from '../registry';
import type { DB } from '@nexus/db';
import type {
    RetrievalRequest,
    RetrievalRequestRepo,
} from '@nexus/db/repo/retrievalRequests';

/**
 * Build one chunk of a retrieval request into a zip in the artifacts bucket.
 *
 * Streams `GetObject` -> zip writer -> multipart upload, so the archive is
 * never held in memory or on disk (see `zipStream` and `multipartUpload` for
 * the two halves). Runs on the dedicated zip Lambda, which has the runtime a
 * multi-gigabyte pass needs; the general worker's 120s would not finish one.
 */
export async function buildRetrievalZip({
    payload,
    db,
}: HandlerContext<'build-retrieval-zip'>): Promise<void> {
    const { artifactId } = payload;
    const requestRepo = createRetrievalRequestRepo(db);

    const existing = await requestRepo.findArtifactById(artifactId);
    if (!existing) {
        // The request was deleted (artifacts cascade) between enqueue and
        // delivery. Nothing to build and nothing to fail — returning lets SQS
        // drop the message instead of parking it on the DLQ for a human to
        // read and discover there is no work behind it.
        console.warn(
            `build-retrieval-zip: artifact ${artifactId} no longer exists; dropping the job.`
        );
        return;
    }

    // `claimArtifact` refuses a `ready` row, which covers both ways this job
    // can arrive at work already done: a duplicate delivery of an artifact that
    // built long ago, and a concurrent delivery that won the race just now.
    // Skip the rebuild either way, but still run the completion check — the
    // delivery that built it may have died between the two writes.
    const artifact = await requestRepo.claimArtifact(artifactId);
    if (!artifact) {
        console.log(
            `build-retrieval-zip: artifact ${artifactId} is already built; re-checking request completion.`
        );
        await completeRequest(db, requestRepo, existing.requestId);
        return;
    }

    const request = await requestRepo.findById(artifact.requestId);
    if (!request) {
        throw new Error(
            `Artifact ${artifactId} points at missing request ${artifact.requestId}`
        );
    }

    const files = await requestRepo.findArtifactFiles(artifactId);
    if (files.length === 0) {
        throw new Error(
            `Artifact ${artifactId} has no files assigned; the partition did not finish.`
        );
    }

    const key = retrievalArtifactKey({ ...artifact, userId: request.userId });

    try {
        const { sizeBytes } = await uploadStreamMultipart(
            requireEnv('S3_RETRIEVAL_ARTIFACTS_BUCKET'),
            key,
            createZipStream(requireEnv('S3_BUCKET'), files)
        );

        // The object exists before the status flip, matching the thumbnail
        // pipeline's invariant: a `ready` artifact always has a readable zip
        // behind it.
        await requestRepo.completeArtifact(artifactId, {
            s3Key: key,
            sizeBytes,
        });
        console.log(
            `build-retrieval-zip: built ${key} (${files.length} files, ${sizeBytes} bytes).`
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await requestRepo.failArtifact(artifactId, message);
        // Re-thrown so SQS retries and, on exhaustion, the DLQ depth alarm
        // reaches a human — the artifact row alone notifies nobody.
        throw error;
    }

    await completeRequest(db, requestRepo, artifact.requestId);
}

/**
 * Flip the request complete if this was the last artifact standing *and* the
 * thawed originals are still live — see completeIfDeliverable for why a build
 * that outlasted its own restore window no longer completes (#437).
 */
async function completeRequest(
    db: DB,
    requestRepo: RetrievalRequestRepo,
    requestId: string
): Promise<void> {
    const completed = await requestRepo.completeIfDeliverable(requestId);
    if (!completed) return;

    console.log(
        `build-retrieval-zip: retrieval request ${requestId} is complete.`
    );

    // Exactly one job ever gets here for a given request — the winner of the
    // `completed_at` election — which is what makes this one email and one
    // event rather than one per chunk.
    await announceRequestReady(db, requestRepo, completed);
}

/**
 * The delivery half of completion: tell the user, and tell PostHog (#426).
 *
 * Everything here is after the winning UPDATE and must not undo it. The request
 * is complete and its zips are downloadable whether or not Resend answers, so a
 * throw would only make SQS redeliver a build that already succeeded — and the
 * redelivery would find the artifacts `ready` and the request already complete,
 * so it would not even retry the send. Warn and move on.
 */
async function announceRequestReady(
    db: DB,
    requestRepo: RetrievalRequestRepo,
    request: RetrievalRequest
): Promise<void> {
    try {
        const [artifacts, timings] = await Promise.all([
            requestRepo.findArtifacts(request.id),
            requestRepo.findTimings(request.id),
        ]);

        const totalBytes = artifacts.reduce(
            (sum, artifact) => sum + (artifact.sizeBytes ?? 0),
            0
        );
        // The window starts at the earliest artifact, not the last: the reader
        // needs every part, so the request stops being downloadable when its
        // first one lapses.
        const builtAt = earliest(
            artifacts.map((artifact) => artifact.completedAt)
        );

        captureWorkerEvent(request.userId, PostHogEvent.RetrievalReady, {
            requestId: request.id,
            tier: request.tier,
            fileCount: timings.fileCount,
            partCount: artifacts.length,
            totalBytes,
            // The two halves of the wait, separately: S3's thaw is what the
            // poll's tier horizons are tuned against, our build is what the
            // chunk cap is tuned against. Summed they would tune neither.
            thawSeconds: elapsedSeconds(timings.initiatedAt, timings.readyAt),
            buildSeconds: elapsedSeconds(
                earliest(artifacts.map((artifact) => artifact.startedAt)),
                latest(artifacts.map((artifact) => artifact.completedAt))
            ),
        });

        await sendRetrievalRequestReadyEmail(db, {
            userId: request.userId,
            requestId: request.id,
            fileCount: timings.fileCount,
            partCount: artifacts.length,
            totalBytes,
            expiresAt: artifactWindowEnd(builtAt ?? new Date()),
        });
    } catch (error) {
        console.warn(
            `build-retrieval-zip: request ${request.id} completed but could not be announced.`,
            error
        );
    }
}

function earliest(dates: (Date | null)[]): Date | null {
    const times = dates.filter((d): d is Date => d !== null);
    return times.length === 0
        ? null
        : new Date(Math.min(...times.map((d) => d.getTime())));
}

function latest(dates: (Date | null)[]): Date | null {
    const times = dates.filter((d): d is Date => d !== null);
    return times.length === 0
        ? null
        : new Date(Math.max(...times.map((d) => d.getTime())));
}
