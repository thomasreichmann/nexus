'use client';

import * as React from 'react';
import Editor from 'react-simple-code-editor';
import { Highlight, themes } from 'prism-react-renderer';
import { cn } from '@/lib/utils';

interface JsonEditorProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    placeholder?: string;
    disabled?: boolean;
    hasError?: boolean;
    className?: string;
}

export function JsonEditor({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    hasError,
    className,
}: JsonEditorProps) {
    const editorRef = React.useRef<HTMLDivElement>(null);

    // Sync line numbers scroll with editor
    React.useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const textarea = editor.querySelector('textarea');
        const lineNumbers = editor.querySelector('[data-line-numbers]');

        if (!textarea || !lineNumbers) return;

        const handleScroll = () => {
            lineNumbers.scrollTop = textarea.scrollTop;
        };

        textarea.addEventListener('scroll', handleScroll);
        return () => textarea.removeEventListener('scroll', handleScroll);
    }, []);

    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent) => {
            // Format on Cmd/Ctrl + Shift + F
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
                e.preventDefault();
                try {
                    const parsed = JSON.parse(value);
                    onChange(JSON.stringify(parsed, null, 2));
                } catch {
                    // Invalid JSON, can't format
                }
                return;
            }

            // Pass through other key events
            onKeyDown?.(e);
        },
        [value, onChange, onKeyDown]
    );

    const lineCount = value.split('\n').length;

    const highlightCode = React.useCallback((code: string) => {
        if (!code) return <span />;

        return (
            <Highlight theme={themes.vsDark} code={code} language="json">
                {({ tokens, getTokenProps }) => (
                    <>
                        {tokens.map((line, lineIndex) => (
                            <span key={lineIndex}>
                                {line.map((token, tokenIndex) => {
                                    const props = getTokenProps({ token });
                                    const colorClass = getColorClass(
                                        token.types
                                    );
                                    return (
                                        <span
                                            key={tokenIndex}
                                            {...props}
                                            className={colorClass}
                                            style={undefined}
                                        />
                                    );
                                })}
                                {lineIndex < tokens.length - 1 && '\n'}
                            </span>
                        ))}
                    </>
                )}
            </Highlight>
        );
    }, []);

    return (
        <div
            ref={editorRef}
            className={cn(
                'relative rounded-md border bg-background font-mono text-sm',
                'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                hasError && 'border-destructive',
                disabled && 'opacity-50 cursor-not-allowed',
                className
            )}
        >
            <div className="flex min-h-[112px]">
                <div
                    data-line-numbers
                    className="select-none bg-muted/30 text-muted-foreground text-right py-2.5 px-2 border-r border-border overflow-hidden"
                    aria-hidden="true"
                >
                    {Array.from({ length: Math.max(lineCount, 5) }, (_, i) => (
                        <div
                            key={i}
                            className="leading-[1.5] text-xs h-[1.5em]"
                        >
                            {i + 1}
                        </div>
                    ))}
                </div>

                <div className="flex-1 overflow-auto">
                    <Editor
                        value={value}
                        onValueChange={onChange}
                        highlight={highlightCode}
                        padding={10}
                        disabled={disabled}
                        placeholder={placeholder}
                        onKeyDown={handleKeyDown}
                        tabSize={2}
                        insertSpaces={true}
                        style={{
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            lineHeight: '1.5',
                            minHeight: '112px',
                        }}
                        textareaClassName="focus:outline-none"
                        className="min-h-full"
                    />
                </div>
            </div>
        </div>
    );
}

function getColorClass(types: string[]): string {
    // Map prism token types to our color scheme matching ResponseViewer
    if (types.includes('property')) return 'text-cyan-400'; // Keys
    if (types.includes('string')) return 'text-green-400'; // Strings
    if (types.includes('number')) return 'text-blue-400'; // Numbers
    if (types.includes('boolean')) return 'text-purple-400'; // Booleans
    if (types.includes('null')) return 'text-orange-400'; // Null
    return ''; // Punctuation inherits text color
}
