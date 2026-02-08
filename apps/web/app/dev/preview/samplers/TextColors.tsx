export function TextColors() {
    return (
        <div className="space-y-1 text-sm">
            <p className="text-destructive">
                Destructive text — error messages and warnings
            </p>
            <p className="text-foreground">Foreground text — primary content</p>
            <p className="text-muted-foreground">
                Muted text — secondary content
            </p>
        </div>
    );
}
