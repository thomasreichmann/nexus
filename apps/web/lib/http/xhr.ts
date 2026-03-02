/**
 * XHR-based PUT for upload progress tracking.
 * Using XHR instead of fetch because fetch doesn't support upload progress events.
 */
export function xhrPut(
    url: string,
    body: Blob,
    options: {
        contentType?: string;
        onProgress?: (loaded: number, total: number) => void;
        signal?: AbortSignal;
    }
): Promise<{ etag: string | null }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);

        // Must match the Content-Type the presigned URL was signed with
        if (options.contentType) {
            xhr.setRequestHeader('Content-Type', options.contentType);
        }

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
                reject(new Error(`Upload failed with status ${xhr.status}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
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
