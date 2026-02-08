import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
    it('merges class names', () => {
        expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('handles conditional classes', () => {
        const shouldInclude = false;
        const shouldAlsoInclude = true;
        expect(cn('foo', shouldInclude && 'bar', 'baz')).toBe('foo baz');
        expect(cn('foo', shouldAlsoInclude && 'bar', 'baz')).toBe(
            'foo bar baz'
        );
    });

    it('deduplicates tailwind classes', () => {
        expect(cn('px-2', 'px-4')).toBe('px-4');
        expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    });

    it('handles undefined and null', () => {
        expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
    });
});
