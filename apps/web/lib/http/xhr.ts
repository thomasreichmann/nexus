/**
 * A non-2xx response from the upload PUT. Carries the status so callers can
 * distinguish recoverable cases — notably 403, which is how S3 reports an
 * expired presigned URL and signals "re-presign and retry, don't restart".
 */
export class UploadHttpError extends Error {
    constructor(public readonly status: number) {
        super(`Upload failed with status ${status}`);
        this.name = 'UploadHttpError';
    }
}

/**
 * A transport-level failure (XHR `error` event) — no HTTP status reached us.
 * Typically a dropped connection; the upload engine treats it as pause-worthy
 * when the browser is offline rather than a hard failure.
 */
export class UploadNetworkError extends Error {
    constructor() {
        super('Network error during upload');
        this.name = 'UploadNetworkError';
    }
}

/**
 * XHR-based PUT for upload progress tracking.
 * Using XHR instead of fetch because fetch doesn't support upload progress events.
 */
export function xhrPut(
    url: string,
    body: Blob,
    options: {
        onProgress?: (loaded: number, total: number) => void;
        signal?: AbortSignal;
    }
): Promise<{ etag: string | null }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);

        if (options.onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    options.onProgress!(e.loaded, e.total);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve({ etag: xhr.getResponseHeader('ETag') });
            } else {
                reject(new UploadHttpError(xhr.status));
            }
        };

        xhr.onerror = () => reject(new UploadNetworkError());
        xhr.onabort = () =>
            reject(new DOMException('Upload aborted', 'AbortError'));

        if (options.signal) {
            options.signal.addEventListener('abort', () => xhr.abort(), {
                once: true,
            });
        }

        xhr.send(body);
    });
}
