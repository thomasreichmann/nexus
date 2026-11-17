import { formatBytes } from '@/lib/format';
import {
    MAX_SHARE_BYTES,
    MAX_SHARE_BYTES_GLOBAL,
    MAX_SHARE_BYTES_PER_IP,
    MAX_SHARE_FILES,
    MAX_SHARES_PER_IP,
} from './limits';

/**
 * The decisions behind a share link, with no I/O: the page runs the selection
 * check before it asks the server for anything, and the service runs both
 * against what it read from the database.
 */

export type SelectionProblem = 'empty' | 'too-many-files' | 'too-large';

const SELECTION_PROBLEM_MESSAGES: Record<SelectionProblem, string> = {
    empty: 'Add at least one file',
    'too-many-files': `A link holds up to ${MAX_SHARE_FILES} files`,
    'too-large': `A link holds up to ${formatBytes(MAX_SHARE_BYTES)} in total`,
};

/** Why these files can't become one link, or `null` when they can. */
export function checkSelection(
    files: readonly { size: number }[]
): SelectionProblem | null {
    if (files.length === 0) return 'empty';
    if (files.length > MAX_SHARE_FILES) return 'too-many-files';
    if (totalSize(files) > MAX_SHARE_BYTES) return 'too-large';
    return null;
}

export function selectionProblemMessage(problem: SelectionProblem): string {
    return SELECTION_PROBLEM_MESSAGES[problem];
}

export function totalSize(files: readonly { size: number }[]): number {
    return files.reduce((sum, file) => sum + file.size, 0);
}

/** What was created inside the rate window, before the link being asked for. */
export interface ShareBudgetUsage {
    ipShares: number;
    ipBytes: number;
    globalBytes: number;
}

export type BudgetProblem = 'ip-shares' | 'ip-bytes' | 'global-bytes';

const BUDGET_PROBLEM_MESSAGES: Record<BudgetProblem, string> = {
    'ip-shares': `You've reached the limit of ${MAX_SHARES_PER_IP} links a day. Try again tomorrow`,
    'ip-bytes': `You've reached the limit of ${formatBytes(MAX_SHARE_BYTES_PER_IP)} a day. Try again tomorrow, or share fewer files`,
    'global-bytes':
        'Sharing is at capacity right now. Try again in a few hours',
};

/**
 * Which creation limit a link of `requestedBytes` would break, or `null` when
 * it fits. Each limit is inclusive: usage may reach it exactly.
 */
export function checkShareBudget(
    usage: ShareBudgetUsage,
    requestedBytes: number
): BudgetProblem | null {
    if (usage.ipShares + 1 > MAX_SHARES_PER_IP) return 'ip-shares';
    if (usage.ipBytes + requestedBytes > MAX_SHARE_BYTES_PER_IP) {
        return 'ip-bytes';
    }
    if (usage.globalBytes + requestedBytes > MAX_SHARE_BYTES_GLOBAL) {
        return 'global-bytes';
    }
    return null;
}

export function budgetProblemMessage(problem: BudgetProblem): string {
    return BUDGET_PROBLEM_MESSAGES[problem];
}

const MAX_DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * Lifetime of a download URL minted at `now`: an hour, like every other
 * download in the app, cut short so no URL outlives the link it came from.
 */
export function downloadUrlTtlSeconds(expiresAt: Date, now: Date): number {
    const remaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);
    return Math.max(1, Math.min(MAX_DOWNLOAD_URL_TTL_SECONDS, remaining));
}
