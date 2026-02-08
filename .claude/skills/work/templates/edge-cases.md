# Edge Cases

Reference for handling unusual situations during the `/work` workflow.

## Issue Not Ready

If the selected issue doesn't have the `ready` label:

- Inform the user and suggest running `/groom` first
- Offer to choose a different issue
- Offer to work on it anyway (not recommended)

## Lint or Type Errors

If `pnpm lint` or `pnpm typecheck` fail during implementation:

1. Show the error output
2. Ask user:
    - **Fix now**: Attempt to resolve the errors
    - **Continue anyway**: Proceed (errors must be fixed before merge)
    - **Abort**: Stop implementation, keep changes uncommitted

## Tests Failing

If tests fail during implementation:

1. Show the failure details
2. Ask user:
    - **Fix now**: Attempt to fix the failing tests
    - **Skip tests**: Continue without fixing (add note to PR)
    - **Abort**: Stop implementation, keep changes uncommitted

## Scope Creep Detected

If implementation reveals work beyond the issue scope:

1. Note the additional work needed
2. Ask user:
    - **Create follow-up issue**: Draft a new issue for the extra work
    - **Include anyway**: Expand scope (update issue if needed)
    - **Ignore**: Stay strictly within original scope

## Branch Already Exists

If the feature branch already exists:

1. Check if it's local or remote: `git branch -r | grep "$BRANCH_NAME"`
2. Ask user:
    - **Resume work**: Check out the existing branch
    - **Rebase and continue**: Check out and rebase onto latest `origin/main`
    - **Use different name**: Create a new branch with a different name

## Resuming Previous Work

If you need to continue work on an existing branch:

1. Check current branch state:

    ```bash
    git branch --show-current
    git log --oneline -5
    git status
    ```

2. If on a feature branch, confirm it's the right one. If not, list branches and ask.

3. Light-touch research (do NOT skip):
    - Re-fetch the issue to confirm acceptance criteria are current
    - Review what's already implemented vs what remains
    - Check for changes on main since work started:
        ```bash
        git fetch origin main
        git log HEAD..origin/main --oneline | head -10
        ```

4. Present summary of done vs remaining work
5. Ask user what to focus on next
6. Continue from Step 5 (Implementation) in the main workflow
