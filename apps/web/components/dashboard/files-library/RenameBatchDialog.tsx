'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogFooter,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';

/** `files.renameBatch`'s own limit. */
const MAX_NAME_LENGTH = 255;

interface RenameBatchDialogProps {
    batchId: string;
    name: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Rename a batch (#408): an upload is named for when it ran, and a
 * photographer files a shoot by what it was. Controlled by the caller, like
 * the batch menu's other dialogs.
 */
export function RenameBatchDialog({
    batchId,
    name,
    open,
    onOpenChange,
}: RenameBatchDialogProps) {
    const inputId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(name);
    // Each open starts from the batch's current name, not from whatever was
    // typed into the dialog last time.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setDraft(name);
    }

    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const rename = useMutation(
        trpc.files.renameBatch.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to rename batch' }),
            // Held until the library has the new name, so the dialog closes
            // onto it rather than onto the old one for a round trip.
            onSuccess: () =>
                Promise.all([
                    queryClient.invalidateQueries(
                        trpc.files.listBatches.pathFilter()
                    ),
                    queryClient.invalidateQueries(
                        trpc.files.getBatch.pathFilter()
                    ),
                ]),
        })
    );

    const trimmed = draft.trim();
    const canRename =
        trimmed.length > 0 && trimmed !== name && !rename.isPending;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!canRename) return;
        rename.mutate(
            { batchId, name: trimmed },
            { onSuccess: () => onOpenChange(false) }
        );
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogPopup initialFocus={inputRef}>
                <form onSubmit={submit} className="grid gap-4">
                    <AlertDialogTitle>Rename batch</AlertDialogTitle>
                    <div className="grid gap-2">
                        <Label htmlFor={inputId}>Name</Label>
                        <Input
                            ref={inputRef}
                            id={inputId}
                            value={draft}
                            maxLength={MAX_NAME_LENGTH}
                            onChange={(event) => setDraft(event.target.value)}
                            onFocus={(event) => event.currentTarget.select()}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button type="submit" disabled={!canRename}>
                            {rename.isPending ? 'Renaming…' : 'Rename'}
                        </Button>
                    </AlertDialogFooter>
                </form>
            </AlertDialogPopup>
        </AlertDialog>
    );
}
