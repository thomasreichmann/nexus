'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronRight,
    Search,
    ChevronsUpDown,
    Copy,
    Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AnsiText } from '@/components/ui/ansi-text';
import { hasAnsi } from '@/lib/ansi';

interface CollapsibleJsonViewerProps {
    data: unknown;
    className?: string;
}

interface JsonNodeContext {
    searchTerm: string;
    expandedPaths: Set<string>;
    onToggle: (path: string) => void;
    hoveredPath: string | null;
    onHover: (path: string | null) => void;
    matchingPaths: Set<string>;
    currentMatchIndex: number;
    matchPaths: string[];
    lineCounter: React.MutableRefObject<number>;
}

const JsonContext = React.createContext<JsonNodeContext | null>(null);

function useJsonContext() {
    const ctx = React.useContext(JsonContext);
    if (!ctx)
        throw new Error('JsonNode must be used within CollapsibleJsonViewer');
    return ctx;
}

export function CollapsibleJsonViewer({
    data,
    className,
}: CollapsibleJsonViewerProps) {
    const [searchTerm, setSearchTerm] = React.useState('');
    const [debouncedSearch, setDebouncedSearch] = React.useState('');
    const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(
        () => new Set()
    );
    const [hoveredPath, setHoveredPath] = React.useState<string | null>(null);
    const [currentMatchIndex, setCurrentMatchIndex] = React.useState(0);
    const [copiedPath, setCopiedPath] = React.useState(false);
    const [preSearchExpanded, setPreSearchExpanded] =
        React.useState<Set<string> | null>(null);

    // Initialize expanded paths to depth 2
    React.useEffect(() => {
        const initialExpanded = new Set<string>();
        collectPaths(data, '', initialExpanded, 2);
        setExpandedPaths(initialExpanded);
    }, [data]);

    // Debounce search
    React.useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Find matching paths for search
    const { matchingPaths, matchPaths } = React.useMemo(() => {
        if (!debouncedSearch)
            return {
                matchingPaths: new Set<string>(),
                matchPaths: [] as string[],
            };
        const matches = new Set<string>();
        const paths: string[] = [];
        findMatches(data, '', debouncedSearch.toLowerCase(), matches, paths);
        return { matchingPaths: matches, matchPaths: paths };
    }, [data, debouncedSearch]);

    // Auto-expand nodes containing matches
    React.useEffect(() => {
        if (debouncedSearch && matchingPaths.size > 0) {
            // Save pre-search state if not already saved
            if (preSearchExpanded === null) {
                setPreSearchExpanded(new Set(expandedPaths));
            }
            // Expand all ancestor paths of matches
            const toExpand = new Set<string>();
            matchingPaths.forEach((path) => {
                const parts = path.split('.');
                let current = '';
                for (let i = 0; i < parts.length - 1; i++) {
                    current = current ? `${current}.${parts[i]}` : parts[i];
                    toExpand.add(current);
                }
            });
            setExpandedPaths((prev) => new Set([...prev, ...toExpand]));
            setCurrentMatchIndex(0);
        } else if (!debouncedSearch && preSearchExpanded !== null) {
            // Restore pre-search state
            setExpandedPaths(preSearchExpanded);
            setPreSearchExpanded(null);
        }
    }, [debouncedSearch, matchingPaths, preSearchExpanded]);

    // Handle escape key to clear search
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && searchTerm) {
                setSearchTerm('');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [searchTerm]);

    const handleToggle = React.useCallback((path: string) => {
        setExpandedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    }, []);

    const handleExpandAll = React.useCallback(() => {
        const allPaths = new Set<string>();
        collectPaths(data, '', allPaths);
        setExpandedPaths(allPaths);
    }, [data]);

    const handleCollapseAll = React.useCallback(() => {
        setExpandedPaths(new Set());
    }, []);

    const handlePrevMatch = React.useCallback(() => {
        setCurrentMatchIndex(
            (prev) => (prev - 1 + matchPaths.length) % matchPaths.length
        );
    }, [matchPaths.length]);

    const handleNextMatch = React.useCallback(() => {
        setCurrentMatchIndex((prev) => (prev + 1) % matchPaths.length);
    }, [matchPaths.length]);

    const handleCopyPath = React.useCallback(async () => {
        if (hoveredPath) {
            await navigator.clipboard.writeText(hoveredPath);
            setCopiedPath(true);
            setTimeout(() => setCopiedPath(false), 1500);
        }
    }, [hoveredPath]);

    const lineCounter = React.useRef(0);
    lineCounter.current = 0;

    const contextValue: JsonNodeContext = {
        searchTerm: debouncedSearch,
        expandedPaths,
        onToggle: handleToggle,
        hoveredPath,
        onHover: setHoveredPath,
        matchingPaths,
        currentMatchIndex,
        matchPaths,
        lineCounter,
    };

    return (
        <div className={cn('flex flex-col h-full', className)}>
            {/* Toolbar */}
            <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/30">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search..."
                        className="h-7 pl-7 pr-2 text-xs"
                    />
                </div>
                {matchPaths.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={handlePrevMatch}
                        >
                            ‹
                        </Button>
                        <span>
                            {currentMatchIndex + 1} of {matchPaths.length}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={handleNextMatch}
                        >
                            ›
                        </Button>
                    </div>
                )}
                <div className="flex items-center gap-1 ml-auto">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleExpandAll}
                    >
                        <ChevronsUpDown className="h-3.5 w-3.5 mr-1" />
                        Expand
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleCollapseAll}
                    >
                        Collapse
                    </Button>
                </div>
            </div>

            {/* Path breadcrumb bar */}
            <div className="h-6 px-2 flex items-center border-b border-border bg-muted/20 text-xs text-muted-foreground">
                {hoveredPath ? (
                    <button
                        onClick={handleCopyPath}
                        className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                    >
                        {copiedPath ? (
                            <>
                                <Check className="h-3 w-3 text-green-500" />
                                <span className="text-green-500">Copied!</span>
                            </>
                        ) : (
                            <>
                                <Copy className="h-3 w-3" />
                                <code>{hoveredPath}</code>
                            </>
                        )}
                    </button>
                ) : (
                    <span className="italic">
                        Hover over a value to see its path
                    </span>
                )}
            </div>

            {/* JSON content */}
            <div className="flex-1 overflow-auto">
                <pre className="p-2 text-sm font-mono">
                    <JsonContext.Provider value={contextValue}>
                        <JsonNode data={data} path="" level={0} isLast />
                    </JsonContext.Provider>
                </pre>
            </div>
        </div>
    );
}

interface JsonNodeProps {
    data: unknown;
    path: string;
    level: number;
    keyName?: string;
    isLast?: boolean;
}

function JsonNode({
    data,
    path,
    level,
    keyName,
    isLast = false,
}: JsonNodeProps) {
    const ctx = useJsonContext();
    const indent = '  '.repeat(level);
    const lineNum = ++ctx.lineCounter.current;

    const isMatch = ctx.matchingPaths.has(path);
    const isCurrentMatch = ctx.matchPaths[ctx.currentMatchIndex] === path;

    const handleMouseEnter = () => ctx.onHover(path || 'root');
    const handleMouseLeave = () => ctx.onHover(null);

    // Primitive values
    if (data === null) {
        return (
            <Line
                num={lineNum}
                indent={indent}
                keyName={keyName}
                isLast={isLast}
            >
                <span
                    className={cn(
                        'text-orange-400',
                        isMatch && 'bg-yellow-500/30',
                        isCurrentMatch && 'ring-2 ring-yellow-500'
                    )}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    null
                </span>
            </Line>
        );
    }

    if (data === undefined) {
        return (
            <Line
                num={lineNum}
                indent={indent}
                keyName={keyName}
                isLast={isLast}
            >
                <span
                    className="text-gray-400"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    undefined
                </span>
            </Line>
        );
    }

    if (typeof data === 'boolean') {
        return (
            <Line
                num={lineNum}
                indent={indent}
                keyName={keyName}
                isLast={isLast}
            >
                <span
                    className={cn(
                        'text-purple-400',
                        isMatch && 'bg-yellow-500/30',
                        isCurrentMatch && 'ring-2 ring-yellow-500'
                    )}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    {data.toString()}
                </span>
            </Line>
        );
    }

    if (typeof data === 'number') {
        return (
            <Line
                num={lineNum}
                indent={indent}
                keyName={keyName}
                isLast={isLast}
            >
                <span
                    className={cn(
                        'text-blue-400',
                        isMatch && 'bg-yellow-500/30',
                        isCurrentMatch && 'ring-2 ring-yellow-500'
                    )}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    {data}
                </span>
            </Line>
        );
    }

    if (typeof data === 'string') {
        const highlighted = highlightSearch(data, ctx.searchTerm);
        if (hasAnsi(data)) {
            return (
                <Line
                    num={lineNum}
                    indent={indent}
                    keyName={keyName}
                    isLast={isLast}
                >
                    <span
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        "<AnsiText>{data}</AnsiText>"
                    </span>
                </Line>
            );
        }
        return (
            <Line
                num={lineNum}
                indent={indent}
                keyName={keyName}
                isLast={isLast}
            >
                <span
                    className={cn(
                        'text-green-400',
                        isCurrentMatch && 'ring-2 ring-yellow-500'
                    )}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    "{highlighted}"
                </span>
            </Line>
        );
    }

    // Arrays
    if (Array.isArray(data)) {
        const isExpanded = ctx.expandedPaths.has(path) || path === '';
        const isEmpty = data.length === 0;

        if (isEmpty) {
            return (
                <Line
                    num={lineNum}
                    indent={indent}
                    keyName={keyName}
                    isLast={isLast}
                >
                    <span
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        []
                    </span>
                </Line>
            );
        }

        return (
            <>
                <Line num={lineNum} indent={indent} keyName={keyName}>
                    <button
                        onClick={() => ctx.onToggle(path)}
                        className="inline-flex items-center hover:text-foreground"
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        <ChevronRight
                            className={cn(
                                'h-3 w-3 mr-0.5 transition-transform',
                                isExpanded && 'rotate-90'
                            )}
                        />
                        [
                        {!isExpanded && (
                            <span className="text-muted-foreground ml-1">
                                {data.length} item{data.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </button>
                    {!isExpanded && (
                        <>
                            <span>]</span>
                            {!isLast && ','}
                        </>
                    )}
                </Line>
                <AnimatePresence initial={false}>
                    {isExpanded && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            {data.map((item, i) => (
                                <JsonNode
                                    key={i}
                                    data={item}
                                    path={path ? `${path}[${i}]` : `[${i}]`}
                                    level={level + 1}
                                    isLast={i === data.length - 1}
                                />
                            ))}
                            <Line
                                num={++ctx.lineCounter.current}
                                indent={indent}
                                isLast={isLast}
                            >
                                ]
                            </Line>
                        </motion.div>
                    )}
                </AnimatePresence>
            </>
        );
    }

    // Objects
    if (typeof data === 'object') {
        const entries = Object.entries(data);
        const isExpanded = ctx.expandedPaths.has(path) || path === '';
        const isEmpty = entries.length === 0;

        if (isEmpty) {
            return (
                <Line
                    num={lineNum}
                    indent={indent}
                    keyName={keyName}
                    isLast={isLast}
                >
                    <span
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        {'{}'}
                    </span>
                </Line>
            );
        }

        return (
            <>
                <Line num={lineNum} indent={indent} keyName={keyName}>
                    <button
                        onClick={() => ctx.onToggle(path)}
                        className="inline-flex items-center hover:text-foreground"
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        <ChevronRight
                            className={cn(
                                'h-3 w-3 mr-0.5 transition-transform',
                                isExpanded && 'rotate-90'
                            )}
                        />
                        {'{'}
                        {!isExpanded && (
                            <span className="text-muted-foreground ml-1">
                                {entries.length} key
                                {entries.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </button>
                    {!isExpanded && (
                        <>
                            <span>{'}'}</span>
                            {!isLast && ','}
                        </>
                    )}
                </Line>
                <AnimatePresence initial={false}>
                    {isExpanded && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            {entries.map(([key, value], i) => (
                                <JsonNode
                                    key={key}
                                    data={value}
                                    path={path ? `${path}.${key}` : key}
                                    level={level + 1}
                                    keyName={key}
                                    isLast={i === entries.length - 1}
                                />
                            ))}
                            <Line
                                num={++ctx.lineCounter.current}
                                indent={indent}
                                isLast={isLast}
                            >
                                {'}'}
                            </Line>
                        </motion.div>
                    )}
                </AnimatePresence>
            </>
        );
    }

    return (
        <Line num={lineNum} indent={indent} keyName={keyName} isLast={isLast}>
            <span
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {String(data)}
            </span>
        </Line>
    );
}

interface LineProps {
    num: number;
    indent: string;
    keyName?: string;
    isLast?: boolean;
    children: React.ReactNode;
}

function Line({ num, indent, keyName, isLast, children }: LineProps) {
    const ctx = useJsonContext();
    const keyHighlighted =
        keyName && ctx.searchTerm
            ? highlightSearch(keyName, ctx.searchTerm)
            : keyName;

    return (
        <div className="flex">
            <span className="w-10 text-right pr-3 text-muted-foreground select-none text-xs">
                {num}
            </span>
            <span>
                {indent}
                {keyName !== undefined && (
                    <>
                        <span className="text-cyan-400">
                            "{keyHighlighted}"
                        </span>
                        <span>: </span>
                    </>
                )}
                {children}
                {isLast === false && <span>,</span>}
            </span>
        </div>
    );
}

// Helper functions

function collectPaths(
    data: unknown,
    path: string,
    paths: Set<string>,
    maxDepth = Infinity
) {
    if (maxDepth <= 0) return;
    if (Array.isArray(data)) {
        if (path) paths.add(path);
        data.forEach((item, i) => {
            collectPaths(
                item,
                path ? `${path}[${i}]` : `[${i}]`,
                paths,
                maxDepth - 1
            );
        });
    } else if (data && typeof data === 'object') {
        if (path) paths.add(path);
        Object.entries(data).forEach(([key, value]) => {
            collectPaths(
                value,
                path ? `${path}.${key}` : key,
                paths,
                maxDepth - 1
            );
        });
    }
}

function findMatches(
    data: unknown,
    path: string,
    searchLower: string,
    matches: Set<string>,
    matchPaths: string[]
) {
    if (typeof data === 'string' && data.toLowerCase().includes(searchLower)) {
        matches.add(path);
        matchPaths.push(path);
    } else if (typeof data === 'number' && String(data).includes(searchLower)) {
        matches.add(path);
        matchPaths.push(path);
    } else if (
        typeof data === 'boolean' &&
        String(data).includes(searchLower)
    ) {
        matches.add(path);
        matchPaths.push(path);
    } else if (data === null && 'null'.includes(searchLower)) {
        matches.add(path);
        matchPaths.push(path);
    }

    if (Array.isArray(data)) {
        data.forEach((item, i) => {
            findMatches(
                item,
                path ? `${path}[${i}]` : `[${i}]`,
                searchLower,
                matches,
                matchPaths
            );
        });
    } else if (data && typeof data === 'object') {
        Object.entries(data).forEach(([key, value]) => {
            const childPath = path ? `${path}.${key}` : key;
            // Check if key matches
            if (key.toLowerCase().includes(searchLower)) {
                matches.add(childPath);
                if (!matchPaths.includes(childPath)) {
                    matchPaths.push(childPath);
                }
            }
            findMatches(value, childPath, searchLower, matches, matchPaths);
        });
    }
}

function highlightSearch(text: string, searchTerm: string): React.ReactNode {
    if (!searchTerm) return text;

    const lowerText = text.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    const index = lowerText.indexOf(lowerSearch);

    if (index === -1) return text;

    const before = text.slice(0, index);
    const match = text.slice(index, index + searchTerm.length);
    const after = text.slice(index + searchTerm.length);

    return (
        <>
            {before}
            <mark className="bg-yellow-500/50 text-inherit">{match}</mark>
            {highlightSearch(after, searchTerm)}
        </>
    );
}
