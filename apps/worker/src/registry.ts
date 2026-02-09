import type { DB, JobType, JobPayloadMap } from '@nexus/db';

export interface HandlerContext<T extends JobType = JobType> {
    jobId: string;
    payload: JobPayloadMap[T];
    db: DB;
}

type JobHandler<T extends JobType = JobType> = (
    ctx: HandlerContext<T>
) => Promise<void>;

const handlers: Partial<Record<JobType, JobHandler>> = {};

export function registerHandler<T extends JobType>(
    type: T,
    handler: JobHandler<T>
): void {
    handlers[type] = handler as JobHandler;
}

export function getHandler(type: string): JobHandler {
    const handler = handlers[type as JobType];
    if (!handler) {
        throw new Error(`No handler registered for job type: ${type}`);
    }
    return handler;
}
