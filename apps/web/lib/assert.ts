import { NotFoundError } from '@/server/errors';

/**
 * Asserts that all requested IDs were returned from the database.
 * Throws NotFoundError listing the missing IDs if any are absent.
 */
export function assertAllFound<T extends string>(found: T[], requested: T[]): void {
    const foundSet = new Set(found);
    const missing = requested.filter((id) => !foundSet.has(id));
    if (missing.length > 0) {
        throw new NotFoundError(`Records not found: ${missing.join(', ')}`);
    }
}
