import type { TRPCRequest, TRPCResponse } from './request';

const STORAGE_KEY = 'trpc-studio-history';
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
