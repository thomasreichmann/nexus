import type * as schema from '../schema';

// Entity types inferred from Drizzle schema
export type User = typeof schema.user.$inferSelect;
export type NewUser = typeof schema.user.$inferInsert;
export type File = typeof schema.files.$inferSelect;
export type NewFile = typeof schema.files.$inferInsert;
export type Subscription = typeof schema.subscriptions.$inferSelect;
export type NewSubscription = typeof schema.subscriptions.$inferInsert;
export type StorageUsage = typeof schema.storageUsage.$inferSelect;
export type NewStorageUsage = typeof schema.storageUsage.$inferInsert;
export type Retrieval = typeof schema.retrievals.$inferSelect;
export type NewRetrieval = typeof schema.retrievals.$inferInsert;

export type PlanTier = Subscription['planTier'];
export type SubscriptionStatus = Subscription['status'];
export type RetrievalStatus = Retrieval['status'];

// No storage-tier knob: S3 owns object state, so how cold a seeded file looks
// falls out of `sizeRange` and `createdAtRange` via `isProbablyCold` (#416).
// Seed files large and old to get cold ones, small or fresh to get warm ones.
export interface FileBuilderOptions {
    count?: number;
    sizeRange?: { min: number; max: number };
    /** Spread file creation dates over this range for realistic upload history */
    createdAtRange?: { from: Date; to: Date };
    /**
     * Guarantee that at least this many of the seeded files read as
     * `isProbablyCold` — use it whenever the caller goes on to attach N
     * retrievals, so `files.filter(isProbablyCold)` can't come back short.
     * These files are sized above the lifecycle floor and dated past the lag
     * regardless of `sizeRange`/`createdAtRange`; the rest stay random, so a
     * seed still contains warm files to exercise the direct-download path.
     */
    coldCount?: number;
}

export interface RetrievalBuilderOptions {
    count?: number;
    /** Distribution of retrieval statuses. Defaults to mixed active statuses. */
    statusDistribution?: Partial<Record<RetrievalStatus, number>>;
}

export interface CustomSeedOptions {
    existingUserId?: string;
    userName?: string;
    fileCount?: number;
    planTier?: PlanTier;
    subscriptionStatus?: SubscriptionStatus;
    retrievalCount?: number;
}

export interface SeedResult {
    users: User[];
    files: File[];
    subscriptions: Subscription[];
    retrievals: Retrieval[];
    storageUsage: StorageUsage[];
}

export interface SeedSummary {
    users: number;
    files: number;
    subscriptions: number;
    retrievals: number;
    totalBytes: number;
    /** Seeded users with their file counts for the cleanup-by-user feature */
    userDetails: {
        id: string;
        name: string;
        email: string;
        fileCount: number;
    }[];
}

export interface CleanupResult {
    deletedUsers: number;
    deletedFiles: number;
    deletedSubscriptions: number;
    deletedRetrievals: number;
    deletedStorageUsage: number;
}

export interface ScenarioDefinition {
    name: string;
    description: string;
    /** Approximate entity counts for display in the UI */
    estimates: {
        users: number;
        files: number;
        subscriptions: number;
        retrievals: number;
    };
}
