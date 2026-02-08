import { describe, it, expect } from 'vitest';
import { parseZodError, formatIssuePath } from './zod-error';

describe('parseZodError', () => {
    it('parses a typical Zod v4 validation error', () => {
        const issues = [
            {
                path: ['email'],
                message: 'Invalid email',
                code: 'invalid_string',
            },
            {
                path: ['age'],
                message: 'Expected number, received string',
                code: 'invalid_type',
                expected: 'number',
                received: 'string',
            },
        ];

        const result = parseZodError({
            message: JSON.stringify(issues, null, 2),
            code: 'BAD_REQUEST',
        });

        expect(result).toEqual([
            {
                path: ['email'],
                message: 'Invalid email',
                code: 'invalid_string',
                expected: undefined,
                received: undefined,
            },
            {
                path: ['age'],
                message: 'Expected number, received string',
                code: 'invalid_type',
                expected: 'number',
                received: 'string',
            },
        ]);
    });

    it('parses issues with nested paths', () => {
        const issues = [
            {
                path: ['user', 'address', 0, 'street'],
                message: 'Required',
                code: 'invalid_type',
            },
        ];

        const result = parseZodError({
            message: JSON.stringify(issues),
        });

        expect(result).toHaveLength(1);
        expect(result![0].path).toEqual(['user', 'address', 0, 'street']);
    });

    it('parses issues with empty path (root-level error)', () => {
        const issues = [
            {
                path: [],
                message: 'Invalid input',
            },
        ];

        const result = parseZodError({
            message: JSON.stringify(issues),
        });

        expect(result).toHaveLength(1);
        expect(result![0].path).toEqual([]);
        expect(result![0].message).toBe('Invalid input');
    });

    it('returns null for non-JSON message', () => {
        expect(parseZodError({ message: 'Something went wrong' })).toBeNull();
    });

    it('returns null for JSON object (not array)', () => {
        expect(
            parseZodError({ message: JSON.stringify({ error: 'bad' }) })
        ).toBeNull();
    });

    it('returns null for empty array', () => {
        expect(parseZodError({ message: '[]' })).toBeNull();
    });

    it('returns null for array without path field', () => {
        const items = [{ message: 'bad', code: 'err' }];
        expect(parseZodError({ message: JSON.stringify(items) })).toBeNull();
    });

    it('returns null for array without message field', () => {
        const items = [{ path: ['foo'], code: 'err' }];
        expect(parseZodError({ message: JSON.stringify(items) })).toBeNull();
    });

    it('returns null for array where path is not an array', () => {
        const items = [{ path: 'foo', message: 'bad' }];
        expect(parseZodError({ message: JSON.stringify(items) })).toBeNull();
    });

    it('returns null for undefined error', () => {
        expect(parseZodError(undefined)).toBeNull();
    });

    it('returns null for empty message', () => {
        expect(parseZodError({ message: '' })).toBeNull();
    });

    it('omits non-string optional fields', () => {
        const issues = [
            {
                path: ['x'],
                message: 'bad',
                code: 123,
                expected: true,
                received: null,
            },
        ];

        const result = parseZodError({
            message: JSON.stringify(issues),
        });

        expect(result![0].code).toBeUndefined();
        expect(result![0].expected).toBeUndefined();
        expect(result![0].received).toBeUndefined();
    });
});

describe('formatIssuePath', () => {
    it('formats simple path', () => {
        expect(formatIssuePath(['email'])).toBe('email');
    });

    it('formats nested path', () => {
        expect(formatIssuePath(['user', 'name'])).toBe('user.name');
    });

    it('formats path with array index', () => {
        expect(formatIssuePath(['items', 0, 'name'])).toBe('items[0].name');
    });

    it('formats path with multiple array indices', () => {
        expect(formatIssuePath(['a', 0, 'b', 1, 'c'])).toBe('a[0].b[1].c');
    });

    it('formats empty path as (root)', () => {
        expect(formatIssuePath([])).toBe('(root)');
    });

    it('formats path starting with array index', () => {
        expect(formatIssuePath([0, 'name'])).toBe('[0].name');
    });
});
