import { describe, expect, it } from 'vitest';
import { deriveStatus, getFileExtension } from './status';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

// Fixtures only carry the fields deriveStatus reads; the rest of the File
// row is irrelevant to the status mapping.
function fileWith(
    status: FileWithRetrieval['status'],
    activeRetrieval: FileWithRetrieval['activeRetrieval']
): FileWithRetrieval {
    return { status, activeRetrieval } as FileWithRetrieval;
}

// These buckets must match countStatusesByUser in
// packages/db/src/repositories/files.ts — see the lockstep note on
// deriveStatus.
describe('deriveStatus', () => {
    it('is available when the active retrieval is ready', () => {
        expect(
            deriveStatus(
                fileWith('available', { status: 'ready', expiresAt: null })
            )
        ).toBe('available');
    });

    it('is retrieving while the active retrieval is pending or in progress', () => {
        expect(
            deriveStatus(
                fileWith('available', { status: 'pending', expiresAt: null })
            )
        ).toBe('retrieving');
        expect(
            deriveStatus(
                fileWith('restoring', {
                    status: 'in_progress',
                    expiresAt: null,
                })
            )
        ).toBe('retrieving');
    });

    it('is retrieving when the file row says restoring even without an active retrieval', () => {
        expect(deriveStatus(fileWith('restoring', null))).toBe('retrieving');
    });

    it('is archived without an active retrieval — even for available files (#256)', () => {
        expect(deriveStatus(fileWith('available', null))).toBe('archived');
        expect(deriveStatus(fileWith('uploading', null))).toBe('archived');
    });
});

describe('getFileExtension', () => {
    it('returns the lowercased final extension', () => {
        expect(getFileExtension('IMG_0042.JPG')).toBe('jpg');
        expect(getFileExtension('archive.tar.gz')).toBe('gz');
    });

    it('returns empty for extensionless names', () => {
        expect(getFileExtension('README')).toBe('');
    });
});
