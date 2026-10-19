import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { mapCallSite, mapPosition } from '../patches/mapping';

// Split so Vite doesn't read the fixtures' directives as this file's own.
const SOURCE_MAPPING_URL = '//# source' + 'MappingURL=';

/** The original module. The type alias vanishes on compile, so lines shift. */
const ORIGINAL = [
    'interface Payload {',
    '    id: string;',
    '}',
    '',
    'export function fail(payload: Payload): never {',
    '    const error = new Error(`bad ${payload.id}`);',
    '    type Unused = {',
    '        reason: string;',
    '    };',
    '    throw error;',
    '}',
    '',
].join('\n');

/** What `tsc` emits for ORIGINAL (CommonJS, ES2022, sourceMap on). */
const COMPILED = [
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    'exports.fail = fail;',
    'function fail(payload) {',
    '    const error = new Error(`bad ${payload.id}`);',
    '    throw error;',
    '}',
].join('\n');
const MAPPINGS =
    ';;AAIA,oBAMC;AAND,SAAgB,IAAI,CAAC,OAAgB;IACjC,MAAM,KAAK,GAAG,IAAI,KAAK,CAAC,OAAO,OAAO,CAAC,EAAE,EAAE,CAAC,CAAC;IAI7C,MAAM,KAAK,CAAC;AAChB,CAAC';

// Where V8 puts `new Error` in COMPILED, and where that is in ORIGINAL
// (Node's own 1-based SourceMap.findOrigin agrees). The generated line after
// it maps four original lines further on, so reading the wrong generated
// line gives a wrong answer rather than a lucky one.
const NEW_ERROR_IN_CHUNK = { line: 5, column: 19 };
const NEW_ERROR_IN_SOURCE = { line: 6, column: 19 };

const projectRoot = '/work/nexus/apps/web';
const MAPPED = {
    file: path.join(projectRoot, 'server/fail.ts'),
    ...NEW_ERROR_IN_SOURCE,
};

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mapping-test-'));
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

let buildCount = 0;
/**
 * A fresh directory: under `.next/server/chunks` by default, the only place
 * mapPosition maps. Fresh because it caches by file and position.
 */
function freshDir(...under: string[]): string {
    const dir = path.join(
        tempRoot,
        `build-${buildCount++}`,
        ...(under.length ? under : ['.next', 'server', 'chunks', 'ssr'])
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function sourceMapJson(source = '[project]/server/fail.ts'): string {
    return JSON.stringify({
        version: 3,
        file: 'chunk.js',
        sources: [source],
        sourcesContent: [ORIGINAL],
        names: [],
        mappings: MAPPINGS,
    });
}

/** Write COMPILED to `dir/name`, followed by these sourceMappingURL values. */
function writeChunk(dir: string, urls: string[], name = 'chunk.js'): string {
    const file = path.join(dir, name);
    const directives = urls.map((url) => SOURCE_MAPPING_URL + url);
    fs.writeFileSync(file, [COMPILED, ...directives].join('\n'));
    return file;
}

function writeMap(dir: string, name: string, json = sourceMapJson()): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, json);
    return file;
}

const inlineBase64 = (json = sourceMapJson()) =>
    `data:application/json;base64,${Buffer.from(json).toString('base64')}`;

const mapNewError = (chunk: string) =>
    mapPosition(
        chunk,
        NEW_ERROR_IN_CHUNK.line,
        NEW_ERROR_IN_CHUNK.column,
        projectRoot
    );

describe('mapPosition', () => {
    it.each<[string, (dir: string) => string]>([
        ['an inline base64 map', (dir) => writeChunk(dir, [inlineBase64()])],
        [
            'an inline URL-encoded map',
            (dir) =>
                writeChunk(dir, [
                    `data:application/json,${encodeURIComponent(sourceMapJson())}`,
                ]),
        ],
        [
            'an external map, by a path relative to the chunk',
            (dir) => {
                writeMap(dir, 'chunk.js.map');
                return writeChunk(dir, ['chunk.js.map']);
            },
        ],
        [
            'an external map, by absolute path',
            (dir) => writeChunk(dir, [writeMap(dir, 'chunk.js.map')]),
        ],
        [
            // How Turbopack names its chunks' maps.
            'an external map, by URL-encoded relative path',
            (dir) => {
                writeMap(dir, '[root-of-the-server]__0eaa._.js.map');
                return writeChunk(dir, [
                    '%5Broot-of-the-server%5D__0eaa._.js.map',
                ]);
            },
        ],
        [
            'the last of several sourceMappingURLs',
            (dir) => {
                writeMap(
                    dir,
                    'stale.js.map',
                    sourceMapJson('[project]/server/stale.ts')
                );
                writeMap(dir, 'chunk.js.map');
                return writeChunk(dir, ['stale.js.map', 'chunk.js.map']);
            },
        ],
    ])('maps a chunk position to the original through %s', (_form, write) => {
        const chunk = write(freshDir());

        expect(mapNewError(chunk)).toEqual(MAPPED);
    });

    it.each([
        ['[project]/server/fail.ts', path.join(projectRoot, 'server/fail.ts')],
        [
            'webpack:///work/nexus/apps/web/server/fail.ts',
            '/work/nexus/apps/web/server/fail.ts',
        ],
        [
            // Percent-encoded, so only a real URL decode gets the path back.
            pathToFileURL('/work/my nexus/apps/web/server/fail.ts').href,
            '/work/my nexus/apps/web/server/fail.ts',
        ],
        ['server/fail.ts', path.join(projectRoot, 'server/fail.ts')],
    ])('resolves the source %s to %s', (source, expected) => {
        const chunk = writeChunk(freshDir(), [
            inlineBase64(sourceMapJson(source)),
        ]);

        expect(mapNewError(chunk)?.file).toBe(expected);
    });

    // On COMPILED line 5, `new ` is one mapped segment (columns 19-22) and
    // `Error` the next (from 23). Each maps to where its segment starts.
    it.each([
        [22, 19],
        [23, 23],
    ])('maps chunk column %i to original column %i', (column, original) => {
        const chunk = writeChunk(freshDir(), [inlineBase64()]);

        expect(mapPosition(chunk, 5, column, projectRoot)).toMatchObject({
            line: 6,
            column: original,
        });
    });

    it('leaves a position before the chunk’s first mapping unmapped', () => {
        // Line 1 is tsc's "use strict" preamble, which no original line made.
        const chunk = writeChunk(freshDir(), [inlineBase64()]);

        expect(mapPosition(chunk, 1, 1, projectRoot)).toBeNull();
    });

    // Each path lacks exactly one of the three segments, so each pins one.
    it.each([
        ['.next', ['dist', 'server', 'chunks']],
        ['server', ['.next', 'static', 'chunks']],
        ['chunks', ['.next', 'server', 'app']],
    ])(
        'leaves a file outside a %s directory unmapped, even with a map',
        (_segment, under) => {
            const file = writeChunk(freshDir(...under), [inlineBase64()]);

            expect(mapNewError(file)).toBeNull();
        }
    );

    it('leaves a chunk without a source map unmapped', () => {
        const chunk = writeChunk(freshDir(), []);

        expect(mapNewError(chunk)).toBeNull();
    });
});

describe('mapCallSite', () => {
    // Loads the chunk for real and takes the call site V8 reports for the
    // throw, so the test uses V8's own line and column numbering.
    function callSiteOfThrow(chunk: string): NodeJS.CallSite {
        const { fail } = createRequire(import.meta.url)(chunk) as {
            fail: (payload: { id: string }) => never;
        };
        const savedPrepare = Error.prepareStackTrace;
        Error.prepareStackTrace = (_error, callSites) => callSites;
        try {
            fail({ id: 'x' });
        } catch (error) {
            return (error as { stack: NodeJS.CallSite[] }).stack[0];
        } finally {
            Error.prepareStackTrace = savedPrepare;
        }
        throw new Error('the fixture did not throw');
    }

    it('reports a thrown error at its original position', () => {
        const chunk = writeChunk(freshDir(), [inlineBase64()]);
        const callSite = callSiteOfThrow(chunk);

        const mapped = mapCallSite(callSite, projectRoot);

        // The fixture's constants are where V8 actually puts the throw.
        expect({
            line: callSite.getLineNumber(),
            column: callSite.getColumnNumber(),
        }).toEqual(NEW_ERROR_IN_CHUNK);
        expect({
            file: mapped.getFileName(),
            line: mapped.getLineNumber(),
            column: mapped.getColumnNumber(),
            functionName: mapped.getFunctionName(),
        }).toEqual({ ...MAPPED, functionName: 'fail' });
    });

    it('returns an unmappable call site unchanged', () => {
        const file = writeChunk(freshDir('dist'), [inlineBase64()]);
        const callSite = callSiteOfThrow(file);

        expect(mapCallSite(callSite, projectRoot)).toBe(callSite);
    });
});
