import { describe, expect, it } from 'vitest';
import { getRetrievalEstimate } from './RetrieveDialog';

// The dialog itself is presentational and covered by the files-browser e2e
// flows (@uc:files-retrieve-dialog-estimate); only the estimate logic is
// unit-tested here.
describe('getRetrievalEstimate', () => {
    it('is fast for an all-standard batch', () => {
        expect(getRetrievalEstimate(['standard', 'standard'])).toEqual({
            speed: 'fast',
            label: 'Ready in ~minutes',
        });
    });

    it('is slow when any item is deep_archive', () => {
        expect(
            getRetrievalEstimate(['standard', 'standard', 'deep_archive']).speed
        ).toBe('slow');
    });

    it('is slow for an all-deep_archive batch', () => {
        expect(getRetrievalEstimate(['deep_archive', 'deep_archive'])).toEqual({
            speed: 'slow',
            label: 'Ready in up to 12 hours',
        });
    });

    it('folds glacier into the slow bucket', () => {
        expect(getRetrievalEstimate(['standard', 'glacier']).speed).toBe(
            'slow'
        );
    });

    it('is conservatively slow for an empty selection', () => {
        expect(getRetrievalEstimate([]).speed).toBe('slow');
    });
});
