import { describe, expect, it } from 'vitest';
import { planVaultLookups, vaultKey } from './duplicates';
import { MAX_FILES_PER_VAULT_LOOKUP } from './limits';

// Vercel rejects a function request body above 4.5 MB.
const MAX_REQUEST_BODY_BYTES = 4.5 * 1024 * 1024;

describe('vaultKey', () => {
    it('separates name from size so different sizes never collide', () => {
        expect(vaultKey({ name: 'a.jpg', size: 1 })).not.toBe(
            vaultKey({ name: 'a.jpg', size: 10 })
        );
        expect(vaultKey({ name: '1:a.jpg', size: 1 })).not.toBe(
            vaultKey({ name: 'a.jpg', size: 11 })
        );
    });
});

describe('planVaultLookups', () => {
    it('sends each name + size pair once, as bare identities', () => {
        const file = new File(['x'], 'IMG_0001.CR2');
        const plan = planVaultLookups([file, file, { name: 'b.jpg', size: 1 }]);

        expect(plan).toEqual([
            [
                { name: 'IMG_0001.CR2', size: 1 },
                { name: 'b.jpg', size: 1 },
            ],
        ]);
        expect(plan[0][0]).not.toBeInstanceOf(File);
    });

    it('keeps same-named files of different sizes distinct', () => {
        const plan = planVaultLookups([
            { name: 'a.jpg', size: 1 },
            { name: 'a.jpg', size: 2 },
        ]);

        expect(plan[0]).toHaveLength(2);
    });

    it('chunks at the cap so an oversized selection is still answered', () => {
        const files = Array.from({ length: 5 }, (_, i) => ({
            name: `f${i}`,
            size: i,
        }));

        const plan = planVaultLookups(files, 2);

        expect(plan.map((chunk) => chunk.length)).toEqual([2, 2, 1]);
    });

    it('splits a drop over the lookup cap into several requests', () => {
        const files = Array.from(
            { length: MAX_FILES_PER_VAULT_LOOKUP * 2 + 1 },
            (_, i) => ({ name: `IMG_${i}.CR2`, size: i })
        );

        const plan = planVaultLookups(files);

        expect(plan.map((chunk) => chunk.length)).toEqual([
            MAX_FILES_PER_VAULT_LOOKUP,
            MAX_FILES_PER_VAULT_LOOKUP,
            1,
        ]);
    });

    it('keeps a full chunk of worst-case names under the request body limit', () => {
        // 255 UTF-16 units is the schema's name cap; a BMP CJK character is
        // one unit but three UTF-8 bytes, the most bytes per unit there is.
        // Distinct sizes keep every identity distinct under one shared name.
        const name = '語'.repeat(255);
        const files = Array.from(
            { length: MAX_FILES_PER_VAULT_LOOKUP },
            (_, i) => ({ name, size: Number.MAX_SAFE_INTEGER - i })
        );

        const [chunk] = planVaultLookups(files);
        const body = new TextEncoder().encode(JSON.stringify({ files: chunk }));

        expect(chunk).toHaveLength(MAX_FILES_PER_VAULT_LOOKUP);
        expect(body.byteLength).toBeLessThan(MAX_REQUEST_BODY_BYTES);
    });

    it('plans nothing for an empty gesture', () => {
        expect(planVaultLookups([])).toEqual([]);
    });
});
