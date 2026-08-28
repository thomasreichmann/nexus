import { retrievalArtifactKey } from '@nexus/db/repo/files';
import { createRetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import { requireEnv } from '../aws';
import { uploadStreamMultipart } from '../multipartUpload';
import { createZipStream } from '../zipStream';
import type { HandlerContext } from '../registry';
import type { RetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';

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
        await completeRequest(requestRepo, existing.requestId);
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

    await completeRequest(requestRepo, artifact.requestId);
}

/** Flip the request complete if this was the last artifact standing. */
async function completeRequest(
    requestRepo: RetrievalRequestRepo,
    requestId: string
): Promise<void> {
    const completed = await requestRepo.completeIfArtifactsReady(requestId);
    if (completed) {
        console.log(
            `build-retrieval-zip: retrieval request ${requestId} is complete.`
        );
    }
}
