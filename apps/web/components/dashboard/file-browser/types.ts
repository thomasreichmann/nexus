import type { FileWithRetrieval } from '@nexus/db/repo/files';

export interface FileItemProps {
    file: FileWithRetrieval;
    isSelected: boolean;
    isHighlighted: boolean;
    hasSelection: boolean;
    onSelect: (shiftKey: boolean) => void;
}
