import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
    it('matches an empty query against anything', () => {
        expect(fuzzyMatch('', 'files.list')).toEqual({
            score: 0,
            indices: [],
        });
    });

    it('returns null when the query is not a subsequence', () => {
        expect(fuzzyMatch('xyz', 'files.list')).toBeNull();
        expect(fuzzyMatch('listx', 'files.list')).toBeNull();
    });

    it('is case-insensitive', () => {
        expect(fuzzyMatch('FILES', 'files.list')).not.toBeNull();
        expect(fuzzyMatch('files', 'FILES.LIST')).not.toBeNull();
    });

    it('returns the matched character indices', () => {
        const match = fuzzyMatch('fi', 'files.list');
        expect(match?.indices).toEqual([0, 1]);
    });

    it('prefers a contiguous alignment over the first occurrence', () => {
        // Greedy matching would pick the 'l' in "files"; the best alignment
        // is the contiguous "list" segment
        const match = fuzzyMatch('list', 'files.list');
        expect(match?.indices).toEqual([6, 7, 8, 9]);
    });

    it('scores consecutive matches above scattered ones', () => {
        const consecutive = fuzzyMatch('list', 'files.list');
        const scattered = fuzzyMatch('list', 'labels.instant');
        expect(consecutive).not.toBeNull();
        expect(scattered).not.toBeNull();
        expect(consecutive!.score).toBeGreaterThan(scattered!.score);
    });

    it('scores segment-start matches above mid-word ones', () => {
        const boundary = fuzzyMatch('li', 'files.list');
        const midWord = fuzzyMatch('li', 'fzzzlizzz');
        expect(boundary!.score).toBeGreaterThan(midWord!.score);
    });
});

describe('fuzzyFilter', () => {
    const items = ['files.list', 'files.delete', 'auth.login', 'user.get'];

    it('keeps only matching items', () => {
        const results = fuzzyFilter(items, 'files', (s) => s);
        expect(results.map((r) => r.item)).toEqual([
            'files.list',
            'files.delete',
        ]);
    });

    it('ranks better matches first', () => {
        const results = fuzzyFilter(items, 'list', (s) => s);
        expect(results[0].item).toBe('files.list');
    });

    it('returns everything for an empty query', () => {
        expect(fuzzyFilter(items, '', (s) => s)).toHaveLength(items.length);
    });
});
