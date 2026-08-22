import { describe, expect, it } from 'vitest';
import { getRetrievalEstimate } from './RetrieveDialog';

// The dialog itself is presentational and covered by the files-browser e2e
// flows (@uc:files-retrieve-dialog-estimate); only the estimate logic is
// unit-tested here. `true` means "probably cold" — the derived hint, not a
// storage class we claim to know (#416).
describe('getRetrievalEstimate', () => {
    it('is fast when every item is expected to be warm', () => {
        expect(getRetrievalEstimate([false, false])).toEqual({
            speed: 'fast',
            label: 'Ready in ~minutes',
        });
    });

    it('is slow when any item is expected to be cold', () => {
        expect(getRetrievalEstimate([false, false, true]).speed).toBe('slow');
    });

    it('is slow for an all-cold batch', () => {
        expect(getRetrievalEstimate([true, true])).toEqual({
            speed: 'slow',
            label: 'Ready in up to 12 hours',
        });
    });

    it('is conservatively slow for an empty selection', () => {
        expect(getRetrievalEstimate([]).speed).toBe('slow');
    });
});
