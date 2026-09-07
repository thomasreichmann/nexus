import { describe, expect, it } from 'vitest';
import { planVaultLookups, vaultKey } from './duplicates';

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

    it('plans nothing for an empty gesture', () => {
        expect(planVaultLookups([])).toEqual([]);
    });
});
