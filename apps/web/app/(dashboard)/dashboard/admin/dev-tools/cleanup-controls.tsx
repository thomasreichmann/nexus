'use client';

import { useState } from 'react';
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
import { cn } from '@/lib/cn';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, User } from 'lucide-react';

export function CleanupControls() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const summaryKey = trpc.admin.devTools.summary.queryOptions().queryKey;
    const { data: summary } = useQuery(
        trpc.admin.devTools.summary.queryOptions()
    );

    const cleanForMeMutation = useMutation(
        trpc.admin.devTools.cleanup.forMe.mutationOptions({
            onSuccess() {
                queryClient.invalidateQueries({ queryKey: summaryKey });
            },
        })
    );

    const cleanAllMutation = useMutation(
        trpc.admin.devTools.cleanup.all.mutationOptions({
            onSuccess() {
                queryClient.invalidateQueries({ queryKey: summaryKey });
            },
        })
    );

    const cleanForUserMutation = useMutation(
        trpc.admin.devTools.cleanup.forUser.mutationOptions({
            onSuccess() {
                queryClient.invalidateQueries({ queryKey: summaryKey });
            },
        })
    );

    const [selectedUserId, setSelectedUserId] = useState('');
    const usersWithSeedData = summary?.userDetails ?? [];
    const hasData = (summary?.files ?? 0) > 0;
    const isAnyPending =
        cleanForMeMutation.isPending ||
        cleanAllMutation.isPending ||
        cleanForUserMutation.isPending;

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
                            {cleanForMeMutation.isPending ? (
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
                            Clean mine
                        </AlertDialogTrigger>
                        <AlertDialogPopup>
                            <AlertDialogTitle>
                                Clean my seed data?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                Removes seed-generated files and retrievals from
                                your account. Your real data is untouched.
                            </AlertDialogDescription>
                            <div className="flex justify-end gap-2">
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={() => cleanForMeMutation.mutate()}
                                >
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

                <div className="flex gap-2">
                    <select
                        aria-label="Select user to clean"
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        className={cn(
                            'h-8 flex-1 rounded-md border border-border bg-zinc-950/50 px-2 font-mono text-xs',
                            usersWithSeedData.length === 0 &&
                                'cursor-not-allowed opacity-50'
                        )}
                        disabled={usersWithSeedData.length === 0}
                    >
                        <option value="">
                            {usersWithSeedData.length === 0
                                ? 'No users with seed data'
                                : 'Clean for user...'}
                        </option>
                        {usersWithSeedData.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.name} ({u.fileCount} seed files)
                            </option>
                        ))}
                    </select>
                    <AlertDialog>
                        <AlertDialogTrigger
                            className="h-8 cursor-pointer rounded-md border border-border bg-background px-3 font-mono text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                            disabled={!selectedUserId || isAnyPending}
                        >
                            {cleanForUserMutation.isPending ? (
                                <>
                                    <Loader2
                                        aria-hidden="true"
                                        className="mr-1 inline h-3.5 w-3.5 animate-spin"
                                    />
                                    Cleaning...
                                </>
                            ) : (
                                'Clean'
                            )}
                        </AlertDialogTrigger>
                        <AlertDialogPopup>
                            <AlertDialogTitle>
                                Clean seed data for this user?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                Removes seed files and retrievals for the
                                selected user. Their real data is untouched.
                            </AlertDialogDescription>
                            <div className="flex justify-end gap-2">
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={() =>
                                        cleanForUserMutation.mutate(
                                            { userId: selectedUserId },
                                            {
                                                onSuccess() {
                                                    setSelectedUserId('');
                                                },
                                            }
                                        )
                                    }
                                >
                                    Clean
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
