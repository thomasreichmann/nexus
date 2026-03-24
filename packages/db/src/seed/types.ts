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

export type StorageTier = File['storageTier'];
export type PlanTier = Subscription['planTier'];
export type SubscriptionStatus = Subscription['status'];
export type RetrievalStatus = Retrieval['status'];

export interface StorageTierDistribution {
    standard?: number;
    glacier?: number;
    deep_archive?: number;
}

export interface FileBuilderOptions {
    count?: number;
    storageTierDistribution?: StorageTierDistribution;
    sizeRange?: { min: number; max: number };
    /** Spread file creation dates over this range for realistic upload history */
    createdAtRange?: { from: Date; to: Date };
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
    storageTierDistribution?: StorageTierDistribution;
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
