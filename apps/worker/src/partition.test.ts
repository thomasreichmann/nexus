import { describe, it, expect } from 'vitest';
import { createRetrievalRequestFileFixture } from '@nexus/db/testing';
import {
    MAX_CHUNK_BYTES,
    MAX_CHUNK_FILES,
    partitionIntoChunks,
} from './partition';
import type { RetrievalRequestFile } from '@nexus/db/repo/retrievalRequests';

function file(name: string, size: number, s3Key = name): RetrievalRequestFile {
    return createRetrievalRequestFileFixture({
        fileId: name,
        s3Key,
        name,
        size,
    });
}

const GB = 1_000_000_000;

describe('partitionIntoChunks', () => {
    it('keeps a set that fits under the cap in one chunk', () => {
        const chunks = partitionIntoChunks([
            file('a', GB),
            file('b', GB),
            file('c', GB),
        ]);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].map((f) => f.name)).toEqual(['a', 'b', 'c']);
    });

    it('starts a new chunk rather than exceeding the byte cap', () => {
        const chunks = partitionIntoChunks([
            file('a', 3 * GB),
            file('b', 1.5 * GB),
        ]);

        expect(chunks.map((c) => c.map((f) => f.name))).toEqual([['a'], ['b']]);
        for (const chunk of chunks) {
            const total = chunk.reduce((sum, f) => sum + f.size, 0);
            expect(total).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
        }
    });

    // Next-fit, not a size-sorted pack: the caller sorted by S3 key so files
    // uploaded together stay together, and reordering here would scatter a
    // shoot across every part of the download.
    it('preserves the caller ordering instead of packing chunks tight', () => {
        const chunks = partitionIntoChunks([
            file('a', 3.9 * GB),
            file('b', 0.5 * GB),
            file('c', 0.05 * GB),
        ]);

        expect(chunks.map((c) => c.map((f) => f.name))).toEqual([
            ['a'],
            ['b', 'c'],
        ]);
    });

    it('caps the entry count so a chunk cannot outgrow zip32', () => {
        const many = Array.from({ length: MAX_CHUNK_FILES + 5 }, (_, i) =>
            file(`f${i}`, 1)
        );

        const chunks = partitionIntoChunks(many);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toHaveLength(MAX_CHUNK_FILES);
        expect(chunks[1]).toHaveLength(5);
    });

    // Refusing would mean refusing to deliver a file the user already stored;
    // the writer falls back to zip64 for this one archive instead.
    it('gives a file larger than the cap a chunk of its own', () => {
        const chunks = partitionIntoChunks([
            file('small', GB),
            file('huge', 6 * GB),
            file('after', GB),
        ]);

        expect(chunks.map((c) => c.map((f) => f.name))).toEqual([
            ['small'],
            ['huge'],
            ['after'],
        ]);
    });

    it('returns no chunks for no files', () => {
        expect(partitionIntoChunks([])).toEqual([]);
    });
});
