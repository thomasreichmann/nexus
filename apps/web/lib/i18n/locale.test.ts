import { describe, expect, it } from 'vitest';

import { resolveLocale } from './locale';

describe('resolveLocale', () => {
    it('uses NEXT_LOCALE cookie before Accept-Language', () => {
        expect(
            resolveLocale({
                cookieLocale: 'pt-BR',
                acceptLanguage: 'en-US,en;q=0.9',
            })
        ).toBe('pt-BR');
    });

    it('falls back to Accept-Language when the cookie is missing', () => {
        expect(
            resolveLocale({
                acceptLanguage: 'fr-CA,pt-BR;q=0.9,en;q=0.8',
            })
        ).toBe('pt-BR');
    });

    it('uses q values when matching Accept-Language', () => {
        expect(
            resolveLocale({
                acceptLanguage: 'pt-BR;q=0.4,en-US;q=0.9',
            })
        ).toBe('en');
    });

    it('ignores Accept-Language entries with q=0', () => {
        expect(
            resolveLocale({
                acceptLanguage: 'pt-BR;q=0,en;q=0.8',
            })
        ).toBe('en');
    });

    it('defaults to en for invalid cookie and unsupported languages', () => {
        expect(
            resolveLocale({
                cookieLocale: 'es',
                acceptLanguage: 'fr-CA,fr;q=0.9',
            })
        ).toBe('en');
    });
});
