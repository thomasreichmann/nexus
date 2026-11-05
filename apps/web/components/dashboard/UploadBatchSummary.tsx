'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { countLabel, formatBytes } from '@/lib/format';
import type { DraftSummary } from '@/lib/upload/batchPlan';
import { MAX_BATCH_NAME_LENGTH } from '@/lib/upload/limits';
import { formatSessionBatchName } from '@/lib/upload/rows';
import type { UploadDraft } from '@/lib/upload/session';
import { ChooseBatchDialog } from './ChooseBatchDialog';
import { useUploadDraft } from './useUpload';

type SetDraft = (changes: Partial<UploadDraft>) => void;

/**
 * The batch the Upload click makes (#454), shown before the click: the one
 * moment its name and grouping can still be changed without repairing them
 * in the library afterwards. Covers only the files that will join it, not
 * retries or resumed uploads, which keep the batch they had.
 */
export function UploadBatchSummary() {
    const { draft, summary, setDraft } = useUploadDraft();
    const [isChoosing, setIsChoosing] = useState(false);
    if (summary.fileCount === 0) return null;

    const isSplit = draft.isSplitBySubfolder && summary.canSplit;
    return (
        <section
            aria-label="Batch"
            className="mb-4 space-y-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
        >
            <div
                role="group"
                aria-label="Upload into"
                className="flex flex-wrap gap-2"
            >
                <TargetButton
                    isActive={!draft.target}
                    onClick={() => setDraft({ target: undefined })}
                >
                    New batch
                </TargetButton>
                <TargetButton
                    isActive={draft.target !== undefined}
                    onClick={() => setIsChoosing(true)}
                >
                    Existing batch…
                </TargetButton>
            </div>
            <ChooseBatchDialog
                open={isChoosing}
                onOpenChange={setIsChoosing}
                onChoose={(batch) =>
                    setDraft({
                        target: { batchId: batch.batchId, name: batch.name },
                    })
                }
            />
            <BatchIdentity
                draft={draft}
                summary={summary}
                isSplit={isSplit}
                setDraft={setDraft}
            />
            <p className="text-sm text-muted-foreground tabular-nums">
                {countLabel(summary.fileCount, 'file')} ·{' '}
                {formatBytes(summary.totalBytes)}
                {summary.folders.length > 0 &&
                    ` · in ${countLabel(summary.folders.length, 'folder')}`}
            </p>
            {summary.canSplit && !draft.target && (
                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                        aria-label="One batch per subfolder"
                        checked={draft.isSplitBySubfolder}
                        onCheckedChange={(checked) =>
                            setDraft({ isSplitBySubfolder: checked })
                        }
                    />
                    One batch per subfolder
                </label>
            )}
            <FolderOutline summary={summary} />
        </section>
    );
}

interface BatchIdentityProps {
    draft: UploadDraft;
    summary: DraftSummary;
    isSplit: boolean;
    setDraft: SetDraft;
}

// What the batch will be called, or which ones it'll be.
function BatchIdentity({
    draft,
    summary,
    isSplit,
    setDraft,
}: BatchIdentityProps) {
    const nameId = useId();
    if (draft.target) {
        return (
            <p className="min-w-0 text-sm wrap-break-word">
                Adding to{' '}
                <span className="font-medium">{draft.target.name}</span>
            </p>
        );
    }
    if (isSplit) {
        const batchCount = countLabel(
            summary.folders.length,
            'batch',
            'batches'
        );
        return (
            <p className="min-w-0 text-sm wrap-break-word">
                {batchCount}, each named after its subfolder
                {summary.topLevelFileCount > 0 && (
                    <>
                        , and one named{' '}
                        <span className="font-medium">
                            {summary.folderName}
                        </span>{' '}
                        for the {countLabel(summary.topLevelFileCount, 'file')}{' '}
                        at its top
                    </>
                )}
            </p>
        );
    }
    const name = draft.name ?? summary.folderName ?? '';
    return (
        <div className="grid gap-1.5">
            <Label htmlFor={nameId}>Batch name</Label>
            <Input
                id={nameId}
                value={name}
                maxLength={MAX_BATCH_NAME_LENGTH}
                // The click names an unnamed batch, so this is only a likeness.
                placeholder={formatSessionBatchName(new Date())}
                onChange={(event) => setDraft({ name: event.target.value })}
            />
            {name.trim() === '' && (
                <p className="text-xs text-muted-foreground">
                    Left empty, it’s named for when you click Upload.
                </p>
            )}
        </div>
    );
}

interface FolderOutlineProps {
    summary: DraftSummary;
}

// The batch's top-level folders, folded away by default: a whole library
// drop can hold dozens.
function FolderOutline({ summary }: FolderOutlineProps) {
    if (summary.folders.length === 0) return null;
    return (
        <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
                Show folders
            </summary>
            <ul aria-label="Folders" className="mt-2 grid gap-1">
                {summary.folders.map((folder) => (
                    <FolderLine
                        key={folder.name}
                        name={folder.name}
                        fileCount={folder.fileCount}
                    />
                ))}
                {summary.topLevelFileCount > 0 && (
                    <FolderLine
                        name="Top level"
                        fileCount={summary.topLevelFileCount}
                        isMuted
                    />
                )}
            </ul>
        </details>
    );
}

interface FolderLineProps {
    name: string;
    fileCount: number;
    isMuted?: boolean;
}

function FolderLine({ name, fileCount, isMuted = false }: FolderLineProps) {
    return (
        <li className="flex min-w-0 justify-between gap-3">
            <span
                className={cn('truncate', isMuted && 'text-muted-foreground')}
            >
                {name}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
                {countLabel(fileCount, 'file')}
            </span>
        </li>
    );
}

interface TargetButtonProps {
    isActive: boolean;
    onClick: () => void;
    children: string;
}

function TargetButton({ isActive, onClick, children }: TargetButtonProps) {
    return (
        <Button
            type="button"
            size="sm"
            variant={isActive ? 'secondary' : 'ghost'}
            aria-pressed={isActive}
            onClick={onClick}
        >
            {children}
        </Button>
    );
}
