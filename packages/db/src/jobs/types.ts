/** Supported background job types */
export type JobType =
    | 'delete-account'
    | 'generate-thumbnail'
    | 'build-retrieval-zip';

/** Payload shapes per job type */
export interface JobPayloadMap {
    'delete-account': { userId: string };
    'generate-thumbnail': { fileId: string };
    // Just the artifact: it names its request, and the request's items name the
    // files assigned to it. Passing the file list in the message instead would
    // freeze the partition at enqueue time, so a redrive days later would zip a
    // set the DB has since disagreed with.
    'build-retrieval-zip': { artifactId: string };
}

/**
 * Which queue — and therefore which Lambda — runs a job type.
 *
 * Zip builds have their own function because a multi-gigabyte streaming pass
 * needs Lambda's 900s maximum; the general worker's 120s cannot finish one
 * (#424). Both functions ship the same bundle and register every handler, so
 * the queue is the *only* thing that decides where a job runs — which makes a
 * misrouted message a silent timeout rather than a "no handler" error.
 *
 * It lives here, next to the job types, because both publishers must agree:
 * the worker's poll enqueues zip builds, and the admin retry re-publishes any
 * failed job whatever its type. A copy in one of them was exactly the bug —
 * a retried zip build landed on the 120s worker and timed out into the DLQ.
 */
export type JobQueue = 'jobs' | 'zip';

export function queueFor(type: JobType): JobQueue {
    return type === 'build-retrieval-zip' ? 'zip' : 'jobs';
}

/** Type-safe job input — ensures payload matches the job type */
export type JobInput<T extends JobType = JobType> = {
    [K in T]: { type: K; payload: JobPayloadMap[K] };
}[T];

/** Shape of the SQS message body sent for each job */
export interface SqsMessageBody {
    jobId: string;
    type: JobType;
    payload: JobPayloadMap[JobType];
}
