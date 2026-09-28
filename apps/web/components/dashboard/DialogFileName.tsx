import { MiddleTruncateName } from './MiddleTruncateName';

interface DialogFileNameProps {
    name: string;
}

/** The "which file is at stake" card the confirmation dialogs share. */
export function DialogFileName({ name }: DialogFileNameProps) {
    return (
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm">
            <MiddleTruncateName name={name} className="font-medium" />
        </div>
    );
}
