/** Supported background job types */
export type JobType =
    | 'delete-account'
    | 'generate-thumbnail'
    | 'initiate-restore';

/** Payload shapes per job type */
export interface JobPayloadMap {
    'delete-account': { userId: string };
    'generate-thumbnail': { fileId: string };
    // Just the request id: the request row carries the tier and its items carry
    // the file set, so the payload stays a fixed 60 bytes whether the restore
    // covers one file or the 10,000-file cap. Inlining the ids would blow SQS's
    // 256 KB message limit somewhere around 6,000 files.
    'initiate-restore': { requestId: string };
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
