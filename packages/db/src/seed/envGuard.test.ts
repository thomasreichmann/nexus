import { describe, expect, it } from 'vitest';
import { checkSeedEnv } from './envGuard';

describe('checkSeedEnv', () => {
    it('refuses when DB_ENV is undefined', () => {
        const result = checkSeedEnv(undefined);
        expect(result.isOk).toBe(false);
        if (!result.isOk) {
            expect(result.message).toContain('DB_ENV is not set');
            expect(result.message).toContain('DB_ENV=development');
        }
    });

    it('refuses when DB_ENV is an empty string', () => {
        const result = checkSeedEnv('');
        expect(result.isOk).toBe(false);
    });

    it('refuses when DB_ENV is only whitespace', () => {
        const result = checkSeedEnv('   ');
        expect(result.isOk).toBe(false);
    });

    it('refuses when DB_ENV is production', () => {
        const result = checkSeedEnv('production');
        expect(result.isOk).toBe(false);
        if (!result.isOk) {
            expect(result.message).toContain('refusing to seed');
        }
    });

    it('refuses production regardless of case and surrounding whitespace', () => {
        expect(checkSeedEnv(' Production ').isOk).toBe(false);
        expect(checkSeedEnv('PRODUCTION').isOk).toBe(false);
    });

    it('allows development', () => {
        expect(checkSeedEnv('development').isOk).toBe(true);
    });

    it('allows other non-production values', () => {
        expect(checkSeedEnv('preview').isOk).toBe(true);
        expect(checkSeedEnv('test').isOk).toBe(true);
    });
});
