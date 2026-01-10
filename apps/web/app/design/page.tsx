import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';

export default function DesignPage() {
    return (
        <div className="min-h-screen bg-background p-8">
            <div className="mx-auto max-w-4xl space-y-12">
                <header className="flex items-start justify-between">
                    <div>
                        <h1 className="text-4xl font-bold tracking-tight">
                            Design Tokens
                        </h1>
                        <p className="mt-2 text-muted-foreground">
                            Preview of the Nexus design system
                        </p>
                    </div>
                    <ThemeToggle />
                </header>

                {/* Color Palette */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Colors</h2>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                        <ColorSwatch
                            name="Background"
                            className="bg-background"
                        />
                        <ColorSwatch
                            name="Foreground"
                            className="bg-foreground"
                        />
                        <ColorSwatch name="Primary" className="bg-primary" />
                        <ColorSwatch
                            name="Secondary"
                            className="bg-secondary"
                        />
                        <ColorSwatch name="Muted" className="bg-muted" />
                        <ColorSwatch name="Accent" className="bg-accent" />
                        <ColorSwatch
                            name="Destructive"
                            className="bg-destructive"
                        />
                        <ColorSwatch name="Border" className="bg-border" />
                        <ColorSwatch name="Ring" className="bg-ring" />
                        <ColorSwatch name="Card" className="bg-card" />
                    </div>
                </section>

                {/* Chart Colors */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Chart Palette</h2>
                    <div className="flex gap-2">
                        <div className="h-16 flex-1 rounded-lg bg-chart-1" />
                        <div className="h-16 flex-1 rounded-lg bg-chart-2" />
                        <div className="h-16 flex-1 rounded-lg bg-chart-3" />
                        <div className="h-16 flex-1 rounded-lg bg-chart-4" />
                        <div className="h-16 flex-1 rounded-lg bg-chart-5" />
                    </div>
                    <div className="flex gap-2 text-sm text-muted-foreground">
                        <span className="flex-1 text-center">chart-1</span>
                        <span className="flex-1 text-center">chart-2</span>
                        <span className="flex-1 text-center">chart-3</span>
                        <span className="flex-1 text-center">chart-4</span>
                        <span className="flex-1 text-center">chart-5</span>
                    </div>
                </section>

                {/* Typography */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Typography</h2>
                    <div className="space-y-3">
                        <p className="text-4xl font-bold tracking-tight">
                            Heading 1 - Geist Sans
                        </p>
                        <p className="text-3xl font-semibold">Heading 2</p>
                        <p className="text-2xl font-semibold">Heading 3</p>
                        <p className="text-xl font-medium">Heading 4</p>
                        <p className="text-base">
                            Body text - The quick brown fox jumps over the lazy
                            dog.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            Small / Muted - Secondary information and
                            descriptions.
                        </p>
                        <p className="font-mono text-sm">
                            Monospace - code snippets and technical data
                        </p>
                    </div>
                </section>

                {/* Buttons */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Buttons</h2>
                    <div className="flex flex-wrap gap-4">
                        <Button>Primary</Button>
                        <Button variant="secondary">Secondary</Button>
                        <Button variant="outline">Outline</Button>
                        <Button variant="ghost">Ghost</Button>
                        <Button variant="link">Link</Button>
                        <Button variant="destructive">Destructive</Button>
                    </div>
                    <div className="flex flex-wrap gap-4">
                        <Button size="sm">Small</Button>
                        <Button size="default">Default</Button>
                        <Button size="lg">Large</Button>
                    </div>
                </section>

                {/* Badges */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Badges</h2>
                    <div className="flex flex-wrap gap-2">
                        <Badge>Default</Badge>
                        <Badge variant="secondary">Secondary</Badge>
                        <Badge variant="outline">Outline</Badge>
                        <Badge variant="destructive">Destructive</Badge>
                    </div>
                </section>

                {/* Inputs */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Inputs</h2>
                    <div className="max-w-sm space-y-4">
                        <Input placeholder="Default input" />
                        <Input placeholder="Disabled input" disabled />
                    </div>
                </section>

                {/* Cards */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Cards</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Storage Tier</CardTitle>
                                <CardDescription>
                                    Your files are stored in cold storage
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-2xl font-bold">2.4 TB</p>
                                <p className="text-sm text-muted-foreground">
                                    across 1,247 files
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Monthly Cost</CardTitle>
                                <CardDescription>
                                    Based on current usage
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-2xl font-bold">$2.40</p>
                                <p className="text-sm text-muted-foreground">
                                    $0.001 per GB/month
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </section>

                {/* Radius Preview */}
                <section className="space-y-4">
                    <h2 className="text-2xl font-semibold">Border Radius</h2>
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="space-y-1 text-center">
                            <div className="h-12 w-12 rounded-sm bg-primary" />
                            <span className="text-xs text-muted-foreground">
                                sm
                            </span>
                        </div>
                        <div className="space-y-1 text-center">
                            <div className="h-12 w-12 rounded-md bg-primary" />
                            <span className="text-xs text-muted-foreground">
                                md
                            </span>
                        </div>
                        <div className="space-y-1 text-center">
                            <div className="h-12 w-12 rounded-lg bg-primary" />
                            <span className="text-xs text-muted-foreground">
                                lg
                            </span>
                        </div>
                        <div className="space-y-1 text-center">
                            <div className="h-12 w-12 rounded-xl bg-primary" />
                            <span className="text-xs text-muted-foreground">
                                xl
                            </span>
                        </div>
                        <div className="space-y-1 text-center">
                            <div className="h-12 w-12 rounded-2xl bg-primary" />
                            <span className="text-xs text-muted-foreground">
                                2xl
                            </span>
                        </div>
                        <div className="space-y-1 text-center">
                            <div className="h-12 w-12 rounded-full bg-primary" />
                            <span className="text-xs text-muted-foreground">
                                full
                            </span>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

function ColorSwatch({ name, className }: { name: string; className: string }) {
    return (
        <div className="space-y-1.5">
            <div
                className={`h-16 w-full rounded-lg border border-border ${className}`}
            />
            <span className="text-xs text-muted-foreground">{name}</span>
        </div>
    );
}
