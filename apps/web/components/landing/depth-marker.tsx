import { cn } from '@/lib/cn';

interface DepthMarkerProps {
    depth: string;
    name: string;
    className?: string;
}

export function DepthMarker({ depth, name, className }: DepthMarkerProps) {
    return (
        <div
            className={cn(
                'flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-(--faint)',
                className
            )}
        >
            <span aria-hidden className="h-px w-10 bg-(--hairline)" />
            <span className="text-(--ice)">{depth}</span>
            <span aria-hidden>·</span>
            <span>{name}</span>
        </div>
    );
}
