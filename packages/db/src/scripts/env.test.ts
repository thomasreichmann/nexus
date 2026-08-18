import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatDatabaseTarget } from './env';

const SUPABASE_URL =
    'postgres://postgres.abcdefghijklmnop:sup3r-s3cret@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

describe('formatDatabaseTarget', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('never prints the password', () => {
        expect(formatDatabaseTarget(SUPABASE_URL)).not.toContain(
            'sup3r-s3cret'
        );
    });

    it('keeps the user, which is what tells two Supabase projects apart', () => {
        // Host and database are identical across projects; only the ref differs.
        expect(formatDatabaseTarget(SUPABASE_URL)).toContain(
            'postgres.abcdefghijklmnop'
        );
    });

    it('names host, port and database', () => {
        expect(formatDatabaseTarget(SUPABASE_URL)).toContain(
            'aws-1-us-east-1.pooler.supabase.com:6543/postgres'
        );
    });

    it('distinguishes a worktree database from the shared dev one', () => {
        expect(
            formatDatabaseTarget('postgres://thomas@localhost:5432/nexus_wt_x')
        ).toContain('thomas @ localhost:5432/nexus_wt_x');
    });

    it('defaults the port when the URL omits it', () => {
        expect(
            formatDatabaseTarget('postgres://thomas@localhost/nexus')
        ).toContain('localhost:5432/nexus');
    });

    it('appends DB_ENV when set, and omits the suffix when not', () => {
        vi.stubEnv('DB_ENV', 'production');
        expect(formatDatabaseTarget(SUPABASE_URL)).toContain(
            '(DB_ENV=production)'
        );

        vi.stubEnv('DB_ENV', '');
        expect(formatDatabaseTarget(SUPABASE_URL)).not.toContain('DB_ENV');
    });

    it('degrades to a marker rather than throwing on a malformed URL', () => {
        // A banner must never be the reason a migration fails to start.
        expect(formatDatabaseTarget('not-a-url')).toBe(
            '→ (unparseable DATABASE_URL)'
        );
    });
});
