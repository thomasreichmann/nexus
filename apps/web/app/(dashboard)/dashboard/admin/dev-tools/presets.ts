export interface ScenarioPreset {
    name: string;
    description: string;
    fileCount: number;
    retrievalCount: number;
    storageTierDistribution?: {
        standard: number;
        glacier: number;
        deep_archive: number;
    };
}

export const ME_VALUE = '__me__';

export const DEFAULT_DISTRIBUTION = {
    standard: 0.33,
    glacier: 0.34,
    deep_archive: 0.33,
};

// Frontend-only quick-seed configs — NOT the backend SCENARIO_DEFINITIONS.
// These map directly to seedForMe/seedForUser params.
export const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
    powerUser: {
        name: 'Power User',
        description: '200 files across tiers with active retrievals',
        fileCount: 200,
        retrievalCount: 5,
        storageTierDistribution: {
            standard: 0.1,
            glacier: 0.6,
            deep_archive: 0.3,
        },
    },
    lightUser: {
        name: 'Light User',
        description: 'A handful of files, no retrievals',
        fileCount: 5,
        retrievalCount: 0,
    },
    quotaNearLimit: {
        name: 'Quota Near Limit',
        description: '30 large files pushing close to starter plan limits',
        fileCount: 30,
        retrievalCount: 0,
    },
    mixedTiers: {
        name: 'Mixed Storage Tiers',
        description: '50 files evenly distributed across all tiers',
        fileCount: 50,
        retrievalCount: 0,
        storageTierDistribution: {
            standard: 0.3,
            glacier: 0.5,
            deep_archive: 0.2,
        },
    },
    activeRetrievals: {
        name: 'Active Retrievals',
        description: '30 glacier files with 8 in various restore states',
        fileCount: 30,
        retrievalCount: 8,
        storageTierDistribution: {
            standard: 0.0,
            glacier: 0.7,
            deep_archive: 0.3,
        },
    },
    bulkArchive: {
        name: 'Bulk Archive',
        description: '100 files all in deep archive',
        fileCount: 100,
        retrievalCount: 0,
        storageTierDistribution: {
            standard: 0.0,
            glacier: 0.0,
            deep_archive: 1.0,
        },
    },
    photographer: {
        name: 'Photographer',
        description: '150 files, mostly glacier with some standard',
        fileCount: 150,
        retrievalCount: 2,
        storageTierDistribution: {
            standard: 0.15,
            glacier: 0.75,
            deep_archive: 0.1,
        },
    },
};
