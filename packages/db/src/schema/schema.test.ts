import { describe, expect, it } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from './index';

/**
 * Get all Drizzle table objects from the schema exports.
 * Tables are identified by having a Symbol.toStringTag of 'PgTable'.
 */
function getAllTables(): Array<{ name: string; table: PgTable }> {
    const tables: Array<{ name: string; table: PgTable }> = [];

    for (const [exportName, exportValue] of Object.entries(schema)) {
        if (
            exportValue &&
            typeof exportValue === 'object' &&
            Symbol.toStringTag in exportValue &&
            (exportValue as { [Symbol.toStringTag]: string })[
                Symbol.toStringTag
            ] === 'PgTable'
        ) {
            tables.push({ name: exportName, table: exportValue as PgTable });
        }
    }

    return tables;
}

describe('schema timestamps', () => {
    it('all updatedAt columns have $onUpdate defined', () => {
        const tables = getAllTables();
        const violations: string[] = [];

        for (const { name, table } of tables) {
            const config = getTableConfig(table);

            for (const column of config.columns) {
                if (column.name === 'updated_at') {
                    // Access the internal config to check for onUpdateFn
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const columnConfig = (column as any).config;
                    if (!columnConfig?.onUpdateFn) {
                        violations.push(
                            `Table "${name}" has updatedAt column without $onUpdate()`
                        );
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('timestamps helper produces correct column configuration', () => {
        const { timestamps } = schema;
        const cols = timestamps();

        expect(cols.createdAt).toBeDefined();
        expect(cols.updatedAt).toBeDefined();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatedAtConfig = (cols.updatedAt as any).config;
        expect(updatedAtConfig.onUpdateFn).toBeDefined();
        expect(typeof updatedAtConfig.onUpdateFn).toBe('function');
    });
});
