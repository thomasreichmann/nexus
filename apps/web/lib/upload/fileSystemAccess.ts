import { isFileMatch, toFileIdentity, type FileIdentity } from './parts';
import { isAbortError } from './errors';
import { MAX_FILES_PER_DROP } from './limits';

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

/**
 * The result of one ingest gesture (a drop, a picker, a fallback input).
 * `truncated` means the walk stopped at `MAX_FILES_PER_DROP` with files left
 * behind; `emptySelection` means the gesture offered real file entries but
 * none survived (an empty folder, or hidden litter only) — distinct from a
 * dismissed dialog or a text drag, which stay silent. Callers surface both
 * instead of silently shortchanging the selection (#388).
 */
export interface PickedFileBatch {
    files: PickedFile[];
    truncated: boolean;
    emptySelection?: boolean;
}

/** True when the browser exposes the picker + persistable handles (Chromium). */
export function isFileSystemAccessSupported(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

/** True when the browser can open a native folder picker (Chromium). */
export function isDirectoryPickerSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Dotfiles are skipped during directory walks: a photographer's shoot folder
 * reliably carries `.DS_Store`-style litter that would pad the queue and the
 * quota. Only walked *children* are filtered — an explicitly dropped or picked
 * entry is taken at the user's word, hidden or not.
 */
function isHiddenEntryName(name: string): boolean {
    return name.startsWith('.');
}

/**
 * Open the native picker and pair each chosen file with its persistable handle.
 * Returns an empty batch when unsupported or when the user dismisses the
 * dialog (the API rejects with an AbortError, which isn't a real failure).
 */
export async function pickFilesWithHandles(): Promise<PickedFileBatch> {
    if (!isFileSystemAccessSupported()) return { files: [], truncated: false };
    let handles: FileSystemFileHandle[];
    try {
        handles = await window.showOpenFilePicker({ multiple: true });
    } catch (error) {
        if (isAbortError(error)) return { files: [], truncated: false };
        throw error;
    }
    const files = await Promise.all(
        handles.map(async (handle) => ({
            file: await handle.getFile(),
            handle,
        }))
    );
    return { files, truncated: false };
}

/**
 * Append one file to a walk's batch, dropping it (and marking the batch
 * truncated) once the cap is reached. Truncation is only ever set here, at the
 * moment a real file is lost — never for leftover litter or empty directories.
 */
function pushPickedFile(sink: PickedFileBatch, picked: PickedFile): void {
    if (sink.files.length >= MAX_FILES_PER_DROP) {
        sink.truncated = true;
        return;
    }
    sink.files.push(picked);
}

/** Flag a batch whose gesture offered file entries but yielded nothing. */
function flagEmptySelection(
    sink: PickedFileBatch,
    sawEntries: boolean
): PickedFileBatch {
    if (sawEntries && sink.files.length === 0) sink.emptySelection = true;
    return sink;
}

/**
 * Depth-first walk of a directory handle, collecting every visible file with
 * its handle so walked files resume exactly like picked ones. An entry that
 * can't be read (moved or locked mid-walk) is skipped rather than sinking the
 * whole folder.
 */
async function walkDirectoryHandle(
    directory: FileSystemDirectoryHandle,
    sink: PickedFileBatch
): Promise<void> {
    for await (const entry of directory.values()) {
        if (sink.truncated) return;
        if (isHiddenEntryName(entry.name)) continue;
        if (entry.kind === 'directory') {
            await walkDirectoryHandle(entry, sink);
            continue;
        }
        try {
            pushPickedFile(sink, {
                file: await entry.getFile(),
                handle: entry,
            });
        } catch {
            // Skip the unreadable entry.
        }
    }
}

/**
 * Same walk over the legacy `webkitGetAsEntry` tree (Firefox/Safari drops) —
 * no handles there, so these files take the manual re-add path on resume.
 * `readEntries` hands out at most ~100 entries per call and must be re-called
 * until it returns an empty batch.
 */
async function walkDirectoryEntry(
    directory: FileSystemDirectoryEntry,
    sink: PickedFileBatch
): Promise<void> {
    const reader = directory.createReader();
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject)
        ).catch(() => []);
        if (batch.length === 0) return;
        for (const entry of batch) {
            if (sink.truncated) return;
            if (isHiddenEntryName(entry.name)) continue;
            if (entry.isDirectory) {
                await walkDirectoryEntry(
                    entry as FileSystemDirectoryEntry,
                    sink
                );
                continue;
            }
            if (!entry.isFile) continue;
            try {
                const file = await new Promise<File>((resolve, reject) =>
                    (entry as FileSystemFileEntry).file(resolve, reject)
                );
                pushPickedFile(sink, { file });
            } catch {
                // Skip the unreadable entry.
            }
        }
    }
}

/**
 * Read a drop's files, walking any dropped directory and capturing a
 * `FileSystemFileHandle` per file on Chromium so a dragged file is zero-touch
 * resumable just like a picked one. The synchronous `getAsFile()` /
 * `getAsFileSystemHandle()` / `webkitGetAsEntry()` reads happen before the
 * first await, since the DataTransferItems are only live during the drop event
 * (the handles and entries they yield stay usable after it).
 */
export async function pickedFilesFromDataTransfer(
    dataTransfer: DataTransfer
): Promise<PickedFileBatch> {
    const sink: PickedFileBatch = { files: [], truncated: false };
    if (isFileSystemAccessSupported()) {
        const captured = Array.from(dataTransfer.items)
            .filter((item) => item.kind === 'file')
            .map((item) => ({
                file: item.getAsFile(),
                handlePromise: item.getAsFileSystemHandle(),
            }));
        for (const { file, handlePromise } of captured) {
            if (sink.truncated) break;
            const handle = await handlePromise.catch(() => null);
            if (handle && handle.kind === 'directory') {
                await walkDirectoryHandle(
                    handle as FileSystemDirectoryHandle,
                    sink
                );
            } else if (file) {
                pushPickedFile(
                    sink,
                    handle && handle.kind === 'file'
                        ? { file, handle: handle as FileSystemFileHandle }
                        : { file }
                );
            }
        }
        return flagEmptySelection(sink, captured.length > 0);
    }
    // No File System Access API: `webkitGetAsEntry` is the only way to see
    // into a dropped directory on Firefox/Safari.
    const captured = Array.from(dataTransfer.items)
        .filter((item) => item.kind === 'file')
        .map((item) => ({
            file: item.getAsFile(),
            entry:
                typeof item.webkitGetAsEntry === 'function'
                    ? item.webkitGetAsEntry()
                    : null,
        }));
    if (!captured.some(({ entry }) => entry?.isDirectory)) {
        // Plain files only — keep the simple path, which also covers synthetic
        // drops whose `items` don't back the entry API.
        sink.files = Array.from(dataTransfer.files).map((file) => ({ file }));
        return flagEmptySelection(sink, captured.length > 0);
    }
    for (const { file, entry } of captured) {
        if (sink.truncated) break;
        if (entry?.isDirectory) {
            await walkDirectoryEntry(entry as FileSystemDirectoryEntry, sink);
        } else if (file) {
            pushPickedFile(sink, { file });
        }
    }
    return flagEmptySelection(sink, true);
}

/**
 * Open the native folder picker and walk the chosen directory. Returns an
 * empty batch when unsupported (callers fall back to a `webkitdirectory`
 * input) or when the user dismisses the dialog.
 */
export async function pickFolderWithHandles(): Promise<PickedFileBatch> {
    const sink: PickedFileBatch = { files: [], truncated: false };
    if (!isDirectoryPickerSupported()) return sink;
    let directory: FileSystemDirectoryHandle;
    try {
        directory = await window.showDirectoryPicker();
    } catch (error) {
        if (isAbortError(error)) return sink;
        throw error;
    }
    await walkDirectoryHandle(directory, sink);
    // The user did choose a folder here, so an empty yield deserves feedback.
    return flagEmptySelection(sink, true);
}

/**
 * Map a `webkitdirectory` input's selection to picked files (the input API
 * predates handles, so none are captured). Hidden entries are filtered the
 * same way the walks do — by path segments *below* the chosen root, so a
 * deliberately picked hidden folder isn't emptied out.
 */
export function pickedFilesFromDirectoryInput(
    fileList: FileList
): PickedFileBatch {
    const files = Array.from(fileList)
        .filter(
            (file) =>
                !file.webkitRelativePath
                    .split('/')
                    .slice(1)
                    .some(isHiddenEntryName)
        )
        .map((file) => ({ file }));
    const sink: PickedFileBatch =
        files.length > MAX_FILES_PER_DROP
            ? { files: files.slice(0, MAX_FILES_PER_DROP), truncated: true }
            : { files, truncated: false };
    return flagEmptySelection(sink, true);
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
