'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { fuzzyFilter, type FuzzyMatch } from '@/lib/fuzzy';
import { cn } from '@/lib/utils';
import type { ProcedureSchema } from '@/server/types';
import { ProcedureTypeBadge } from './procedure-type-badge';

export interface PaletteAction {
    id: string;
    label: string;
    icon: LucideIcon;
    /** Preformatted shortcut hint, e.g. "⌘⇧L" */
    shortcut?: string;
    run: () => void;
}

type PaletteItem =
    | { kind: 'action'; action: PaletteAction; match: FuzzyMatch }
    | { kind: 'procedure'; procedure: ProcedureSchema; match: FuzzyMatch };

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    procedures: ProcedureSchema[];
    actions: PaletteAction[];
    onSelectProcedure: (path: string) => void;
}

/**
 * Cmd+K command palette: fuzzy-searches procedures and actions, arrow keys
 * navigate, Enter selects, Escape closes (via the Dialog focus trap).
 */
export function CommandPalette({
    isOpen,
    onClose,
    procedures,
    actions,
    onSelectProcedure,
}: CommandPaletteProps) {
    const [query, setQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Reset on close (not on open): while closed the input is unmounted, so
    // this can never race the user's first keystrokes after reopening
    React.useEffect(() => {
        if (!isOpen) {
            setQuery('');
            setActiveIndex(0);
        }
    }, [isOpen]);

    const { actionItems, procedureItems } = React.useMemo(() => {
        return {
            actionItems: fuzzyFilter(actions, query, (a) => a.label).map(
                ({ item, match }): PaletteItem => ({
                    kind: 'action',
                    action: item,
                    match,
                })
            ),
            procedureItems: fuzzyFilter(procedures, query, (p) => p.path).map(
                ({ item, match }): PaletteItem => ({
                    kind: 'procedure',
                    procedure: item,
                    match,
                })
            ),
        };
    }, [actions, procedures, query]);

    const items = React.useMemo(
        () => [...actionItems, ...procedureItems],
        [actionItems, procedureItems]
    );

    const selectItem = React.useCallback(
        (item: PaletteItem) => {
            onClose();
            if (item.kind === 'action') {
                item.action.run();
            } else {
                onSelectProcedure(item.procedure.path);
            }
        },
        [onClose, onSelectProcedure]
    );

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown': {
                e.preventDefault();
                setActiveIndex((prev) =>
                    items.length === 0 ? 0 : (prev + 1) % items.length
                );
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                setActiveIndex((prev) =>
                    items.length === 0
                        ? 0
                        : (prev - 1 + items.length) % items.length
                );
                break;
            }
            case 'Enter': {
                e.preventDefault();
                const item = items[activeIndex];
                if (item) selectItem(item);
                break;
            }
        }
    };

    // Keep the active option visible while arrowing through the list
    React.useEffect(() => {
        if (!isOpen) return;
        document
            .getElementById(`palette-option-${activeIndex}`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, isOpen]);

    const renderItem = (item: PaletteItem, index: number) => {
        const isActive = index === activeIndex;

        return (
            <li
                key={
                    item.kind === 'action'
                        ? `action-${item.action.id}`
                        : `proc-${item.procedure.path}`
                }
                id={`palette-option-${index}`}
                role="option"
                aria-selected={isActive}
            >
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => selectItem(item)}
                    onMouseMove={() => setActiveIndex(index)}
                    className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground'
                    )}
                >
                    {item.kind === 'action' ? (
                        <>
                            <item.action.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">
                                <HighlightedText
                                    text={item.action.label}
                                    indices={item.match.indices}
                                />
                            </span>
                            {item.action.shortcut && (
                                <Kbd>{item.action.shortcut}</Kbd>
                            )}
                        </>
                    ) : (
                        <>
                            <ProcedureTypeBadge
                                type={item.procedure.type}
                                className="shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                <HighlightedText
                                    text={item.procedure.path}
                                    indices={item.match.indices}
                                />
                            </span>
                        </>
                    )}
                </button>
            </li>
        );
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            label="Command palette"
            initialFocusRef={inputRef}
        >
            <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                    ref={inputRef}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="palette-listbox"
                    aria-activedescendant={
                        items.length > 0
                            ? `palette-option-${activeIndex}`
                            : undefined
                    }
                    aria-label="Search procedures and actions"
                    placeholder="Search procedures and actions..."
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setActiveIndex(0);
                    }}
                    onKeyDown={handleInputKeyDown}
                    className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
            </div>

            <ul
                id="palette-listbox"
                role="listbox"
                aria-label="Results"
                className="max-h-80 overflow-y-auto p-1.5"
            >
                {items.length === 0 && (
                    <li className="px-2.5 py-8 text-center text-sm text-muted-foreground">
                        No results for &ldquo;{query}&rdquo;
                    </li>
                )}
                {actionItems.length > 0 && (
                    <li
                        aria-hidden="true"
                        className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                        Actions
                    </li>
                )}
                {actionItems.map((item, i) => renderItem(item, i))}
                {procedureItems.length > 0 && (
                    <li
                        aria-hidden="true"
                        className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                        Procedures
                    </li>
                )}
                {procedureItems.map((item, i) =>
                    renderItem(item, actionItems.length + i)
                )}
            </ul>

            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                    <Kbd>↑↓</Kbd> navigate
                </span>
                <span className="flex items-center gap-1">
                    <Kbd>↵</Kbd> select
                </span>
                <span className="flex items-center gap-1">
                    <Kbd>esc</Kbd> close
                </span>
            </div>
        </Dialog>
    );
}

function HighlightedText({
    text,
    indices,
}: {
    text: string;
    indices: number[];
}) {
    if (indices.length === 0) return <>{text}</>;

    const matched = new Set(indices);
    return (
        <>
            {Array.from(text, (char, i) =>
                matched.has(i) ? (
                    <span key={i} className="font-semibold text-primary">
                        {char}
                    </span>
                ) : (
                    char
                )
            )}
        </>
    );
}
