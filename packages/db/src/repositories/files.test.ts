import { describe, expect, it } from 'vitest';
import { originalKey } from './files';

// The pure parts of the files repository. Everything that runs as SQL is in
// files.integration.test.ts, against a real database. The natural filename
// order (#404) is SQL now too: library.integration.test.ts pins it.

describe('originalKey', () => {
    it('builds the four-segment upload key', () => {
        expect(
            originalKey({
                userId: 'usr_1',
                batchId: 'batch_1',
                id: 'file_1',
                name: '_MG_4501.CR2',
            })
        ).toBe('usr_1/batch_1/file_1/_MG_4501.CR2');
    });
});
