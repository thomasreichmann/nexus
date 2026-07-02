import { describe, expect, it } from 'vitest';
import { DEFAULT_REDIRECT, sanitizeRedirect } from './sanitizeRedirect';

describe('sanitizeRedirect', () => {
    it('passes through same-origin relative paths, query and all', () => {
        expect(sanitizeRedirect('/dashboard/files')).toBe('/dashboard/files');
        expect(sanitizeRedirect('/dashboard/files?file=abc123')).toBe(
            '/dashboard/files?file=abc123'
        );
    });

    it('falls back when no target is supplied', () => {
        expect(sanitizeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
        expect(sanitizeRedirect(null)).toBe(DEFAULT_REDIRECT);
        expect(sanitizeRedirect('')).toBe(DEFAULT_REDIRECT);
    });

    it('rejects off-site targets (open-redirect guard)', () => {
        expect(sanitizeRedirect('https://evil.com')).toBe(DEFAULT_REDIRECT);
        expect(sanitizeRedirect('//evil.com')).toBe(DEFAULT_REDIRECT);
        expect(sanitizeRedirect('/\\evil.com')).toBe(DEFAULT_REDIRECT);
        expect(sanitizeRedirect('javascript:alert(1)')).toBe(DEFAULT_REDIRECT);
        expect(sanitizeRedirect('dashboard')).toBe(DEFAULT_REDIRECT);
    });
});
