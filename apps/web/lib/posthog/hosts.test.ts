import { describe, expect, it } from 'vitest';

import {
    DEFAULT_POSTHOG_HOST,
    resolveAssetsHost,
    resolveUiHost,
} from './hosts';

describe('resolveAssetsHost', () => {
    it('points the default US host at its assets sibling', () => {
        expect(resolveAssetsHost(DEFAULT_POSTHOG_HOST)).toBe(
            'https://us-assets.i.posthog.com'
        );
    });

    it('does the same for the EU region', () => {
        expect(resolveAssetsHost('https://eu.i.posthog.com')).toBe(
            'https://eu-assets.i.posthog.com'
        );
    });

    it('leaves a self-hosted origin alone — it serves assets itself', () => {
        expect(resolveAssetsHost('https://ph.example.com')).toBe(
            'https://ph.example.com'
        );
    });
});

describe('resolveUiHost', () => {
    it('drops the ingestion subdomain from the default US host', () => {
        expect(resolveUiHost(DEFAULT_POSTHOG_HOST)).toBe(
            'https://us.posthog.com'
        );
    });

    it('does the same for the EU region', () => {
        expect(resolveUiHost('https://eu.i.posthog.com')).toBe(
            'https://eu.posthog.com'
        );
    });

    it('leaves a self-hosted origin alone — dashboard and ingest share it', () => {
        expect(resolveUiHost('https://ph.example.com')).toBe(
            'https://ph.example.com'
        );
    });
});
