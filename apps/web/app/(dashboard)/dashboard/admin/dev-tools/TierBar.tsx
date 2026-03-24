import { cn } from '@/lib/cn';

interface TierBarProps {
    distribution: { standard: number; glacier: number; deep_archive: number };
    className?: string;
}

export function TierBar({ distribution, className }: TierBarProps) {
    return (
        <div
            className={cn(
                'flex h-1 w-full overflow-hidden rounded-full bg-zinc-800/80',
                className
            )}
        >
            <div
                className="bg-emerald-400/60"
                style={{ width: `${distribution.standard * 100}%` }}
            />
            <div
                className="bg-cyan-400/60"
                style={{ width: `${distribution.glacier * 100}%` }}
            />
            <div
                className="bg-violet-400/60"
                style={{ width: `${distribution.deep_archive * 100}%` }}
            />
        </div>
    );
}
