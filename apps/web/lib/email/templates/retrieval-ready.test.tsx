import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@react-email/components';
import { RetrievalReadyEmail, retrievalReadySubject } from './retrieval-ready';

describe('RetrievalReadyEmail', () => {
    const props = {
        fileName: 'vacation-photos.zip',
        downloadUrl: 'https://mock-s3.test/test-bucket/user123/file456',
        expiresAt: new Date('2026-07-08T15:45:00Z'),
    };

    let html: string;
    beforeAll(async () => {
        html = await render(<RetrievalReadyEmail {...props} />);
    });

    it('renders the file name', () => {
        expect(html).toContain('vacation-photos.zip');
    });

    it('renders the download link on the button and as fallback text', () => {
        // Button href + plain-text fallback both carry the URL
        expect(html).toContain(props.downloadUrl);
    });

    it('renders a human-readable expiration date in UTC', () => {
        expect(html).toContain('July 8, 2026 at 3:45 PM UTC');
    });

    it('renders to a full HTML document', () => {
        expect(html).toContain('<!DOCTYPE html');
    });

    it('builds a subject line naming the file', () => {
        expect(retrievalReadySubject(props)).toBe(
            'Your file "vacation-photos.zip" is ready to download'
        );
    });
});
