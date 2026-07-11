/**
 * URL of the GitHub Actions run executing the current process, so check
 * scripts can embed a link in their alert context. Undefined outside CI.
 */
export function getWorkflowRunUrl(): string | undefined {
    const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
    if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) {
        return undefined;
    }
    return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}
