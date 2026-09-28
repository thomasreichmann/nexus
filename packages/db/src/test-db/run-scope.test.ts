import { describe, expect, it } from 'vitest';
import { runScopedEmail } from './run-scope';

// The scoped address has to stay a valid email (Better Auth's sign-up rejects
// anything else) and keep the shape `deleteStaleRunScopedUsers` sweeps.
describe('runScopedEmail', () => {
    it.each([
        {
            workerIndex: undefined,
            scoped: 'admin-e2e--run-ab12cd34@test.local',
        },
        { workerIndex: 3, scoped: 'admin-e2e--run-ab12cd34-w3@test.local' },
    ])(
        'scopes the local part to the run (worker $workerIndex)',
        ({ workerIndex, scoped }) => {
            expect(
                runScopedEmail('admin-e2e@test.local', 'ab12cd34', workerIndex)
            ).toBe(scoped);
        }
    );

    it('refuses an address the sweep would never clean up', () => {
        expect(() => runScopedEmail('someone@example.com', 'ab12cd34')).toThrow(
            /@test\.local/
        );
    });
});
