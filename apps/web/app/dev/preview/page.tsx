'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme-toggle';
import data from './data.json';
import { getSamplers } from './samplers';

interface PreviewOption {
    label: string;
    description: string;
    cssVariables: Record<string, string>;
    source?: {
        file: string;
        variable: string;
    };
}

interface PreviewData {
    title: string;
    description: string;
    mode: 'light' | 'dark' | 'system';
    options: PreviewOption[];
    samplers?: string[];
}

const previewData = data as PreviewData;

export default function PreviewPage() {
    const { setTheme } = useTheme();

    useEffect(() => {
        if (previewData.mode === 'light' || previewData.mode === 'dark') {
            setTheme(previewData.mode);
        }
    }, [setTheme]);

    const hasOptions = previewData.options.length > 0;

    return (
        <div className="min-h-screen bg-background p-8">
            <div className="mx-auto max-w-6xl space-y-8">
                <header className="flex items-start justify-between">
                    <div>
                        <h1 className="text-4xl font-bold tracking-tight">
                            {hasOptions
                                ? previewData.title || 'Preview'
                                : 'Visual Compare'}
                        </h1>
                        {hasOptions && previewData.description && (
                            <p className="mt-2 text-muted-foreground">
                                {previewData.description}
                            </p>
                        )}
                    </div>
                    <ThemeToggle />
                </header>

                {hasOptions ? (
                    <OptionsGrid options={previewData.options} />
                ) : (
                    <EmptyState />
                )}
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>No preview data</CardTitle>
                <CardDescription>
                    Use the{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                        /visual-compare
                    </code>{' '}
                    skill to populate this page with design token options.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                    Example:{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                        /visual-compare dark mode destructive color
                    </code>
                </p>
                <p>
                    The skill writes options to{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                        data.json
                    </code>{' '}
                    and this page auto-refreshes via HMR.
                </p>
            </CardContent>
        </Card>
    );
}

function OptionsGrid({ options }: { options: PreviewOption[] }) {
    const gridCols =
        options.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2';

    return (
        <div className={`grid gap-6 ${gridCols}`}>
            {options.map((option) => (
                <OptionCard key={option.label} option={option} />
            ))}
        </div>
    );
}

function toSemanticVars(vars: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
        // Tailwind v4 @theme inline compiles utilities to var(--destructive),
        // not var(--color-destructive). Strip the --color- prefix so overrides
        // cascade correctly regardless of what the agent writes.
        const semanticKey = key.startsWith('--color-')
            ? `--${key.slice('--color-'.length)}`
            : key;
        result[semanticKey] = value;
    }
    return result;
}

function OptionCard({ option }: { option: PreviewOption }) {
    const samplers = getSamplers(previewData.samplers);

    return (
        <div
            style={toSemanticVars(option.cssVariables)}
            className="space-y-4 rounded-xl border border-border bg-background p-6"
        >
            <div>
                <h2 className="text-lg font-semibold">{option.label}</h2>
                <p className="text-sm text-muted-foreground">
                    {option.description}
                </p>
            </div>
            {samplers.map((sampler) => (
                <sampler.component key={sampler.name} />
            ))}
        </div>
    );
}
