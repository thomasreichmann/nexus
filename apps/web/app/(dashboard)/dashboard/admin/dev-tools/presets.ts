export interface ScenarioPreset {
    name: string;
    description: string;
    fileCount: number;
    retrievalCount: number;
}

export const ME_VALUE = '__me__';

export function getTargetLabel(
    targetUser: string,
    users: { id: string; name: string }[]
): string {
    return targetUser === ME_VALUE
        ? 'me'
        : (users.find((u) => u.id === targetUser)?.name ?? 'user');
}

// Frontend-only quick-seed configs — NOT the backend SCENARIO_DEFINITIONS.
// These map directly to seedForMe/seedForUser params.
export const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
    powerUser: {
        name: 'Power User',
        description: '200 files over a 90-day spread, with active retrievals',
        fileCount: 200,
        retrievalCount: 5,
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
    mixedAges: {
        name: 'Mixed Ages',
        description: '50 files over a 90-day spread, mostly reading as cold',
        fileCount: 50,
        retrievalCount: 0,
    },
    activeRetrievals: {
        name: 'Active Retrievals',
        description: '30 archived files with 8 in various restore states',
        fileCount: 30,
        retrievalCount: 8,
    },
    bulkArchive: {
        name: 'Bulk Archive',
        description: '100 files over the same 90-day spread',
        fileCount: 100,
        retrievalCount: 0,
    },
    photographer: {
        name: 'Photographer',
        description: '150 files, a typical photographer library',
        fileCount: 150,
        retrievalCount: 2,
    },
};
