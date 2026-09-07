/**
 * Pure helpers for the queue's "already in your vault" check (#401), split
 * out of the upload hook the same way ./parts is.
 */
import { MAX_FILES_PER_DROP } from './limits';
import type { NameAndSize } from '@nexus/db/repo/files';

/**
 * The identity the vault check matches on — the server's own contract, so
 * the rule is stated once. Name + size, nothing else: the server stores no
 * mtime and no checksum, which makes this deliberately weaker than
 * `FileIdentity` in ./parts. That one asks "is this the file I was in the
 * middle of uploading?", this one asks "is a file like this already
 * committed?". Two same-named, same-sized files in different subfolders
 * collapse to one identity; the per-row override exists for that case.
 */
export type VaultIdentity = NameAndSize;

/** Lookup key for an identity. Size leads because it can't contain `:`. */
export function vaultKey(identity: VaultIdentity): string {
    return `${identity.size}:${identity.name}`;
}

/**
 * The lookups one gesture needs: identities deduped (a re-drop of a re-drop
 * repeats itself) and chunked at the drop cap, so the plain file input — the
 * one ingest path the cap doesn't bound (#397) — still gets an answer rather
 * than a rejected call. Sends bare name + size, never the File objects.
 */
export function planVaultLookups(
    files: VaultIdentity[],
    chunkSize = MAX_FILES_PER_DROP
): VaultIdentity[][] {
    const unique = new Map<string, VaultIdentity>();
    for (const file of files) {
        const key = vaultKey(file);
        if (!unique.has(key)) {
            unique.set(key, { name: file.name, size: file.size });
        }
    }
    const identities = [...unique.values()];
    const chunks: VaultIdentity[][] = [];
    for (let start = 0; start < identities.length; start += chunkSize) {
        chunks.push(identities.slice(start, start + chunkSize));
    }
    return chunks;
}
