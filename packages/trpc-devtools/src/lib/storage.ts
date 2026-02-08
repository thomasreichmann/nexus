import type { TRPCRequest, TRPCResponse } from './request';

const STORAGE_KEY = 'trpc-devtools-history';
const PANEL_SIZES_KEY = 'trpc-devtools-panel-sizes';
const SUPERJSON_KEY = 'trpc-devtools-superjson';
const COLLAPSED_GROUPS_KEY = 'trpc-devtools-collapsed-groups';
const MAX_HISTORY_ITEMS = 50;

export interface HistoryItem {
    id: string;
    request: TRPCRequest;
    response: TRPCResponse;
    timestamp: number;
}

/**
 * Generate a unique ID for a history item
 */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Load request history from localStorage
 */
export function loadHistory(): HistoryItem[] {
    if (typeof window === 'undefined') {
        return [];
    }

    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];

        return parsed;
    } catch {
        return [];
    }
}

/**
 * Save a request/response pair to history
 */
export function saveToHistory(
    request: TRPCRequest,
    response: TRPCResponse
): HistoryItem {
    const item: HistoryItem = {
        id: generateId(),
        request,
        response,
        timestamp: Date.now(),
    };

    const history = loadHistory();

    // Add to beginning, limit size
    history.unshift(item);
    if (history.length > MAX_HISTORY_ITEMS) {
        history.pop();
    }

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
        // Storage might be full or disabled
    }

    return item;
}

/**
 * Clear all history
 */
export function clearHistory(): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore errors
    }
}

/**
 * Delete a specific history item
 */
export function deleteHistoryItem(id: string): void {
    const history = loadHistory();
    const filtered = history.filter((item) => item.id !== id);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch {
        // Ignore errors
    }
}

// Panel sizes storage

export interface PanelSizes {
    horizontal: number; // percentage for first panel (0-100)
    vertical: number;
}

const DEFAULT_PANEL_SIZES: PanelSizes = { horizontal: 50, vertical: 50 };

export function loadPanelSizes(): PanelSizes {
    if (typeof window === 'undefined') return DEFAULT_PANEL_SIZES;

    try {
        const stored = localStorage.getItem(PANEL_SIZES_KEY);
        if (!stored) return DEFAULT_PANEL_SIZES;

        const parsed = JSON.parse(stored);
        if (
            typeof parsed.horizontal !== 'number' ||
            typeof parsed.vertical !== 'number'
        ) {
            return DEFAULT_PANEL_SIZES;
        }

        // Validate ranges
        return {
            horizontal: Math.max(10, Math.min(90, parsed.horizontal)),
            vertical: Math.max(10, Math.min(90, parsed.vertical)),
        };
    } catch {
        return DEFAULT_PANEL_SIZES;
    }
}

export function savePanelSizes(sizes: PanelSizes): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(sizes));
    } catch {
        // Storage might be full or disabled
    }
}

// SuperJSON preference storage

/**
 * Load SuperJSON preference for a given tRPC URL
 */
export function loadSuperJSONPreference(trpcUrl: string): boolean | null {
    if (typeof window === 'undefined') return null;

    try {
        const stored = localStorage.getItem(SUPERJSON_KEY);
        if (!stored) return null;

        const prefs = JSON.parse(stored) as Record<string, boolean>;
        return prefs[trpcUrl] ?? null;
    } catch {
        return null;
    }
}

/**
 * Save SuperJSON preference for a given tRPC URL
 */
export function saveSuperJSONPreference(
    trpcUrl: string,
    usesSuperJSON: boolean
): void {
    if (typeof window === 'undefined') return;

    try {
        const stored = localStorage.getItem(SUPERJSON_KEY);
        const prefs = stored
            ? (JSON.parse(stored) as Record<string, boolean>)
            : {};
        prefs[trpcUrl] = usesSuperJSON;
        localStorage.setItem(SUPERJSON_KEY, JSON.stringify(prefs));
    } catch {
        // Storage might be full or disabled
    }
}

// Collapsed groups storage

/**
 * Load collapsed group names from localStorage
 */
export function loadCollapsedGroups(): string[] {
    if (typeof window === 'undefined') return [];

    try {
        const stored = localStorage.getItem(COLLAPSED_GROUPS_KEY);
        if (!stored) return [];

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];

        // Validate all items are strings
        return parsed.filter(
            (item): item is string => typeof item === 'string'
        );
    } catch {
        return [];
    }
}

/**
 * Save collapsed group names to localStorage
 */
export function saveCollapsedGroups(groups: string[]): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(groups));
    } catch {
        // Storage might be full or disabled
    }
}
