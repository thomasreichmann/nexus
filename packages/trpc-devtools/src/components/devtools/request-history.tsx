'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    clearHistory,
    loadHistory,
    restoreHistory,
    type HistoryItem,
} from '@/lib/storage';
import { cn } from '@/lib/utils';

interface RequestHistoryPanelProps {
    onReplay: (item: HistoryItem) => void;
}

export function RequestHistoryPanel({ onReplay }: RequestHistoryPanelProps) {
    const [history, setHistory] = React.useState<HistoryItem[]>(() =>
        loadHistory()
    );
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const [undoItems, setUndoItems] = React.useState<HistoryItem[] | null>(
        null
    );
    const undoTimerRef = React.useRef<ReturnType<typeof setTimeout>>(null);

    // Refresh history from storage periodically and on focus
    React.useEffect(() => {
        function refresh() {
            setHistory(loadHistory());
        }

        window.addEventListener('focus', refresh);

        // Poll every 2s to catch history additions from procedure execution
        const interval = setInterval(refresh, 2000);

        return () => {
            window.removeEventListener('focus', refresh);
            clearInterval(interval);
        };
    }, []);

    // Cleanup undo timer on unmount
    React.useEffect(() => {
        return () => {
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        };
    }, []);

    function handleClearAll() {
        const currentItems = [...history];
        setUndoItems(currentItems);
        setHistory([]);
        clearHistory();

        // Clear any existing timer
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

        undoTimerRef.current = setTimeout(() => {
            setUndoItems(null);
        }, 5000);
    }

    function handleUndo() {
        if (!undoItems) return;

        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

        restoreHistory(undoItems);
        setHistory(undoItems);
        setUndoItems(null);
    }

    return (
        <div className="border-t border-border flex flex-col min-h-0">
            {/* Header */}
            <button
                onClick={() => setIsCollapsed((prev) => !prev)}
                aria-expanded={!isCollapsed}
                className={cn(
                    'w-full flex items-center gap-1 px-4 py-1.5 min-h-11 text-xs font-semibold text-muted-foreground uppercase tracking-wider transition-colors',
                    'hover:bg-accent/50',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                )}
            >
                <ChevronRight
                    className={cn(
                        'h-4 w-4 transition-transform duration-150',
                        !isCollapsed && 'rotate-90'
                    )}
                />
                <span>History</span>
                {history.length > 0 && (
                    <Badge
                        variant="secondary"
                        className="ml-1 text-[10px] px-1.5 py-0 min-w-0"
                    >
                        {history.length}
                    </Badge>
                )}
                {history.length > 0 && !isCollapsed && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleClearAll();
                        }}
                        className={cn(
                            'ml-auto p-1 rounded-sm text-muted-foreground/70 hover:text-destructive transition-colors',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        )}
                        aria-label="Clear all history"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </button>

            {/* Content */}
            <AnimatePresence initial={false}>
                {!isCollapsed && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="overflow-hidden"
                    >
                        {history.length === 0 ? (
                            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                                {undoItems ? (
                                    <span>
                                        History cleared.{' '}
                                        <button
                                            onClick={handleUndo}
                                            className="text-foreground underline underline-offset-2 hover:text-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            Undo
                                        </button>
                                    </span>
                                ) : (
                                    'No history yet. Execute a request to see it here.'
                                )}
                            </div>
                        ) : (
                            <ScrollArea className="max-h-64">
                                <div className="p-2 space-y-0.5">
                                    {history.map((item) => (
                                        <HistoryItemRow
                                            key={item.id}
                                            item={item}
                                            onReplay={onReplay}
                                        />
                                    ))}
                                </div>
                            </ScrollArea>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

interface HistoryItemRowProps {
    item: HistoryItem;
    onReplay: (item: HistoryItem) => void;
}

function HistoryItemRow({ item, onReplay }: HistoryItemRowProps) {
    const truncatedPath = truncatePath(item.request.path, 30);

    return (
        <button
            onClick={() => onReplay(item)}
            title={item.request.path}
            className={cn(
                'w-full flex items-center gap-1.5 px-2 min-h-11 rounded-md text-sm text-left transition-colors',
                'hover:bg-accent/50',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
            )}
        >
            {/* Type badge */}
            <Badge
                variant={item.request.type}
                className="text-[10px] px-1.5 py-0 shrink-0"
            >
                {item.request.type.slice(0, 1).toUpperCase()}
            </Badge>

            {/* Procedure path */}
            <span className="flex-1 min-w-0 font-mono text-xs truncate">
                {truncatedPath}
            </span>

            {/* Status indicator */}
            {item.response.ok ? (
                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
                <X className="h-3.5 w-3.5 text-destructive shrink-0" />
            )}

            {/* Timestamp */}
            <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">
                {formatRelativeTime(item.timestamp)}
            </span>
        </button>
    );
}

function truncatePath(path: string, maxLength: number): string {
    if (path.length <= maxLength) return path;
    return path.slice(0, maxLength - 1) + '\u2026';
}

function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 5) return 'now';
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;

    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
}
