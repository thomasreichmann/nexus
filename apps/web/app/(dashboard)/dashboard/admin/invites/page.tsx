'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate, formatRelativeTime } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { SPONSORED_DEFAULT_STORAGE_LIMIT } from '@/server/services/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { Ban, Check, Copy, Loader2, RotateCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { Invite } from '@nexus/db/repo/invites';

type InviteStatus = Invite['status'];

const PAGE_SIZE = 20;
const BYTES_PER_TB = 1024 ** 4;

const STATUS_FILTERS: { label: string; value: InviteStatus | undefined }[] = [
    { label: 'All', value: undefined },
    { label: 'Pending', value: 'pending' },
    { label: 'Redeemed', value: 'redeemed' },
    { label: 'Revoked', value: 'revoked' },
];

const EXPIRY_PRESETS: { label: string; days: number | undefined }[] = [
    { label: 'Never', days: undefined },
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
];

export default function AdminInvitesPage() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<
        InviteStatus | undefined
    >();
    const [page, setPage] = useState(0);

    const listOptions = trpc.admin.invites.list.queryOptions({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        status: statusFilter,
    });
    const { data, isLoading, isFetching } = useQuery(listOptions);

    function invalidateList() {
        queryClient.invalidateQueries({
            queryKey: trpc.admin.invites.list.queryKey(),
        });
    }

    const revokeMutation = useMutation(
        trpc.admin.invites.revoke.mutationOptions({
            onSuccess() {
                toast.success('Invite revoked');
                invalidateList();
            },
        })
    );

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Invites</h1>
                <p className="text-muted-foreground">
                    Create and manage sponsored-access invites for alpha testers
                </p>
            </div>

            <CreateInviteForm onCreated={invalidateList} />

            <div className="flex items-center gap-2">
                {STATUS_FILTERS.map((filter) => (
                    <Button
                        key={filter.label}
                        variant={
                            statusFilter === filter.value
                                ? 'default'
                                : 'outline'
                        }
                        size="sm"
                        onClick={() => {
                            setStatusFilter(filter.value);
                            setPage(0);
                        }}
                    >
                        {filter.label}
                    </Button>
                ))}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={invalidateList}
                    disabled={isFetching}
                    title="Refresh"
                    className="ml-auto"
                >
                    <RotateCw
                        className={cn('size-4', isFetching && 'animate-spin')}
                    />
                </Button>
            </div>

            <Card>
                {isLoading ? (
                    <CardContent className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </CardContent>
                ) : !data?.invites.length ? (
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <p className="text-muted-foreground">
                            No invites found
                        </p>
                    </CardContent>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Recipient</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Storage</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead>Expires</TableHead>
                                <TableHead className="w-20" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.invites.map((invite) => (
                                <TableRow key={invite.id}>
                                    {/* w-full + max-w-0: emails are unbounded
                                        and unbreakable — truncate instead of
                                        growing the column (#311). */}
                                    <TableCell
                                        className={cn(
                                            'w-full max-w-0 font-medium',
                                            !invite.email &&
                                                'text-muted-foreground italic'
                                        )}
                                    >
                                        <span className="block truncate">
                                            {invite.email ?? 'Link only'}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <InviteStatusBadge
                                            status={invite.status}
                                        />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {formatBytes(
                                            invite.storageLimit ??
                                                SPONSORED_DEFAULT_STORAGE_LIMIT
                                        )}
                                        {invite.storageLimit === null && (
                                            <span className="text-muted-foreground/60">
                                                {' '}
                                                (default)
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {formatRelativeTime(invite.createdAt)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {invite.expiresAt
                                            ? formatDate(invite.expiresAt)
                                            : '—'}
                                    </TableCell>
                                    <TableCell>
                                        {invite.status === 'pending' && (
                                            <div className="flex justify-end gap-1">
                                                <CopyLinkButton
                                                    token={invite.token}
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        revokeMutation.mutate({
                                                            id: invite.id,
                                                        })
                                                    }
                                                    disabled={
                                                        revokeMutation.isPending
                                                    }
                                                    title="Revoke invite"
                                                >
                                                    {revokeMutation.isPending &&
                                                    revokeMutation.variables
                                                        ?.id === invite.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Ban className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </Card>

            <TablePagination
                page={page}
                pageSize={PAGE_SIZE}
                total={data?.total ?? 0}
                onPageChange={setPage}
            />
        </div>
    );
}

interface CreateInviteFormProps {
    onCreated: () => void;
}

function CreateInviteForm({ onCreated }: CreateInviteFormProps) {
    const trpc = useTRPC();
    const [email, setEmail] = useState('');
    const [storageTb, setStorageTb] = useState('');
    const [expiresInDays, setExpiresInDays] = useState<number | undefined>();
    const [lastCreated, setLastCreated] = useState<{
        url: string;
        email: string | null;
    } | null>(null);

    const createMutation = useMutation(
        trpc.admin.invites.create.mutationOptions({
            onSuccess(data) {
                setLastCreated({ url: data.url, email: data.invite.email });
                setEmail('');
                setStorageTb('');
                setExpiresInDays(undefined);
                toast.success('Invite created');
                onCreated();
            },
        })
    );

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const tb = Number(storageTb);
        createMutation.mutate({
            email: email.trim() || undefined,
            storageLimit:
                storageTb && tb > 0 ? Math.round(tb * BYTES_PER_TB) : undefined,
            expiresAt: expiresInDays
                ? addDays(new Date(), expiresInDays)
                : undefined,
        });
    }

    return (
        <Card>
            <CardContent className="space-y-4 p-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                        <div className="space-y-1.5">
                            <Label htmlFor="invite-email">
                                Email{' '}
                                <span className="font-normal text-muted-foreground">
                                    (optional — sends the invite; leave empty
                                    for a shareable link)
                                </span>
                            </Label>
                            <Input
                                id="invite-email"
                                type="email"
                                placeholder="tester@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="invite-storage">
                                Storage limit{' '}
                                <span className="font-normal text-muted-foreground">
                                    (TB)
                                </span>
                            </Label>
                            <Input
                                id="invite-storage"
                                type="number"
                                min={0.1}
                                step={0.1}
                                placeholder={`Default (${formatBytes(SPONSORED_DEFAULT_STORAGE_LIMIT)})`}
                                value={storageTb}
                                onChange={(e) => setStorageTb(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-4">
                        <fieldset className="space-y-1.5">
                            <legend className="text-sm font-medium">
                                Expires
                            </legend>
                            <div className="flex gap-1.5">
                                {EXPIRY_PRESETS.map((preset) => (
                                    <Button
                                        key={preset.label}
                                        type="button"
                                        variant={
                                            expiresInDays === preset.days
                                                ? 'default'
                                                : 'outline'
                                        }
                                        size="sm"
                                        onClick={() =>
                                            setExpiresInDays(preset.days)
                                        }
                                    >
                                        {preset.label}
                                    </Button>
                                ))}
                            </div>
                        </fieldset>
                        <Button
                            type="submit"
                            disabled={createMutation.isPending}
                            className="ml-auto"
                        >
                            {createMutation.isPending ? (
                                <Loader2 className="mr-1.5 size-4 animate-spin" />
                            ) : (
                                <Send className="mr-1.5 size-4" />
                            )}
                            Create invite
                        </Button>
                    </div>
                </form>

                {lastCreated && (
                    <div
                        role="status"
                        className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2"
                    >
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-green-600">
                                {lastCreated.email
                                    ? `Invite emailed to ${lastCreated.email}`
                                    : 'Invite link created — share it manually'}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                                {lastCreated.url}
                            </p>
                        </div>
                        <CopyUrlButton url={lastCreated.url} />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function InviteStatusBadge({ status }: { status: InviteStatus }) {
    switch (status) {
        case 'pending':
            return (
                <Badge
                    variant="secondary"
                    className="bg-blue-500/10 text-blue-600"
                >
                    Pending
                </Badge>
            );
        case 'redeemed':
            return (
                <Badge
                    variant="secondary"
                    className="bg-green-500/10 text-green-600"
                >
                    Redeemed
                </Badge>
            );
        case 'revoked':
            return (
                <Badge
                    variant="secondary"
                    className="bg-red-500/10 text-red-600"
                >
                    Revoked
                </Badge>
            );
    }
}

function CopyLinkButton({ token }: { token: string }) {
    return <CopyUrlButton url={`/invite/${token}`} title="Copy invite link" />;
}

interface CopyUrlButtonProps {
    /** Absolute URL, or a path resolved against the current origin on click. */
    url: string;
    title?: string;
}

function CopyUrlButton({ url, title = 'Copy link' }: CopyUrlButtonProps) {
    const [isCopied, setIsCopied] = useState(false);

    async function handleCopy() {
        const absolute = new URL(url, window.location.origin).toString();
        await navigator.clipboard.writeText(absolute);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 1500);
    }

    return (
        <Button variant="ghost" size="icon" onClick={handleCopy} title={title}>
            {isCopied ? (
                <Check className="h-4 w-4 text-green-600" />
            ) : (
                <Copy className="h-4 w-4" />
            )}
        </Button>
    );
}
