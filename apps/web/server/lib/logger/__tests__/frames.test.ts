import { describe, expect, it } from 'vitest';
import {
    classifyFile,
    collapseFrames,
    isCollapsedMarker,
    type FrameInfo,
} from '../patches/frames';

describe('classifyFile', () => {
    const projectRoot = '/Users/test/project';

    it('classifies node: built-ins as internal', () => {
        expect(classifyFile('node:fs', projectRoot)).toBe('internal');
        expect(classifyFile('node:path', projectRoot)).toBe('internal');
        expect(classifyFile('node:internal/timers', projectRoot)).toBe(
            'internal'
        );
    });

    it('classifies null/undefined as internal', () => {
        expect(classifyFile(null, projectRoot)).toBe('internal');
    });

    it('classifies node_modules as vendor', () => {
        expect(
            classifyFile(
                '/Users/test/project/node_modules/react/index.js',
                projectRoot
            )
        ).toBe('vendor');
        expect(
            classifyFile(
                '/Users/test/project/node_modules/@trpc/server/dist/index.js',
                projectRoot
            )
        ).toBe('vendor');
    });

    it('classifies .next internals as internal', () => {
        expect(
            classifyFile(
                '/Users/test/project/.next/server/app/api/trpc/route.js',
                projectRoot
            )
        ).toBe('internal');
    });

    it('classifies project files as project', () => {
        expect(
            classifyFile(
                '/Users/test/project/server/trpc/routers/dashboard.ts',
                projectRoot
            )
        ).toBe('project');
        expect(
            classifyFile('/Users/test/project/lib/utils.ts', projectRoot)
        ).toBe('project');
    });

    it('classifies files outside project as internal', () => {
        expect(classifyFile('/other/path/file.ts', projectRoot)).toBe(
            'internal'
        );
    });
});

describe('collapseFrames', () => {
    const makeFrame = (
        kind: 'project' | 'vendor' | 'internal',
        name: string
    ): FrameInfo => ({
        file: `/test/${name}.ts`,
        line: 1,
        column: 1,
        functionName: name,
        isAsync: false,
        kind,
    });

    it('removes internal frames', () => {
        const frames: FrameInfo[] = [
            makeFrame('project', 'a'),
            makeFrame('internal', 'b'),
            makeFrame('project', 'c'),
        ];

        const result = collapseFrames(frames, {
            maxProjectFrames: 10,
            showVendor: false,
        });

        expect(result.filter((f) => !isCollapsedMarker(f))).toHaveLength(2);
    });

    it('collapses vendor frames when showVendor is false', () => {
        const frames: FrameInfo[] = [
            makeFrame('project', 'a'),
            makeFrame('vendor', 'b'),
            makeFrame('vendor', 'c'),
            makeFrame('vendor', 'd'),
            makeFrame('project', 'e'),
        ];

        const result = collapseFrames(frames, {
            maxProjectFrames: 10,
            showVendor: false,
        });

        // Should have: project 'a', collapsed marker (3), project 'e'
        expect(result).toHaveLength(3);

        const marker = result[1];
        expect(isCollapsedMarker(marker)).toBe(true);
        if (isCollapsedMarker(marker)) {
            expect(marker.count).toBe(3);
            expect(marker.kind).toBe('vendor');
        }
    });

    it('shows vendor frames when showVendor is true', () => {
        const frames: FrameInfo[] = [
            makeFrame('project', 'a'),
            makeFrame('vendor', 'b'),
            makeFrame('vendor', 'c'),
            makeFrame('project', 'd'),
        ];

        const result = collapseFrames(frames, {
            maxProjectFrames: 10,
            showVendor: true,
        });

        // Should have all 4 frames
        expect(result.filter((f) => !isCollapsedMarker(f))).toHaveLength(4);
    });

    it('limits project frames and collapses extras', () => {
        const frames: FrameInfo[] = [
            makeFrame('project', 'a'),
            makeFrame('project', 'b'),
            makeFrame('project', 'c'),
            makeFrame('project', 'd'),
            makeFrame('project', 'e'),
        ];

        const result = collapseFrames(frames, {
            maxProjectFrames: 3,
            showVendor: false,
        });

        // Should have: 3 project frames + 1 collapsed marker
        expect(result).toHaveLength(4);

        const marker = result[3];
        expect(isCollapsedMarker(marker)).toBe(true);
        if (isCollapsedMarker(marker)) {
            expect(marker.count).toBe(2);
            expect(marker.kind).toBe('project');
        }
    });

    it('handles empty frames array', () => {
        const result = collapseFrames([], {
            maxProjectFrames: 10,
            showVendor: false,
        });
        expect(result).toEqual([]);
    });

    it('handles frames with only internal frames', () => {
        const frames: FrameInfo[] = [
            makeFrame('internal', 'a'),
            makeFrame('internal', 'b'),
        ];

        const result = collapseFrames(frames, {
            maxProjectFrames: 10,
            showVendor: false,
        });
        expect(result).toEqual([]);
    });
});
