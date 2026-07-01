import { describe, expect, it, vi, afterEach } from 'vitest';
import {
    isFileSystemAccessSupported,
    pickFilesWithHandles,
    pickedFilesFromDataTransfer,
    reacquireMatchingFile,
} from './fileSystemAccess';

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

afterEach(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
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
    it('returns [] when unsupported', async () => {
        expect(await pickFilesWithHandles()).toEqual([]);
    });

    it('pairs each chosen file with its handle', async () => {
        const handle = stubHandle();
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(
            async () => [handle]
        );
        const picked = await pickFilesWithHandles();
        expect(picked).toHaveLength(1);
        expect(picked[0].handle).toBe(handle);
        expect(picked[0].file.name).toBe(IDENTITY.name);
    });

    it('returns [] when the user dismisses the dialog (AbortError)', async () => {
        (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(
            async () => {
                throw new DOMException('cancelled', 'AbortError');
            }
        );
        expect(await pickFilesWithHandles()).toEqual([]);
    });
});

describe('pickedFilesFromDataTransfer', () => {
    it('falls back to plain files when unsupported', async () => {
        const file = makeFile(
            IDENTITY.name,
            IDENTITY.size,
            IDENTITY.lastModified
        );
        const dataTransfer = {
            files: [file],
            items: [],
        } as unknown as DataTransfer;

        const picked = await pickedFilesFromDataTransfer(dataTransfer);
        expect(picked).toEqual([{ file }]);
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
        const dataTransfer = {
            files: [file],
            items: [
                {
                    kind: 'file',
                    getAsFile: () => file,
                    getAsFileSystemHandle: async () => handle,
                },
            ],
        } as unknown as DataTransfer;

        const picked = await pickedFilesFromDataTransfer(dataTransfer);
        expect(picked).toEqual([{ file, handle }]);
    });
});
