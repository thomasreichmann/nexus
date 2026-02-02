'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { loadPanelSizes, savePanelSizes, type PanelSizes } from '@/lib/storage';

const MIN_PANEL_SIZE = 200; // px
const RESIZE_STEP = 10; // px for keyboard navigation
const DEFAULT_SIZES: PanelSizes = { horizontal: 50, vertical: 50 };

interface ResizablePanelsProps {
    first: React.ReactNode;
    second: React.ReactNode;
    className?: string;
}

export function ResizablePanels({
    first,
    second,
    className,
}: ResizablePanelsProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const sizesRef = React.useRef<PanelSizes>(DEFAULT_SIZES);
    const [sizes, setSizes] = React.useState<PanelSizes>(DEFAULT_SIZES);
    const [isHorizontal, setIsHorizontal] = React.useState(true);
    const [isDragging, setIsDragging] = React.useState(false);

    // Keep ref in sync for use in pointer up handler
    React.useEffect(() => {
        sizesRef.current = sizes;
    }, [sizes]);

    // Load persisted sizes on mount
    React.useEffect(() => {
        setSizes(loadPanelSizes());
    }, []);

    // Handle responsive layout switching
    React.useEffect(() => {
        const checkWidth = () => {
            setIsHorizontal(window.innerWidth >= 768);
        };

        checkWidth();
        window.addEventListener('resize', checkWidth);
        return () => window.removeEventListener('resize', checkWidth);
    }, []);

    // Get the current size based on layout direction
    const currentSize = isHorizontal ? sizes.horizontal : sizes.vertical;

    const handlePointerDown = React.useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            const target = e.currentTarget;
            target.setPointerCapture(e.pointerId);
            setIsDragging(true);
        },
        []
    );

    const handlePointerMove = React.useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging || !containerRef.current) return;

            const container = containerRef.current;
            const rect = container.getBoundingClientRect();

            let newPercentage: number;

            if (isHorizontal) {
                const x = e.clientX - rect.left;
                const minPercent = (MIN_PANEL_SIZE / rect.width) * 100;
                const maxPercent = 100 - minPercent;
                newPercentage = Math.max(
                    minPercent,
                    Math.min(maxPercent, (x / rect.width) * 100)
                );
            } else {
                const y = e.clientY - rect.top;
                const minPercent = (MIN_PANEL_SIZE / rect.height) * 100;
                const maxPercent = 100 - minPercent;
                newPercentage = Math.max(
                    minPercent,
                    Math.min(maxPercent, (y / rect.height) * 100)
                );
            }

            setSizes((prev) => ({
                ...prev,
                [isHorizontal ? 'horizontal' : 'vertical']: newPercentage,
            }));
        },
        [isDragging, isHorizontal]
    );

    const handlePointerUp = React.useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setIsDragging(false);
            // Save only when drag completes to avoid excessive localStorage writes
            savePanelSizes(sizesRef.current);
        },
        []
    );

    const handleDoubleClick = React.useCallback(() => {
        const updated = {
            ...sizesRef.current,
            [isHorizontal ? 'horizontal' : 'vertical']: 50,
        };
        setSizes(updated);
        savePanelSizes(updated);
    }, [isHorizontal]);

    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const container = containerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            let delta = 0;

            if (isHorizontal) {
                if (e.key === 'ArrowLeft') delta = -RESIZE_STEP;
                else if (e.key === 'ArrowRight') delta = RESIZE_STEP;
            } else {
                if (e.key === 'ArrowUp') delta = -RESIZE_STEP;
                else if (e.key === 'ArrowDown') delta = RESIZE_STEP;
            }

            if (delta === 0) return;

            e.preventDefault();

            const dimension = isHorizontal ? rect.width : rect.height;
            const deltaPercent = (delta / dimension) * 100;

            setSizes((prev) => {
                const key = isHorizontal ? 'horizontal' : 'vertical';
                const minPercent = (MIN_PANEL_SIZE / dimension) * 100;
                const maxPercent = 100 - minPercent;
                const newValue = Math.max(
                    minPercent,
                    Math.min(maxPercent, prev[key] + deltaPercent)
                );

                const updated = { ...prev, [key]: newValue };
                savePanelSizes(updated);
                return updated;
            });
        },
        [isHorizontal]
    );

    return (
        <div
            ref={containerRef}
            className={cn(
                'flex min-h-0',
                isHorizontal ? 'flex-row' : 'flex-col',
                className
            )}
        >
            {/* First panel */}
            <div
                className="min-h-0 min-w-0 overflow-hidden"
                style={{
                    [isHorizontal ? 'width' : 'height']:
                        `calc(${currentSize}% - 4px)`,
                }}
            >
                {first}
            </div>

            {/* Divider */}
            <div
                role="separator"
                aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
                aria-valuenow={Math.round(currentSize)}
                aria-valuemin={10}
                aria-valuemax={90}
                tabIndex={0}
                className={cn(
                    'group relative flex-shrink-0 select-none',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isHorizontal
                        ? 'w-2 cursor-col-resize'
                        : 'h-2 cursor-row-resize',
                    isDragging && 'cursor-grabbing'
                )}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                style={{ touchAction: 'none' }}
            >
                {/* Visual handle */}
                <div
                    className={cn(
                        'absolute rounded-full bg-border transition-colors',
                        'group-hover:bg-primary group-focus-visible:bg-primary',
                        isDragging && 'bg-primary',
                        isHorizontal
                            ? 'left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2'
                            : 'left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2'
                    )}
                />
            </div>

            {/* Second panel */}
            <div
                className="min-h-0 min-w-0 overflow-hidden"
                style={{
                    [isHorizontal ? 'width' : 'height']:
                        `calc(${100 - currentSize}% - 4px)`,
                }}
            >
                {second}
            </div>
        </div>
    );
}
