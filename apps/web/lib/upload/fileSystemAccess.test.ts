import { describe, expect, it, vi, afterEach } from 'vitest';
import {
    isFileSystemAccessSupported,
    pickFilesWithHandles,
    pickFolderWithHandles,
    pickedFilesFromDataTransfer,
    pickedFilesFromDirectoryInput,
    reacquireMatchingFile,
} from './fileSystemAccess';
import { MAX_FILES_PER_DROP } from './limits';

function makeFile(name: string, size: number, lastModified: number): File {
    return new File([new Uint8Array(size)], name, { lastModified });
}

const IDENTITY = { name: 'shoot.zip', size: 8, lastModified: 1700000000000 };

interface HandleStub {
    query?: PermissionState;
    request?: PermissionState;
    file?: File;
    throwOn?: 'query' | 'request' | 'getFile';
}

function stubHandle(opts: HandleStub = {}): FileSystemFileHandle {
    const guard = (key: HandleStub['throwOn']) => {
        if (opts.throwOn === key) throw new Error(`boom: ${key}`);
    };
    return {
        kind: 'file',
        name: IDENTITY.name,
        queryPermission: vi.fn(async () => {
            guard('query');
            return opts.query ?? 'granted';
        }),
        requestPermission: vi.fn(async () => {
            guard('request');
            return opts.request ?? 'granted';
        }),
        getFile: vi.fn(async () => {
            guard('getFile');
            return (
                opts.file ??
                makeFile(IDENTITY.name, IDENTITY.size, IDENTITY.lastModified)
            );
        }),
    } as unknown as FileSystemFileHandle;
}

/** A lean file handle for walk tests — one shared File keeps the cap test cheap. */
function fileHandleOf(file: File, name = file.name): FileSystemFileHandle {
    return {
        kind: 'file',
        name,
        getFile: async () => file,
    } as unknown as FileSystemFileHandle;
}

function stubDirectoryHandle(
    name: string,
    entries: Iterable<FileSystemFileHandle | FileSystemDirectoryHandle>
): FileSystemDirectoryHandle {
    return {
        kind: 'directory',
        name,
        values: async function* () {
            yield* entries;
        },
    } as unknown as FileSystemDirectoryHandle;
}

function stubFileEntry(file: File): FileSystemFileEntry {
    return {
        isFile: true,
        isDirectory: false,
        name: file.name,
        file: (resolve: (file: File) => void) => resolve(file),
    } as unknown as FileSystemFileEntry;
}

/** Entries arrive in batches, mirroring readEntries' ~100-entry pages. */
function stubDirectoryEntry(
    name: string,
    batches: FileSystemEntry[][]
): FileSystemDirectoryEntry {
    let next = 0;
    return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => ({
            readEntries: (resolve: (entries: FileSystemEntry[]) => void) =>
                resolve(batches[next++] ?? []),
        }),
    } as unknown as FileSystemDirectoryEntry;
}

function stubDataTransfer(
    items: Record<string, unknown>[],
    files: File[] = []
): DataTransfer {
    return { files, items } as unknown as DataTransfer;
}

afterEach(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    vi.restoreAllMocks();
});

describe('isFileSystemAccessSupported', () => {
    it('is false when the picker is absent (Firefox/Safari/jsdom)', () => {
        expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('is true when the picker exists (Chromium)', () => {
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker =
            () => {};
        expect(isFileSystemAccessSupported()).toBe(true);
    });
});

describe('reacquireMatchingFile', () => {
    it('returns the file when permission is already granted and identity matches', async () => {
        const handle = stubHandle({ query: 'granted' });
        const file = await reacquireMatchingFile(handle, IDENTITY);
        expect(file?.name).toBe(IDENTITY.name);
        expect(handle.requestPermission).not.toHaveBeenCalled();
    });

    it('requests permission when not yet granted, then returns the file', async () => {
        const handle = stubHandle({ query: 'prompt', request: 'granted' });
        const file = await reacquireMatchingFile(handle, IDENTITY);
        expect(file?.name).toBe(IDENTITY.name);
        expect(handle.requestPermission).toHaveBeenCalled();
    });

    it('returns null when permission is denied', async () => {
        const handle = stubHandle({ query: 'prompt', request: 'denied' });
        expect(await reacquireMatchingFile(handle, IDENTITY)).toBeNull();
    });

    it('returns null when the reopened file no longer matches identity', async () => {
        const handle = stubHandle({
            file: makeFile(
                IDENTITY.name,
                IDENTITY.size + 1,
                IDENTITY.lastModified
            ),
        });
        expect(await reacquireMatchingFile(handle, IDENTITY)).toBeNull();
    });

    it('returns null (not throws) when a handle method throws', async () => {
        expect(
            await reacquireMatchingFile(
                stubHandle({ throwOn: 'getFile' }),
                IDENTITY
            )
        ).toBeNull();
        expect(
            await reacquireMatchingFile(
                stubHandle({ throwOn: 'query' }),
                IDENTITY
            )
        ).toBeNull();
    });
});

describe('pickFilesWithHandles', () => {
    it('returns an empty batch when unsupported', async () => {
        expect(await pickFilesWithHandles()).toEqual({
            files: [],
            truncated: false,
        });
    });

    it('pairs each chosen file with its handle', async () => {
        const handle = stubHandle();
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(
            async () => [handle]
        );
        const { files } = await pickFilesWithHandles();
        expect(files).toHaveLength(1);
        expect(files[0].handle).toBe(handle);
        expect(files[0].file.name).toBe(IDENTITY.name);
    });

    it('returns an empty batch when the user dismisses the dialog (AbortError)', async () => {
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(
            async () => {
                throw new DOMException('cancelled', 'AbortError');
            }
        );
        expect(await pickFilesWithHandles()).toEqual({
            files: [],
            truncated: false,
        });
    });
});

describe('pickedFilesFromDataTransfer', () => {
    it('falls back to plain files when unsupported', async () => {
        const file = makeFile(
            IDENTITY.name,
            IDENTITY.size,
            IDENTITY.lastModified
        );
        const dataTransfer = stubDataTransfer([], [file]);

        const picked = await pickedFilesFromDataTransfer(dataTransfer);
        expect(picked).toEqual({ files: [{ file }], truncated: false });
    });

    it('captures a handle per dropped item when supported', async () => {
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker =
            () => {};
        const file = makeFile(
            IDENTITY.name,
            IDENTITY.size,
            IDENTITY.lastModified
        );
        const handle = stubHandle();
        const dataTransfer = stubDataTransfer(
            [
                {
                    kind: 'file',
                    getAsFile: () => file,
                    getAsFileSystemHandle: async () => handle,
                },
            ],
            [file]
        );

        const picked = await pickedFilesFromDataTransfer(dataTransfer);
        expect(picked).toEqual({
            files: [{ file, handle }],
            truncated: false,
        });
    });

    it('walks a dropped directory recursively, skipping hidden entries', async () => {
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker =
            () => {};
        const imgA = makeFile('IMG_1.NEF', 1, 1);
        const imgB = makeFile('IMG_2.NEF', 2, 2);
        const litter = makeFile('.DS_Store', 3, 3);
        const handleA = fileHandleOf(imgA);
        const handleB = fileHandleOf(imgB);
        const directory = stubDirectoryHandle('shoot', [
            fileHandleOf(litter),
            handleA,
            stubDirectoryHandle('day2', [handleB]),
            stubDirectoryHandle('.cache', [fileHandleOf(litter, 'tmp.bin')]),
        ]);
        const dataTransfer = stubDataTransfer([
            {
                kind: 'file',
                getAsFile: () => null,
                getAsFileSystemHandle: async () => directory,
            },
        ]);

        const picked = await pickedFilesFromDataTransfer(dataTransfer);
        expect(picked).toEqual({
            files: [
                { file: imgA, handle: handleA },
                { file: imgB, handle: handleB },
            ],
            truncated: false,
        });
    });

    it('flags a directory that walks to nothing, instead of silence', async () => {
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker =
            () => {};
        const directory = stubDirectoryHandle('empty-shoot', [
            fileHandleOf(makeFile('.DS_Store', 1, 1)),
        ]);
        const dataTransfer = stubDataTransfer([
            {
                kind: 'file',
                getAsFile: () => null,
                getAsFileSystemHandle: async () => directory,
            },
        ]);

        expect(await pickedFilesFromDataTransfer(dataTransfer)).toEqual({
            files: [],
            truncated: false,
            emptySelection: true,
        });
    });

    it('stops the walk at the cap and reports truncation', async () => {
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker =
            () => {};
        const shared = makeFile('frame.NEF', 1, 1);
        const directory = stubDirectoryHandle('shoot', {
            *[Symbol.iterator]() {
                for (let i = 0; i < MAX_FILES_PER_DROP + 2; i++) {
                    yield fileHandleOf(shared, `frame-${i}.NEF`);
                }
            },
        });
        const dataTransfer = stubDataTransfer([
            {
                kind: 'file',
                getAsFile: () => null,
                getAsFileSystemHandle: async () => directory,
            },
        ]);

        const picked = await pickedFilesFromDataTransfer(dataTransfer);
        expect(picked.files).toHaveLength(MAX_FILES_PER_DROP);
        expect(picked.truncated).toBe(true);
    });

    it('walks directories via webkitGetAsEntry when handles are unsupported', async () => {
        const loose = makeFile('loose.txt', 1, 1);
        const imgA = makeFile('IMG_1.NEF', 2, 2);
        const imgB = makeFile('IMG_2.NEF', 3, 3);
        const directory = stubDirectoryEntry('shoot', [
            // Two batches, so the readEntries-until-empty loop is exercised.
            [stubFileEntry(imgA), stubFileEntry(makeFile('.DS_Store', 4, 4))],
            [stubDirectoryEntry('day2', [[stubFileEntry(imgB)]])],
        ]);
        const dataTransfer = stubDataTransfer(
            [
                {
                    kind: 'file',
                    getAsFile: () => loose,
                    webkitGetAsEntry: () => stubFileEntry(loose),
                },
                {
                    kind: 'file',
                    getAsFile: () => null,
                    webkitGetAsEntry: () => directory,
                },
            ],
            [loose]
        );

        const picked = await pickedFilesFromDataTransfer(dataTransfer);
        expect(picked).toEqual({
            files: [{ file: loose }, { file: imgA }, { file: imgB }],
            truncated: false,
        });
    });
});

describe('pickFolderWithHandles', () => {
    it('returns an empty batch when unsupported', async () => {
        expect(await pickFolderWithHandles()).toEqual({
            files: [],
            truncated: false,
        });
    });

    it('walks the picked folder', async () => {
        const img = makeFile('IMG_1.NEF', 1, 1);
        const handle = fileHandleOf(img);
        (window as { showDirectoryPicker?: unknown }).showDirectoryPicker =
            vi.fn(async () => stubDirectoryHandle('shoot', [handle]));

        expect(await pickFolderWithHandles()).toEqual({
            files: [{ file: img, handle }],
            truncated: false,
        });
    });

    it('flags an empty pick, but not a dismissed dialog', async () => {
        (window as { showDirectoryPicker?: unknown }).showDirectoryPicker =
            vi.fn(async () => stubDirectoryHandle('empty', []));
        expect(await pickFolderWithHandles()).toEqual({
            files: [],
            truncated: false,
            emptySelection: true,
        });

        (window as { showDirectoryPicker?: unknown }).showDirectoryPicker =
            vi.fn(async () => {
                throw new DOMException('cancelled', 'AbortError');
            });
        expect(await pickFolderWithHandles()).toEqual({
            files: [],
            truncated: false,
        });
    });
});

describe('pickedFilesFromDirectoryInput', () => {
    function makeTreeFile(name: string, relativePath: string): File {
        const file = makeFile(name, 1, 1);
        Object.defineProperty(file, 'webkitRelativePath', {
            value: relativePath,
        });
        return file;
    }

    it('maps files, filtering hidden entries below the chosen root', () => {
        const imgA = makeTreeFile('IMG_1.NEF', 'shoot/IMG_1.NEF');
        const imgB = makeTreeFile('IMG_2.NEF', 'shoot/day2/IMG_2.NEF');
        const fileList = [
            imgA,
            makeTreeFile('.DS_Store', 'shoot/.DS_Store'),
            imgB,
            makeTreeFile('tmp.bin', 'shoot/.cache/tmp.bin'),
        ] as unknown as FileList;

        expect(pickedFilesFromDirectoryInput(fileList)).toEqual({
            files: [{ file: imgA }, { file: imgB }],
            truncated: false,
        });
    });

    it('keeps files when the chosen root itself is hidden', () => {
        const img = makeTreeFile('IMG_1.NEF', '.backup/IMG_1.NEF');
        const fileList = [img] as unknown as FileList;

        expect(pickedFilesFromDirectoryInput(fileList)).toEqual({
            files: [{ file: img }],
            truncated: false,
        });
    });

    it('flags a folder whose files were all filtered out', () => {
        const fileList = [
            makeTreeFile('.DS_Store', 'shoot/.DS_Store'),
        ] as unknown as FileList;

        expect(pickedFilesFromDirectoryInput(fileList)).toEqual({
            files: [],
            truncated: false,
            emptySelection: true,
        });
    });
});
