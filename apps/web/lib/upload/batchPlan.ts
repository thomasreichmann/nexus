import {
    formatSessionBatchName,
    resolveUnanimousFolderName,
    type UploadRow,
} from './rows';

/**
 * The batch an Upload click makes (#454), decided on the page before the
 * click rather than silently at it: the user sees what it'll be named, how
 * it's made up, and can aim it at a batch they already have.
 */

/** What the user chose for the files the click sends. */
export interface UploadChoices {
    /**
     * The name as typed; undefined when untouched, so the batch is named
     * after its folder or the click. Typed empty, it's the click's.
     */
    name?: string;
    /** One of the user's batches to add the files to, not a new one. */
    targetBatchId?: string;
    /** One batch per top-level subfolder of the one folder dropped. */
    isSplitBySubfolder?: boolean;
}

/**
 * One batch the click sends files into: a new one, or one of the user's to
 * grow. `rootDepth` is how many leading folders of a file's path the batch
 * stands for (`resolveSubpath`).
 */
export type BatchPlan =
    | { kind: 'new'; name: string; rows: UploadRow[]; rootDepth: number }
    | {
          kind: 'existing';
          batchId: string;
          rows: UploadRow[];
          rootDepth: number;
      };

/**
 * The rows the next click puts in a new batch: queued, with their bytes, and
 * no batch yet. Retries and re-added resumables keep the batch they had, so
 * they're no part of it, and a row still being checked against the vault, or
 * found there (#449), isn't sent at all.
 */
export function selectDraftRows(rows: UploadRow[]): UploadRow[] {
    return rows.filter(
        (row) => row.status === 'pending' && row.file && !row.batchId
    );
}

/** The batches the click sends `rows` (from `selectDraftRows`) into. */
export function planBatches(
    rows: UploadRow[],
    choices: UploadChoices,
    now: Date
): BatchPlan[] {
    if (rows.length === 0) return [];
    // A batch of the one folder dropped is that folder, whatever it's named
    // or whichever batch it joins: its own name drops out of every path.
    const folderName = resolveUnanimousFolderName(rows);
    const rootDepth = folderName === undefined ? 0 : 1;

    if (choices.targetBatchId) {
        return [
            {
                kind: 'existing',
                batchId: choices.targetBatchId,
                rows,
                rootDepth,
            },
        ];
    }
    if (choices.isSplitBySubfolder && folderName !== undefined) {
        const bySubfolder = groupByTopFolder(rows, rootDepth);
        if (hasFoldersToSplit(bySubfolder)) {
            return [...bySubfolder].map(([subfolder, group]) =>
                subfolder === null
                    ? {
                          kind: 'new',
                          name: folderName,
                          rows: group,
                          rootDepth: 1,
                      }
                    : {
                          kind: 'new',
                          name: subfolder,
                          rows: group,
                          rootDepth: 2,
                      }
            );
        }
    }
    return [
        {
            kind: 'new',
            name: resolveBatchName(choices.name, folderName, now),
            rows,
            rootDepth,
        },
    ];
}

function resolveBatchName(
    typed: string | undefined,
    folderName: string | undefined,
    now: Date
): string {
    const trimmed = typed?.trim();
    if (trimmed) return trimmed;
    if (typed === undefined && folderName !== undefined) return folderName;
    return formatSessionBatchName(now);
}

// The batch's files by the folder at its top they sit in (the segment of
// their path after the `rootDepth` the batch stands for); null for the ones
// at its own top level. In the order the folders first appear, which is the
// order the drop listed them. One pass: the queue holds up to 50,000 rows
// (#402).
function groupByTopFolder(
    rows: UploadRow[],
    rootDepth: number
): Map<string | null, UploadRow[]> {
    const groups = new Map<string | null, UploadRow[]>();
    for (const row of rows) {
        const folder = row.folderPath?.split('/')[rootDepth] ?? null;
        const group = groups.get(folder);
        if (group) group.push(row);
        else groups.set(folder, [row]);
    }
    return groups;
}

// Two or more folders at the top: "one batch per subfolder" means something.
// The summary offers the split on this, and the click splits on it, so the
// page never promises batches the click won't make.
function hasFoldersToSplit(groups: Map<string | null, unknown>): boolean {
    const folderCount = groups.has(null) ? groups.size - 1 : groups.size;
    return folderCount >= 2;
}

/** A folder at the top of the batch-to-be, as the summary outlines it. */
export interface DraftFolder {
    name: string;
    fileCount: number;
}

/** The batch-to-be as the upload page describes it before the click. */
export interface DraftSummary {
    fileCount: number;
    totalBytes: number;
    /** The one folder its files were all dropped as: the default name. */
    folderName?: string;
    /**
     * Its top-level folders, in natural order, each counting the files at
     * any depth under it.
     */
    folders: DraftFolder[];
    /** Files at its own top level, in no folder of it. */
    topLevelFileCount: number;
    /** One dropped folder holding two or more subfolders: it can split. */
    canSplit: boolean;
}

/** Describes the batch the next click makes of `rows` (`selectDraftRows`). */
export function summarizeDraft(rows: UploadRow[]): DraftSummary {
    const folderName = resolveUnanimousFolderName(rows);
    const rootDepth = folderName === undefined ? 0 : 1;
    const byFolder = groupByTopFolder(rows, rootDepth);
    const folders = [...byFolder]
        .flatMap(([name, group]) =>
            name === null ? [] : [{ name, fileCount: group.length }]
        )
        .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true })
        );
    return {
        fileCount: rows.length,
        totalBytes: rows.reduce((sum, row) => sum + row.size, 0),
        folderName,
        folders,
        topLevelFileCount: byFolder.get(null)?.length ?? 0,
        canSplit: folderName !== undefined && hasFoldersToSplit(byFolder),
    };
}
