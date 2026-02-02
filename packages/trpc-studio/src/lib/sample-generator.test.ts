import { describe, it, expect } from 'vitest';
import { generateSample, parseJsonWithPosition } from './sample-generator';
import type { JSONSchema } from '@/server/types';

describe('generateSample', () => {
    it('returns undefined for null schema', () => {
        expect(generateSample(null)).toBeUndefined();
    });

    it('uses default value when present', () => {
        const schema: JSONSchema = { type: 'string', default: 'hello' };
        expect(generateSample(schema)).toBe('hello');
    });

    it('generates empty string for string type', () => {
        const schema: JSONSchema = { type: 'string' };
        expect(generateSample(schema)).toBe('');
    });

    it('generates 0 for number type', () => {
        const schema: JSONSchema = { type: 'number' };
        expect(generateSample(schema)).toBe(0);
    });

    it('generates 0 for integer type', () => {
        const schema: JSONSchema = { type: 'integer' };
        expect(generateSample(schema)).toBe(0);
    });

    it('generates false for boolean type', () => {
        const schema: JSONSchema = { type: 'boolean' };
        expect(generateSample(schema)).toBe(false);
    });

    it('generates null for null type', () => {
        const schema: JSONSchema = { type: 'null' };
        expect(generateSample(schema)).toBeNull();
    });

    it('uses const value', () => {
        const schema: JSONSchema = { const: 'fixed' };
        expect(generateSample(schema)).toBe('fixed');
    });

    it('uses first enum value', () => {
        const schema: JSONSchema = { enum: ['a', 'b', 'c'] };
        expect(generateSample(schema)).toBe('a');
    });

    it('generates object with required properties', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
                optional: { type: 'boolean' },
            },
            required: ['name', 'age'],
        };

        expect(generateSample(schema)).toEqual({
            name: '',
            age: 0,
        });
    });

    it('includes optional properties when no required fields', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: {
                a: { type: 'string' },
                b: { type: 'number' },
                c: { type: 'boolean' },
                d: { type: 'string' },
            },
        };

        const result = generateSample(schema) as Record<string, unknown>;
        expect(Object.keys(result)).toHaveLength(3); // First 3 properties
    });

    it('generates array with single sample element', () => {
        const schema: JSONSchema = {
            type: 'array',
            items: { type: 'string' },
        };

        expect(generateSample(schema)).toEqual(['']);
    });

    it('handles tuple arrays', () => {
        const schema: JSONSchema = {
            type: 'array',
            items: [{ type: 'string' }, { type: 'number' }],
        };

        expect(generateSample(schema)).toEqual(['', 0]);
    });

    it('resolves $ref to $defs', () => {
        const schema: JSONSchema = {
            $ref: '#/$defs/User',
        };
        const defs = {
            User: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
            },
        };

        expect(generateSample(schema, defs)).toEqual({ id: '' });
    });

    it('uses first anyOf option', () => {
        const schema: JSONSchema = {
            anyOf: [{ type: 'string' }, { type: 'number' }],
        };

        expect(generateSample(schema)).toBe('');
    });

    it('uses first oneOf option', () => {
        const schema: JSONSchema = {
            oneOf: [{ type: 'number' }, { type: 'string' }],
        };

        expect(generateSample(schema)).toBe(0);
    });

    it('handles union types (first type wins)', () => {
        const schema: JSONSchema = {
            type: ['string', 'null'],
        };

        expect(generateSample(schema)).toBe('');
    });

    it('handles nested objects', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: {
                user: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                    },
                    required: ['name'],
                },
            },
            required: ['user'],
        };

        expect(generateSample(schema)).toEqual({
            user: { name: '' },
        });
    });
});

describe('parseJsonWithPosition', () => {
    it('returns ok true for valid JSON', () => {
        const result = parseJsonWithPosition('{"key": "value"}');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ key: 'value' });
        }
    });

    it('returns ok true for empty string', () => {
        const result = parseJsonWithPosition('');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toBeUndefined();
        }
    });

    it('returns ok true for whitespace only', () => {
        const result = parseJsonWithPosition('   ');
        expect(result.ok).toBe(true);
    });

    it('returns error with position for invalid JSON', () => {
        const result = parseJsonWithPosition('{"key": }');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/Invalid JSON/);
        }
    });

    it('returns error with line and column for multiline JSON', () => {
        const result = parseJsonWithPosition('{\n  "key": \n}');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/Invalid JSON/);
        }
    });
});
