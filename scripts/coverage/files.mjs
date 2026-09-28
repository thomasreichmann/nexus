/**
 * Which files a per-change tool looks at: the change vs main, plus or
 * instead of paths the caller names. Shared by `pnpm cov:touched` (#493) and
 * the mutation step (#494).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { root } from './shared.mjs';

const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const lines = (out) => (out ? out.split('\n') : []);

/** Every tracked or untracked-but-not-ignored file, repo-relative. */
export function repoFiles() {
    return lines(git('ls-files', '--cached', '--others', '--exclude-standard'));
}

/**
 * `origin/main` when it exists (worktrees rarely update a local `main`),
 * else `main`.
 */
export function defaultBaseRef() {
    try {
        git('rev-parse', '--verify', '--quiet', 'origin/main');
        return 'origin/main';
    } catch {
        return 'main';
    }
}

/**
 * Files changed vs the merge base with `baseRef`: committed, staged,
 * unstaged and untracked. Deleted files are left out.
 */
export function changedFiles(baseRef) {
    const base = git('merge-base', baseRef, 'HEAD');
    const changed = lines(
        git('diff', '--name-only', '--diff-filter=d', base, '--')
    );
    const untracked = lines(git('ls-files', '--others', '--exclude-standard'));
    return { base, files: [...new Set([...changed, ...untracked])] };
}

// Paths are tried against the caller's cwd, the repo root, then each
// workspace, so `lib/upload/parts.ts` finds apps/web/lib/upload/parts.ts.
const WORKSPACE_DIRS = ['apps/web', 'packages/db', 'apps/worker'];

/**
 * Expand path arguments (files, directories or globs) to repo-relative
 * files. Returns the files plus any argument that matched nothing.
 */
export function expandPaths(args, allFiles = repoFiles()) {
    const cwd = process.env.INIT_CWD ?? process.cwd();
    const found = new Set();
    const unmatched = [];
    for (const arg of args) {
        const hits = /[*?]/.test(arg)
            ? matchGlob(arg, allFiles, cwd)
            : matchPath(arg, allFiles, cwd);
        if (hits.length === 0) unmatched.push(arg);
        for (const f of hits) found.add(f);
    }
    return { files: [...found], unmatched };
}

function candidates(arg, cwd) {
    if (isAbsolute(arg)) return [relative(root, arg)];
    return [
        relative(root, resolve(cwd, arg)),
        arg,
        ...WORKSPACE_DIRS.map((d) => join(d, arg)),
    ];
}

function matchPath(arg, allFiles, cwd) {
    for (const rel of candidates(arg, cwd)) {
        const abs = join(root, rel);
        if (!existsSync(abs)) continue;
        if (!statSync(abs).isDirectory()) return [rel];
        const prefix = rel.replace(/\/?$/, '/');
        return allFiles.filter((f) => f.startsWith(prefix));
    }
    return [];
}

function matchGlob(arg, allFiles, cwd) {
    for (const pattern of candidates(arg, cwd)) {
        const re = globToRegExp(pattern);
        const hits = allFiles.filter((f) => re.test(f));
        if (hits.length > 0) return hits;
    }
    return [];
}

function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const ch = glob[i];
        if (ch === '*' && glob[i + 1] === '*') {
            // `**/` matches zero or more directories.
            re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
            i += glob[i + 2] === '/' ? 2 : 1;
        } else if (ch === '*') re += '[^/]*';
        else if (ch === '?') re += '[^/]';
        else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}

/** Commits touching each file in the last `days` days. */
export function churn(days) {
    const out = git(
        'log',
        `--since=${days} days ago`,
        '--no-merges',
        '--format=',
        '--name-only'
    );
    const counts = new Map();
    for (const f of lines(out)) {
        if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return counts;
}
