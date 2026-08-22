// Re-export from canonical source in @nexus/db
export {
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    RESTORE_TIERS,
    type RestoreTier,
} from '@nexus/db/schema';

// Object-state semantics are shared with the worker's retrieval poll, so they
// live in @nexus/db — see that module's docblock.
export type { ObjectState, ObjectAvailability } from '@nexus/db/object-state';

export interface PutPresignOptions {
    contentType?: string;
    contentLength?: number;
    /** URL expiration in seconds (default: 900 = 15 minutes) */
    expiresIn?: number;
}

export interface GetPresignOptions {
    /** URL expiration in seconds (default: 3600 = 1 hour) */
    expiresIn?: number;
    /** Sets Content-Disposition header for download filename */
    filename?: string;
}
