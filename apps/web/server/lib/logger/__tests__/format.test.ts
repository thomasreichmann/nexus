import { describe, expect, it } from 'vitest';
import { formatStackTrace } from '../patches/format';
import type { StackTraceConfig } from '../config';

function makeCallSite(
    file: string,
    line: number,
    column: number,
    functionName: string | null = null
): NodeJS.CallSite {
    return {
        getFileName: () => file,
        getScriptNameOrSourceURL: () => file,
        getLineNumber: () => line,
        getColumnNumber: () => column,
        getFunctionName: () => functionName,
        getMethodName: () => null,
        isAsync: () => false,
        getTypeName: () => null,
        getThis: () => undefined,
        getFunction: () => undefined,
        getEvalOrigin: () => undefined,
        isToplevel: () => false,
        isEval: () => false,
        isNative: () => false,
        isConstructor: () => false,
        isPromiseAll: () => false,
        getPromiseIndex: () => null,
    } as NodeJS.CallSite;
}

function makeConfig(
    overrides: Partial<StackTraceConfig> = {}
): StackTraceConfig {
    return {
        enabled: true,
        projectRoot: '/test/project',
        colorEnabled: false,
        maxProjectFrames: 2,
        showVendor: false,
        showMarkers: false,
        codeFrameContext: 0,
        ...overrides,
    };
}

describe('formatStackTrace showMarkers', () => {
    // Build frames that will produce a collapsed vendor marker:
    // 1 project frame + 3 vendor frames → triggers vendor collapse
    const frames = [
        makeCallSite('/test/project/src/app.ts', 10, 1, 'handler'),
        makeCallSite(
            '/test/project/node_modules/lib/index.js',
            5,
            1,
            'vendorA'
        ),
        makeCallSite('/test/project/node_modules/lib/util.js', 8, 1, 'vendorB'),
        makeCallSite(
            '/test/project/node_modules/lib/core.js',
            12,
            1,
            'vendorC'
        ),
    ];
    const error = new Error('test');

    it('hides collapsed markers when showMarkers is false', () => {
        const output = formatStackTrace(
            error,
            frames,
            makeConfig({ showMarkers: false })
        );

        expect(output).not.toContain('frames hidden');
        expect(output).not.toContain('more project frames');
        // Should still contain the project frame
        expect(output).toContain('handler');
    });

    it('shows collapsed markers when showMarkers is true', () => {
        const output = formatStackTrace(
            error,
            frames,
            makeConfig({ showMarkers: true })
        );

        expect(output).toContain('3 frames hidden');
    });

    it('shows project collapse markers when showMarkers is true', () => {
        const projectFrames = [
            makeCallSite('/test/project/src/a.ts', 1, 1, 'fnA'),
            makeCallSite('/test/project/src/b.ts', 2, 1, 'fnB'),
            makeCallSite('/test/project/src/c.ts', 3, 1, 'fnC'),
            makeCallSite('/test/project/src/d.ts', 4, 1, 'fnD'),
        ];

        const output = formatStackTrace(
            error,
            projectFrames,
            makeConfig({ showMarkers: true, maxProjectFrames: 2 })
        );

        expect(output).toContain('2 more project frames');
    });

    it('hides project collapse markers when showMarkers is false', () => {
        const projectFrames = [
            makeCallSite('/test/project/src/a.ts', 1, 1, 'fnA'),
            makeCallSite('/test/project/src/b.ts', 2, 1, 'fnB'),
            makeCallSite('/test/project/src/c.ts', 3, 1, 'fnC'),
            makeCallSite('/test/project/src/d.ts', 4, 1, 'fnD'),
        ];

        const output = formatStackTrace(
            error,
            projectFrames,
            makeConfig({ showMarkers: false, maxProjectFrames: 2 })
        );

        expect(output).not.toContain('more project frames');
        // Should still contain the kept frames
        expect(output).toContain('fnA');
        expect(output).toContain('fnB');
    });
});
