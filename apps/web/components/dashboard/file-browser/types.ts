import type { RefCallback } from 'react';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

export interface FileItemProps {
    file: FileWithRetrieval;
    isSelected: boolean;
    isHighlighted: boolean;
    hasSelection: boolean;
    onSelect: (shiftKey: boolean) => void;
    /** Attached to the root element — deep-link scroll target. */
    ref?: RefCallback<HTMLElement>;
}
