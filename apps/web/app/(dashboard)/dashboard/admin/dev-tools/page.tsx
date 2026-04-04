'use client';

import { useMemo, useState } from 'react';
import { Select } from '@base-ui/react/select';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';
import {
    CheckIcon,
    ChevronDownIcon,
    FileStack,
    HardDrive,
    RotateCw,
    Users,
} from 'lucide-react';
import { CleanupControls } from './cleanup-controls';
import { CustomSeedForm } from './custom-seed-form';
import { getTargetLabel, ME_VALUE } from './presets';
import { ScenarioList } from './scenario-list';

export default function AdminDevToolsPage() {
    const trpc = useTRPC();
    const { data: allUsers } = useQuery(
        trpc.admin.devTools.users.queryOptions()
    );
    const users = allUsers ?? [];
    const [targetUser, setTargetUser] = useState(ME_VALUE);
    const targetLabel = getTargetLabel(targetUser, users);

    return (
        <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex items-baseline gap-3">
                <h1 className="font-mono text-xl font-bold tracking-tight">
                    dev-tools
                </h1>
                <span className="font-mono text-sm text-muted-foreground">
                    seed &amp; manage test data
                </span>
            </div>

            <SeedSummary />

            <div className="space-y-2">
                <TargetUserSelect
                    users={users}
                    value={targetUser}
                    onChange={setTargetUser}
                />

                <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                    <ScenarioList
                        targetUser={targetUser}
                        targetLabel={targetLabel}
                    />
                    <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                        <CustomSeedForm targetUser={targetUser} />
                        <CleanupControls
                            targetUser={targetUser}
                            targetLabel={targetLabel}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

interface TargetUserSelectProps {
    users: { id: string; name: string; email: string }[];
    value: string;
    onChange: (value: string) => void;
}

function TargetUserSelect({ users, value, onChange }: TargetUserSelectProps) {
    const isOtherUser = value !== ME_VALUE;

    const items = useMemo(
        () => ({
            [ME_VALUE]: 'me (current user)',
            ...Object.fromEntries(users.map((u) => [u.id, u.name])),
        }),
        [users]
    );

    return (
        <div
            className={cn(
                'flex items-center gap-2.5 rounded-md border-l-2 bg-zinc-900/60 px-3 py-2 font-mono text-xs transition-colors',
                isOtherUser
                    ? 'border-l-amber-400/80'
                    : 'border-l-emerald-400/40'
            )}
        >
            <span
                className={cn(
                    'text-xs tracking-wide transition-colors',
                    isOtherUser
                        ? 'text-amber-400/70'
                        : 'text-muted-foreground/50'
                )}
            >
                target →
            </span>

            <Select.Root
                value={value}
                onValueChange={(val) => {
                    if (val !== null) onChange(val);
                }}
                items={items}
                modal={false}
            >
                <Select.Trigger
                    aria-label="Target user"
                    className={cn(
                        'flex h-7 min-w-40 cursor-pointer items-center gap-1.5 rounded-sm border bg-zinc-950/60 px-2 font-mono text-xs outline-none transition-colors',
                        isOtherUser
                            ? 'border-amber-400/30 text-amber-200 hover:border-amber-400/50 focus:border-amber-400/60'
                            : 'border-border/40 text-foreground hover:border-border/60 focus:border-emerald-400/40'
                    )}
                >
                    <Select.Value />
                    <Select.Icon className="ml-auto">
                        <ChevronDownIcon className="size-3 text-muted-foreground transition-transform data-popup-open:rotate-180" />
                    </Select.Icon>
                </Select.Trigger>

                <Select.Portal>
                    <Select.Positioner
                        sideOffset={4}
                        className="z-50"
                        alignItemWithTrigger={false}
                    >
                        <Select.Popup
                            className={cn(
                                'max-h-[--available-height] min-w-(--anchor-width) origin-(--transform-origin)',
                                'overflow-y-auto rounded-md border border-zinc-700/50 bg-zinc-800/80 p-1 shadow-lg backdrop-blur-sm',
                                'data-open:animate-in data-closed:animate-out',
                                'data-closed:fade-out-0 data-open:fade-in-0',
                                'data-closed:zoom-out-95 data-open:zoom-in-95',
                                'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2'
                            )}
                        >
                            <Select.Item
                                value={ME_VALUE}
                                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 font-mono text-xs outline-none select-none data-highlighted:bg-zinc-700/50"
                            >
                                <Select.ItemIndicator className="inline-flex w-4 items-center justify-center">
                                    <CheckIcon className="size-3" />
                                </Select.ItemIndicator>
                                <Select.ItemText>
                                    me (current user)
                                </Select.ItemText>
                            </Select.Item>

                            {users.length > 0 && (
                                <div className="my-1 h-px bg-zinc-700/50" />
                            )}

                            {users.map((u) => (
                                <Select.Item
                                    key={u.id}
                                    value={u.id}
                                    className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 font-mono text-xs outline-none select-none data-highlighted:bg-zinc-700/50"
                                >
                                    <Select.ItemIndicator className="inline-flex w-4 items-center justify-center">
                                        <CheckIcon className="size-3" />
                                    </Select.ItemIndicator>
                                    <div className="flex flex-col">
                                        <Select.ItemText>
                                            {u.name}
                                        </Select.ItemText>
                                        <span className="text-[10px] text-muted-foreground">
                                            {u.email}
                                        </span>
                                    </div>
                                </Select.Item>
                            ))}
                        </Select.Popup>
                    </Select.Positioner>
                </Select.Portal>
            </Select.Root>
        </div>
    );
}

function SeedSummary() {
    const trpc = useTRPC();
    const { data, isLoading } = useQuery(
        trpc.admin.devTools.summary.queryOptions()
    );

    const stats = [
        {
            label: 'Seed Files',
            value: data?.files ?? 0,
            icon: FileStack,
            color: 'text-cyan-400',
        },
        {
            label: 'Retrievals',
            value: data?.retrievals ?? 0,
            icon: RotateCw,
            color: 'text-violet-400',
        },
        {
            label: 'Seed Users',
            value: data?.users ?? 0,
            icon: Users,
            color: 'text-emerald-400',
        },
    ];

    return (
        <div className="flex items-center gap-3">
            {stats.map((stat) => (
                <Card
                    key={stat.label}
                    className="flex-1 border-border/50 bg-zinc-900/60"
                >
                    <CardContent className="flex items-center gap-2.5 px-3 py-2.5">
                        <stat.icon
                            aria-hidden="true"
                            className={cn('h-4 w-4 shrink-0', stat.color)}
                        />
                        <span className="font-mono text-xs tracking-wide text-muted-foreground">
                            {stat.label}
                        </span>
                        <span className="ml-auto font-mono text-base font-semibold tabular-nums">
                            {isLoading ? (
                                <span className="text-muted-foreground/50">
                                    --
                                </span>
                            ) : (
                                stat.value
                            )}
                        </span>
                    </CardContent>
                </Card>
            ))}
            <Card className="flex-1 border-border/50 bg-zinc-900/60">
                <CardContent className="flex items-center gap-2.5 px-3 py-2.5">
                    <HardDrive
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                    />
                    <span className="font-mono text-xs tracking-wide text-muted-foreground">
                        Storage
                    </span>
                    <span className="ml-auto font-mono text-base font-semibold tabular-nums">
                        {isLoading ? (
                            <span className="text-muted-foreground/50">--</span>
                        ) : (
                            formatBytes(data?.totalBytes ?? 0)
                        )}
                    </span>
                </CardContent>
            </Card>
        </div>
    );
}
