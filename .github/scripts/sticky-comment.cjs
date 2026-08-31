/**
 * Both PR-comment jobs in pr-check.yml need the same protocol: find our own
 * comment by an invisible marker, then update it, create it, or delete it once
 * the condition that produced it no longer holds. Written once here so the two
 * can't drift — and so the pagination below is not something each caller has
 * to remember.
 *
 * CommonJS on purpose: actions/github-script runs on Node 20, whose `require`
 * cannot load an ESM module. The repo's other scripts are `.mjs`.
 *
 * Returns what it did ('created' | 'updated' | 'deleted' | 'absent') so the
 * caller can log it.
 */
module.exports = async function upsertStickyComment({
    github,
    context,
    marker,
    body,
}) {
    const target = {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
    };

    // Paginated: listComments returns 30 by default, so on a PR with more
    // discussion than that an unpaginated find misses our own comment and
    // posts a duplicate on every re-run.
    const comments = await github.paginate(
        github.rest.issues.listComments,
        target
    );
    const existing = comments.find((c) => c.body.includes(marker));

    if (!body) {
        if (!existing) return 'absent';
        await github.rest.issues.deleteComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: existing.id,
        });
        return 'deleted';
    }

    const withMarker = `${marker}\n${body}`;

    if (existing) {
        await github.rest.issues.updateComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: existing.id,
            body: withMarker,
        });
        return 'updated';
    }

    await github.rest.issues.createComment({ ...target, body: withMarker });
    return 'created';
};
