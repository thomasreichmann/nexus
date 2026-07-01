import { isFileMatch, toFileIdentity, type FileIdentity } from './parts';
import { isAbortError } from './errors';

/**
 * Thin, feature-detected wrapper over the File System Access API. On Chromium a
 * picked file yields a `FileSystemFileHandle` that's structured-cloneable into
 * IndexedDB, so after a reload we can re-acquire the bytes with a single
 * permission click instead of asking the user to find and re-select the file.
 * Everywhere else (Firefox, Safari) the helpers degrade to plain `File`s and the
 * existing re-add flow takes over.
 */

/** A picked file plus the handle that makes it zero-touch resumable, when available. */
export interface PickedFile {
    file: File;
    handle?: FileSystemFileHandle;
}

/** True when the browser exposes the picker + persistable handles (Chromium). */
export function isFileSystemAccessSupported(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

/**
 * Open the native picker and pair each chosen file with its persistable handle.
 * Returns `[]` when unsupported or when the user dismisses the dialog (the API
 * rejects with an AbortError, which isn't a real failure).
 */
export async function pickFilesWithHandles(): Promise<PickedFile[]> {
    if (!isFileSystemAccessSupported()) return [];
    let handles: FileSystemFileHandle[];
    try {
        handles = await window.showOpenFilePicker({ multiple: true });
    } catch (error) {
        if (isAbortError(error)) return [];
        throw error;
    }
    return Promise.all(
        handles.map(async (handle) => ({
            file: await handle.getFile(),
            handle,
        }))
    );
}

/**
 * Read a drop's files, capturing a `FileSystemFileHandle` per item on Chromium so
 * a dragged file is zero-touch resumable just like a picked one. The synchronous
 * `getAsFile()` / `getAsFileSystemHandle()` reads happen before the first await,
 * since the DataTransferItems are only live during the drop event.
 */
export async function pickedFilesFromDataTransfer(
    dataTransfer: DataTransfer
): Promise<PickedFile[]> {
    if (!isFileSystemAccessSupported()) {
        return Array.from(dataTransfer.files).map((file) => ({ file }));
    }
    const captured = Array.from(dataTransfer.items)
        .filter((item) => item.kind === 'file')
        .map((item) => ({
            file: item.getAsFile(),
            handlePromise: item.getAsFileSystemHandle(),
        }));
    const picked = await Promise.all(
        captured.map(
            async ({ file, handlePromise }): Promise<PickedFile | null> => {
                if (!file) return null;
                const handle = await handlePromise.catch(() => null);
                return handle && handle.kind === 'file'
                    ? { file, handle: handle as FileSystemFileHandle }
                    : { file };
            }
        )
    );
    return picked.filter((p): p is PickedFile => p !== null);
}

/**
 * Re-request read access to a persisted handle. Must run inside a user gesture
 * (the click on "Resume") — after a reload the permission reverts to `prompt`,
 * and `requestPermission` needs a gesture to show its prompt.
 */
async function ensureReadPermission(
    handle: FileSystemFileHandle
): Promise<boolean> {
    const descriptor = { mode: 'read' } as const;
    if ((await handle.queryPermission(descriptor)) === 'granted') return true;
    return (await handle.requestPermission(descriptor)) === 'granted';
}

/**
 * Re-acquire the File behind a persisted handle and confirm it still matches the
 * upload's identity. Returns `null` if permission is denied, the file is gone, or
 * it changed since it was picked — callers then fall back to the manual re-add
 * flow. Defensive against any handle method throwing (older API shapes, revoked
 * access), so a single click can't crash the resume.
 */
export async function reacquireMatchingFile(
    handle: FileSystemFileHandle,
    identity: FileIdentity
): Promise<File | null> {
    try {
        if (!(await ensureReadPermission(handle))) return null;
        const file = await handle.getFile();
        return isFileMatch(identity, toFileIdentity(file)) ? file : null;
    } catch {
        return null;
    }
}
