import { describe, expect, it } from 'vitest';
import { allSamplers, getSamplers } from './index';

describe('getSamplers', () => {
    it('returns all samplers when called with undefined', () => {
        expect(getSamplers()).toBe(allSamplers);
    });

    it('returns all samplers when called with empty array', () => {
        expect(getSamplers([])).toBe(allSamplers);
    });

    it('filters to requested samplers', () => {
        const result = getSamplers(['colors', 'buttons']);
        expect(result.map((s) => s.name)).toEqual(['colors', 'buttons']);
    });

    it('preserves registry order regardless of input order', () => {
        const result = getSamplers(['text', 'colors']);
        expect(result.map((s) => s.name)).toEqual(['colors', 'text']);
    });

    it('returns empty array for non-existent names', () => {
        expect(getSamplers(['nonexistent'])).toEqual([]);
    });
});
