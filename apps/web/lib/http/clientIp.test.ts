import { describe, expect, it } from 'vitest';
import { getClientIp } from './clientIp';

describe('getClientIp', () => {
    it('takes the first hop of x-forwarded-for', () => {
        const headers = new Headers({
            'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2',
        });

        expect(getClientIp(headers)).toBe('203.0.113.7');
    });

    it('drops the space a proxy leaves before the comma', () => {
        const headers = new Headers({
            'x-forwarded-for': '203.0.113.7 , 10.0.0.1',
        });

        expect(getClientIp(headers)).toBe('203.0.113.7');
    });

    it('falls back to x-real-ip', () => {
        expect(getClientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe(
            '203.0.113.9'
        );
    });

    it('prefers x-forwarded-for over x-real-ip', () => {
        const headers = new Headers({
            'x-forwarded-for': '203.0.113.7',
            'x-real-ip': '203.0.113.9',
        });

        expect(getClientIp(headers)).toBe('203.0.113.7');
    });

    it('is undefined when no proxy reported an address', () => {
        expect(getClientIp(new Headers())).toBeUndefined();
        expect(getClientIp(new Headers({ 'x-forwarded-for': ' ' }))).toBe(
            undefined
        );
    });
});
