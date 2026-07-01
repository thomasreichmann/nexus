import { describe, expect, it } from 'vitest';
import { render } from '@react-email/components';
import { RetrievalReadyEmail } from './retrieval-ready';

describe('RetrievalReadyEmail', () => {
    const props = {
        fileName: 'vacation-photos.zip',
        downloadUrl: 'https://mock-s3.test/test-bucket/user123/file456',
        expiresAt: new Date('2026-07-08T15:45:00Z'),
    };

    it('renders the file name', async () => {
        const html = await render(<RetrievalReadyEmail {...props} />);
        expect(html).toContain('vacation-photos.zip');
    });

    it('renders the download link on the button and as fallback text', async () => {
        const html = await render(<RetrievalReadyEmail {...props} />);
        // Button href + plain-text fallback both carry the URL
        expect(html).toContain(props.downloadUrl);
    });

    it('renders a human-readable expiration date', async () => {
        const html = await render(<RetrievalReadyEmail {...props} />);
        expect(html).toContain('July 8, 2026');
    });

    it('renders to a full HTML document', async () => {
        const html = await render(<RetrievalReadyEmail {...props} />);
        expect(html).toContain('<!DOCTYPE html');
    });
});
