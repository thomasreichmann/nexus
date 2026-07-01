// File System Access API surface that TypeScript's lib.dom (5.9) still omits:
// the permission methods on handles, the global picker, and the drag-drop handle
// accessor. Chromium-only at runtime — every call site feature-detects first.

interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
    queryPermission(
        descriptor?: FileSystemHandlePermissionDescriptor
    ): Promise<PermissionState>;
    requestPermission(
        descriptor?: FileSystemHandlePermissionDescriptor
    ): Promise<PermissionState>;
}

interface OpenFilePickerOptions {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
}

interface Window {
    showOpenFilePicker(
        options?: OpenFilePickerOptions
    ): Promise<FileSystemFileHandle[]>;
}

interface DataTransferItem {
    getAsFileSystemHandle(): Promise<FileSystemHandle | null>;
}
