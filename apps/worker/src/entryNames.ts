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
 * Compared case-insensitively: macOS and Windows extract `IMG_0001.JPG` and
 * `img_0001.jpg` onto the same file.
 *
 * Names a file already has (`entryName`, resolved by an earlier partition) are
 * kept and claimed first, so a new name can never land on one of them. Called
 * once per request at the partition, that's every name in every part; called
 * by a zip build on items partitioned before names were stored, it's the
 * names within that one chunk, which is all those ever had.
 */
export function resolveEntryNames(files: readonly NameSource[]): string[] {
    const taken = new Set<string>();
    for (const file of files) {
        if (file.entryName !== null) taken.add(file.entryName.toLowerCase());
    }
    return files.map(
        (file) => file.entryName ?? claim(toEntryPath(file), taken)
    );
}

interface EntryPath {
    folder: string;
    name: string;
}

/**
 * Where a file goes inside the zip, made safe to extract.
 *
 * `.` and `..` segments are dropped and leading dots stripped, so no entry
 * can climb out of the extraction folder or hide itself; separators inside
 * the name itself are flattened, since a name is one path segment.
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

function cleanSegment(segment: string): string {
    return segment.replace(/^\.+/, '').trim();
}

function claim({ folder, name }: EntryPath, taken: Set<string>): string {
    const at = (fileName: string) =>
        folder ? `${folder}/${fileName}` : fileName;

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; ; n++) {
        const candidate = at(n === 1 ? name : `${stem} (${n})${extension}`);
        if (!taken.has(candidate.toLowerCase())) {
            taken.add(candidate.toLowerCase());
            return candidate;
        }
    }
}
