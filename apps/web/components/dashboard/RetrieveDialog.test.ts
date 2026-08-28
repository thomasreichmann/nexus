import {
    LIFECYCLE_TRANSITION_LAG_HOURS,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from '@nexus/db/objectState';
import { hoursAgo } from '@nexus/db/seed';
import { describe, expect, it } from 'vitest';
import { getRetrievalEstimate } from './RetrieveDialog';

// The dialog itself is presentational and covered by the files-browser e2e
// flows (@uc:files-retrieve-dialog-estimate); only the estimate logic is
// unit-tested here. Warm and cold are expressed as the size/age the policy
// actually reads — the estimate applies `isProbablyCold` itself, so handing it
// pre-computed verdicts would test nothing (#416).
const cold = {
    size: LIFECYCLE_TRANSITION_MIN_BYTES + 1,
    createdAt: hoursAgo(LIFECYCLE_TRANSITION_LAG_HOURS + 1),
};
const warmBySize = {
    size: LIFECYCLE_TRANSITION_MIN_BYTES,
    createdAt: hoursAgo(LIFECYCLE_TRANSITION_LAG_HOURS + 1),
};
const warmByAge = {
    size: LIFECYCLE_TRANSITION_MIN_BYTES + 1,
    createdAt: hoursAgo(1),
};

describe('getRetrievalEstimate', () => {
    it('is fast when every item is expected to be warm', () => {
        expect(getRetrievalEstimate([warmBySize, warmByAge])).toEqual({
            speed: 'fast',
            label: 'Ready in ~minutes',
        });
    });

    it('is slow when any item is expected to be cold', () => {
        expect(getRetrievalEstimate([warmBySize, warmByAge, cold]).speed).toBe(
            'slow'
        );
    });

    it('is slow for an all-cold batch', () => {
        expect(getRetrievalEstimate([cold, cold])).toEqual({
            speed: 'slow',
            label: 'Ready in up to 12 hours',
        });
    });

    it('is conservatively slow for an empty selection', () => {
        expect(getRetrievalEstimate([]).speed).toBe('slow');
    });
});
