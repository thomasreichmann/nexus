'use client';

import { Card, CardContent } from '@/components/ui/card';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogPopup,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Trash2, User } from 'lucide-react';
import { ME_VALUE } from './presets';
import { useSummaryInvalidation } from './useSummaryInvalidation';

interface CleanupControlsProps {
    targetUser: string;
    targetLabel: string;
}

export function CleanupControls({
    targetUser,
    targetLabel,
}: CleanupControlsProps) {
    const trpc = useTRPC();
    const { invalidateSummary } = useSummaryInvalidation();
    const { data: summary } = useQuery(
        trpc.admin.devTools.summary.queryOptions()
    );

    const cleanForMeMutation = useMutation(
        trpc.admin.devTools.cleanup.forMe.mutationOptions({
            onSuccess: invalidateSummary,
        })
    );

    const cleanAllMutation = useMutation(
        trpc.admin.devTools.cleanup.all.mutationOptions({
            onSuccess: invalidateSummary,
        })
    );

    const cleanForUserMutation = useMutation(
        trpc.admin.devTools.cleanup.forUser.mutationOptions({
            onSuccess: invalidateSummary,
        })
    );

    const isMe = targetUser === ME_VALUE;
    const hasData = (summary?.files ?? 0) > 0;
    const isCleanPending =
        cleanForMeMutation.isPending || cleanForUserMutation.isPending;
    const isAnyPending = isCleanPending || cleanAllMutation.isPending;

    function handleClean() {
        if (isMe) {
            cleanForMeMutation.mutate();
        } else {
            cleanForUserMutation.mutate({ userId: targetUser });
        }
    }

    return (
        <Card className="border-border/50 bg-zinc-900/60">
            <div className="border-b border-border/30 px-3 py-2">
                <span className="font-mono text-xs text-red-400/80">
                    {'>'} cleanup
                </span>
            </div>
            <CardContent className="space-y-2.5 p-3">
                <div className="flex gap-2">
                    <AlertDialog>
                        <AlertDialogTrigger
                            className="h-8 flex-1 cursor-pointer rounded-md border border-border bg-background px-3 font-mono text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                            disabled={!hasData || isAnyPending}
                        >
                            {isCleanPending ? (
                                <Loader2
                                    aria-hidden="true"
                                    className="mr-1 inline h-3.5 w-3.5 animate-spin"
                                />
                            ) : (
                                <User
                                    aria-hidden="true"
                                    className="mr-1 inline h-3.5 w-3.5"
                                />
                            )}
                            Clean {targetLabel}
                        </AlertDialogTrigger>
                        <AlertDialogPopup>
                            <AlertDialogTitle>
                                Clean seed data for {targetLabel}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                Removes seed-generated files and retrievals for{' '}
                                {isMe ? 'your account' : targetLabel}. Real data
                                is untouched.
                            </AlertDialogDescription>
                            <div className="flex justify-end gap-2">
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleClean}>
                                    Clean
                                </AlertDialogAction>
                            </div>
                        </AlertDialogPopup>
                    </AlertDialog>

                    <AlertDialog>
                        <AlertDialogTrigger
                            className="h-8 flex-1 cursor-pointer rounded-md bg-destructive px-3 font-mono text-xs text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
                            disabled={!hasData || isAnyPending}
                        >
                            {cleanAllMutation.isPending ? (
                                <Loader2
                                    aria-hidden="true"
                                    className="mr-1 inline h-3.5 w-3.5 animate-spin"
                                />
                            ) : (
                                <Trash2
                                    aria-hidden="true"
                                    className="mr-1 inline h-3.5 w-3.5"
                                />
                            )}
                            Nuke all
                        </AlertDialogTrigger>
                        <AlertDialogPopup>
                            <AlertDialogTitle>
                                Delete all seed data?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                Removes all seed data across all accounts —
                                files, retrievals, seed users, and seed
                                subscriptions.
                            </AlertDialogDescription>
                            <div className="flex justify-end gap-2">
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => cleanAllMutation.mutate()}
                                >
                                    Delete all
                                </AlertDialogAction>
                            </div>
                        </AlertDialogPopup>
                    </AlertDialog>
                </div>

                {(cleanForMeMutation.isSuccess ||
                    cleanAllMutation.isSuccess ||
                    cleanForUserMutation.isSuccess) && (
                    <p
                        role="status"
                        className="font-mono text-xs text-amber-400"
                    >
                        Cleanup complete.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
