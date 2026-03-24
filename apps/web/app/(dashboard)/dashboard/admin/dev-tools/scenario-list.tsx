'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { Check, Loader2, Play } from 'lucide-react';
import {
    DEFAULT_DISTRIBUTION,
    ME_VALUE,
    SCENARIO_PRESETS,
    type ScenarioPreset,
} from './presets';
import { TierBar, useSeedTools } from './use-seed-tools';

export function ScenarioList() {
    const { users, seed, isPending } = useSeedTools();
    const [targetUser, setTargetUser] = useState(ME_VALUE);
    const [runningKey, setRunningKey] = useState<string | null>(null);

    const [lastResult, setLastResult] = useState<{
        key: string;
        files: number;
        retrievals: number;
    } | null>(null);

    function runPreset(key: string, preset: ScenarioPreset) {
        setRunningKey(key);
        setLastResult(null);
        seed(
            targetUser,
            {
                fileCount: preset.fileCount,
                retrievalCount: preset.retrievalCount,
                storageTierDistribution: preset.storageTierDistribution,
            },
            {
                onSuccess: (data) => {
                    setLastResult({
                        key,
                        files: data.files,
                        retrievals: data.retrievals,
                    });
                },
                onSettled: () => setRunningKey(null),
            }
        );
    }

    const targetLabel =
        targetUser === ME_VALUE
            ? 'me'
            : (users.find((u) => u.id === targetUser)?.name ?? 'user');

    return (
        <Card className="flex flex-col overflow-hidden border-border/50 bg-zinc-900/60">
            <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
                <span className="font-mono text-xs text-emerald-400/80">
                    {'>'} scenarios
                </span>
                <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground/50">
                        target →
                    </span>
                    <select
                        aria-label="Scenario target user"
                        value={targetUser}
                        onChange={(e) => setTargetUser(e.target.value)}
                        className="h-6 rounded border border-border/40 bg-zinc-950/60 px-2 pr-6 font-mono text-xs text-foreground outline-none transition-colors hover:border-border/60 focus:border-emerald-400/40"
                    >
                        <option value={ME_VALUE}>me (current user)</option>
                        {users.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.name} ({u.email})
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex-1 divide-y divide-border/10">
                {Object.entries(SCENARIO_PRESETS).map(([key, preset]) => {
                    const isRunning = runningKey === key;
                    const isComplete = lastResult?.key === key;
                    const dist =
                        preset.storageTierDistribution ?? DEFAULT_DISTRIBUTION;

                    return (
                        <button
                            key={key}
                            aria-label={`Run ${preset.name} scenario`}
                            className={cn(
                                'group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/60 disabled:opacity-40',
                                isComplete && 'bg-emerald-950/20'
                            )}
                            disabled={isPending}
                            onClick={() => runPreset(key, preset)}
                        >
                            <div
                                className={cn(
                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
                                    isRunning
                                        ? 'bg-emerald-400/10'
                                        : isComplete
                                          ? 'bg-emerald-400/10'
                                          : 'bg-zinc-800/60 group-hover:bg-emerald-400/10'
                                )}
                            >
                                {isRunning ? (
                                    <Loader2
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5 animate-spin text-emerald-400"
                                    />
                                ) : isComplete ? (
                                    <Check
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5 text-emerald-400"
                                    />
                                ) : (
                                    <Play
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-emerald-400"
                                    />
                                )}
                            </div>

                            <div className="min-w-0 flex-1">
                                <span className="font-mono text-sm font-medium">
                                    {preset.name}
                                </span>
                                <p className="truncate text-xs text-muted-foreground/60">
                                    {preset.description}
                                </p>
                            </div>

                            <div className="hidden w-16 shrink-0 sm:block">
                                <TierBar distribution={dist} />
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                                <span>{preset.fileCount} files</span>
                                {preset.retrievalCount > 0 && (
                                    <>
                                        <span className="text-border">·</span>
                                        <span className="text-violet-400/50">
                                            {preset.retrievalCount} ret
                                        </span>
                                    </>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>

            {lastResult && (
                <div
                    role="status"
                    className="border-t border-emerald-400/10 bg-emerald-950/20 px-3 py-2"
                >
                    <span className="font-mono text-xs text-emerald-400">
                        seeded +{lastResult.files} files
                        {lastResult.retrievals > 0 &&
                            `, +${lastResult.retrievals} retrievals`}
                        <span className="text-emerald-400/50">
                            {' → '}
                            {targetLabel}
                        </span>
                    </span>
                </div>
            )}
        </Card>
    );
}
