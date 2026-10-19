import type { RetrievalRequestFile } from '@nexus/db/repo/retrievalRequests';

type NameSource = Pick<RetrievalRequestFile, 'name' | 'subpath' | 'entryName'>;

/**
 * Each file's path inside a restore's zips, unique across all of them (#452).
 *
 * The folder a file was uploaded from comes along (#405): a shoot restores as
 * `104CANON/IMG_0001.JPG` and `105CANON/IMG_0001.JPG`, the layout the
 * photographer uploaded, rather than one flat pile.
 *
 * Unique because a zip with two entries at one path silently loses one of
 * them on extraction, and so do two parts extracted into the same folder with
 * "Replace all". Burst siblings from two shoots are routinely both
 * `_MG_4501.CR2`, and camera folders restart their numbering on every card.
 * A clash gets ` (2)`, ` (3)`, ... on the file's own name, what every desktop
 * file manager does, so it reads as intended rather than as corruption.
 *
 * What counts as a clash is what the user's disk would merge: paths compared
 * case-insensitively and in one Unicode normalization, as macOS and Windows
 * extract them, and a file never at the path of a folder some other file sits
 * in (a top-level `RAW` beside `RAW/IMG.CR2` would cost the whole folder).
 *
 * Names a file already has (`entryName`, resolved by an earlier partition) are
 * kept and claimed first, so a new name can never land on one of them. Called
 * once per request at the partition, that's every name in every part; called
 * by a zip build on items partitioned before names were stored, it's the
 * names within that one chunk, which is all those ever had.
 */
export function resolveEntryNames(files: readonly NameSource[]): string[] {
    const paths = files.map((file) =>
        file.entryName === null ? toEntryPath(file) : null
    );

    const folders = new Set<string>();
    const taken = new Set<string>();
    files.forEach((file, index) => {
        const folder =
            file.entryName !== null
                ? file.entryName.split('/').slice(0, -1).join('/')
                : paths[index]!.folder;
        for (const prefix of folderPrefixes(folder)) folders.add(keyOf(prefix));
        if (file.entryName !== null) taken.add(keyOf(file.entryName));
    });

    return files.map(
        (file, index) => file.entryName ?? claim(paths[index]!, taken, folders)
    );
}

interface EntryPath {
    folder: string;
    name: string;
}

/**
 * Where a file goes inside the zip, made safe to extract — and safe to write:
 * yazl refuses a path with a `..` segment or one that looks absolute
 * (`/x`, `C:x`), and a refused name is stored, so it would fail that part's
 * build on every retry. `.`, `..` and blank segments are dropped and leading
 * dots stripped, so no entry can climb out of the extraction folder or hide
 * itself; separators inside the name are flattened, since a name is one
 * segment.
 */
function toEntryPath(file: NameSource): EntryPath {
    const folder = (file.subpath ?? '')
        .split(/[/\\]+/)
        .map(cleanSegment)
        .filter(Boolean)
        .join('/');
    const name = cleanSegment(file.name.replace(/[/\\]+/g, '_')) || 'file';
    return { folder, name };
}

/**
 * `:` and control characters become `_`: Windows can't extract either, and
 * a first segment like `B:W prints` (Finder's "B/W prints") reads as a drive.
 */
function cleanSegment(segment: string): string {
    return segment
        .replace(/[:\p{Cc}]/gu, '_')
        .replace(/^[\s.]+/, '')
        .trim();
}

function folderPrefixes(folder: string): string[] {
    const segments = folder ? folder.split('/') : [];
    return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

function keyOf(path: string): string {
    return path.normalize('NFC').toLowerCase();
}

function claim(
    { folder, name }: EntryPath,
    taken: Set<string>,
    folders: Set<string>
): string {
    const at = (fileName: string) =>
        folder ? `${folder}/${fileName}` : fileName;

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; ; n++) {
        const candidate = at(n === 1 ? name : `${stem} (${n})${extension}`);
        const key = keyOf(candidate);
        if (!taken.has(key) && !folders.has(key)) {
            taken.add(key);
            return candidate;
        }
    }
}
