import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocalDevelopment, resolveRuntimeEnvironment } from './runtime';

describe('runtime environment detection', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('isLocalDevelopment', () => {
        it('is true only for local dev: NODE_ENV=development and no VERCEL_ENV', () => {
            vi.stubEnv('NODE_ENV', 'development');
            vi.stubEnv('VERCEL_ENV', undefined);
            expect(isLocalDevelopment()).toBe(true);
        });

        it('is false in production', () => {
            vi.stubEnv('NODE_ENV', 'production');
            vi.stubEnv('VERCEL_ENV', 'production');
            expect(isLocalDevelopment()).toBe(false);
        });

        // The defense-in-depth case: a deployment must never open the bypass
        // even if NODE_ENV were misconfigured, because VERCEL_ENV is present.
        it.each(['production', 'preview', 'development'])(
            'is false on a Vercel %s deployment even when NODE_ENV=development',
            (vercelEnv) => {
                vi.stubEnv('NODE_ENV', 'development');
                vi.stubEnv('VERCEL_ENV', vercelEnv);
                expect(isLocalDevelopment()).toBe(false);
            }
        );
    });

    describe('resolveRuntimeEnvironment', () => {
        it('prefers VERCEL_ENV when set', () => {
            vi.stubEnv('VERCEL_ENV', 'preview');
            vi.stubEnv('NODE_ENV', 'production');
            expect(resolveRuntimeEnvironment()).toBe('preview');
        });

        it('falls back to NODE_ENV off-Vercel', () => {
            vi.stubEnv('VERCEL_ENV', undefined);
            vi.stubEnv('NODE_ENV', 'test');
            expect(resolveRuntimeEnvironment()).toBe('test');
        });
    });
});
