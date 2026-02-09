import { describe, it, expect, beforeEach } from 'vitest';
import { getHandler, registerHandler } from './registry';

describe('registry', () => {
    beforeEach(() => {
        // Register a test handler for each test
        registerHandler('delete-account', async () => {});
    });

    it('returns the registered handler for a known job type', () => {
        const handler = getHandler('delete-account');
        expect(handler).toBeTypeOf('function');
    });

    it('throws for an unknown job type', () => {
        expect(() => getHandler('nonexistent-type')).toThrow(
            'No handler registered for job type: nonexistent-type'
        );
    });
});
