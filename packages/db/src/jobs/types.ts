/** Supported background job types */
export type JobType = 'delete-account' | 'generate-thumbnail';

/** Payload shapes per job type */
export interface JobPayloadMap {
    'delete-account': { userId: string };
    'generate-thumbnail': { fileId: string };
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
