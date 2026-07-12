/**
 * Minimal fuzzy matcher for the command palette. Matches the query as a
 * character subsequence of the text (case-insensitive) and scores alignments
 * so tighter, earlier, boundary-aligned hits rank first. No third-party
 * search library by design — see #97.
 */

export interface FuzzyMatch {
    score: number;
    /** Indices into `text` of the matched characters, for highlighting */
    indices: number[];
}

const CONSECUTIVE_BONUS = 8;
const BOUNDARY_BONUS = 10;
const START_BONUS = 12;
const GAP_PENALTY = 1;

/** Whether text[index] starts a new "word" for boundary scoring */
function isBoundary(text: string, index: number): boolean {
    if (index === 0) return true;

    const prev = text[index - 1];
    if (prev === '.' || prev === '-' || prev === '_' || prev === ' ') {
        return true;
    }

    // camelCase boundary
    const current = text[index];
    return (
        current === current.toUpperCase() &&
        current !== current.toLowerCase() &&
        prev === prev.toLowerCase()
    );
}

/**
 * Match `query` as a subsequence of `text`, picking the highest-scoring
 * alignment (a greedy first-occurrence match would rank "list" in
 * "labels.instant" above the contiguous "list" in "files.list").
 * Returns null when the query doesn't match; an empty query matches
 * everything with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
    if (!query) return { score: 0, indices: [] };

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    const queryLength = query.length;
    const textLength = text.length;
    if (queryLength > textLength) return null;

    // scores[i][j]: best score matching query[0..i] with query[i] at text[j]
    const scores: number[][] = [];
    const parents: number[][] = [];

    for (let i = 0; i < queryLength; i++) {
        scores.push(new Array<number>(textLength).fill(-Infinity));
        parents.push(new Array<number>(textLength).fill(-1));

        for (let j = i; j < textLength; j++) {
            if (textLower[j] !== queryLower[i]) continue;

            const bonus =
                j === 0
                    ? START_BONUS
                    : isBoundary(text, j)
                      ? BOUNDARY_BONUS
                      : 0;

            if (i === 0) {
                scores[0][j] = bonus - j * GAP_PENALTY;
                continue;
            }

            for (let k = i - 1; k < j; k++) {
                const prevScore = scores[i - 1][k];
                if (prevScore === -Infinity) continue;

                const candidate =
                    prevScore +
                    bonus +
                    (j === k + 1 ? CONSECUTIVE_BONUS : 0) -
                    (j - k - 1) * GAP_PENALTY;

                if (candidate > scores[i][j]) {
                    scores[i][j] = candidate;
                    parents[i][j] = k;
                }
            }
        }
    }

    // Best alignment ends wherever the last query char scored highest
    let bestEnd = -1;
    let bestScore = -Infinity;
    for (let j = 0; j < textLength; j++) {
        if (scores[queryLength - 1][j] > bestScore) {
            bestScore = scores[queryLength - 1][j];
            bestEnd = j;
        }
    }
    if (bestEnd === -1) return null;

    const indices = new Array<number>(queryLength);
    let j = bestEnd;
    for (let i = queryLength - 1; i >= 0; i--) {
        indices[i] = j;
        j = parents[i][j];
    }

    return { score: bestScore, indices };
}

export interface FuzzyResult<T> {
    item: T;
    match: FuzzyMatch;
}

/**
 * Filter and rank items by fuzzy match against `query`. Preserves input
 * order for equal scores (stable sort).
 */
export function fuzzyFilter<T>(
    items: T[],
    query: string,
    getText: (item: T) => string
): FuzzyResult<T>[] {
    const results: FuzzyResult<T>[] = [];

    for (const item of items) {
        const match = fuzzyMatch(query, getText(item));
        if (match) {
            results.push({ item, match });
        }
    }

    return results.sort((a, b) => b.match.score - a.match.score);
}
