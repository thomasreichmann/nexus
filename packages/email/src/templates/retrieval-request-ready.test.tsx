import { render } from '@react-email/components';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    RetrievalRequestReadyEmail,
    retrievalRequestReadySubject,
} from './retrieval-request-ready';

describe('RetrievalRequestReadyEmail', () => {
    const props = {
        downloadUrl: 'https://nexus.test/dashboard/files?request=req-123',
        fileCount: 12,
        partCount: 3,
        totalBytes: 10_737_418_240,
        expiresAt: new Date('2026-07-08T15:45:00Z'),
    };
    let html: string;

    beforeAll(async () => {
        html = await render(<RetrievalRequestReadyEmail {...props} />);
    });

    it('names the file count rather than a file', () => {
        expect(html).toContain('12 files');
    });

    it('names the part count when the request was chunked', () => {
        expect(html).toContain('3 parts');
    });

    it('renders the total size', () => {
        expect(html).toContain('10 GB');
    });

    it('links to the app, not to a presigned URL', () => {
        expect(html).toContain(props.downloadUrl);
        expect(html).not.toContain('X-Amz-Signature');
    });

    it("renders the artifact's expiry in UTC", () => {
        expect(html).toContain('July 8, 2026 at 3:45 PM UTC');
    });

    it('renders to a full HTML document', () => {
        expect(html).toContain('<!DOCTYPE html');
    });

    it('builds a subject line naming the file count', () => {
        expect(retrievalRequestReadySubject(props)).toBe(
            'Your 12 files are ready to download'
        );
    });

    it('drops the multi-part copy for a single archive', async () => {
        const single = await render(
            <RetrievalRequestReadyEmail {...props} partCount={1} />
        );
        expect(single).toContain('a single zip archive');
        expect(single).not.toContain('parts');
    });
});
