---
allowed-tools: Bash, Task, AskUserQuestion, Read, Grep, Glob, Edit, Write
description: Work on a ready GitHub issue (plan or implement)
argument-hint: [issue-number] (optional)
---

# Work on Issue Command

This command helps you work on issues labeled `ready` - either by creating an implementation plan or by fully implementing the solution.

## Prerequisites

Issues must have the `ready` label, meaning they've been groomed and have:

- Clear Description
- Acceptance Criteria (testable checkboxes)
- Out of Scope section

## Parallelization with Git Worktrees

This command uses **git worktrees** to enable parallel work on multiple issues. Each issue gets its own working directory with an isolated branch, so multiple `/work` sessions can run simultaneously without conflicts.

**Worktree location:** `../nexus-worktrees/<branch-name>/`

Benefits:

- No branch switching - main repo stays on `main`
- Multiple issues can be worked on in parallel
- Each worktree is fully isolated
- Worktrees share the same `.git` history (no re-cloning)

## Instructions

### Step 1: Select Issue

If an issue number was provided as argument `$ARGUMENTS`:

- Verify it has the `ready` label
- If not, inform the user and suggest running `/groom` first
- Skip to Step 2 with that issue number

Otherwise:

1. Fetch issues with `ready` label (excluding in-progress):

    ```bash
    gh issue list --label ready --json number,title,labels,milestone --limit 20 | \
      jq '[.[] | select(.labels | map(.name) | index("in-progress") | not)]'
    ```

2. If no issues found, inform the user and exit.

3. Present issue selection using AskUserQuestion:
    - Show available issues with their titles
    - Include milestone info if present

### Step 2: Understand the Issue

1. **Fetch full issue details:**

    ```bash
    gh issue view <number> --json number,title,body,labels,milestone
    ```

2. **Parse the issue structure:**
    - Description: What needs to be done and why
    - Acceptance Criteria: The definition of done
    - Out of Scope: What to explicitly avoid

3. **Present a summary** to the user showing you understand the requirements

### Step 3: Choose Work Mode

Ask user using AskUserQuestion with these options:

- **Plan only** (Recommended): Research codebase, create implementation plan, get approval before any code changes
- **Full implementation**: Research, implement, test, commit, and create PR in one flow
- **Resume**: Continue from an existing branch (ask for branch name)

### Step 4: Research Phase

This phase is REQUIRED for both modes.

1. **Read project conventions:**

    ```bash
    # Read conventions for naming, structure, patterns
    ```

    Use Read tool on `docs/ai/conventions.md`

2. **Explore the codebase** using Task tool with `subagent_type: Explore`:
    - Find files related to the feature area
    - Understand existing patterns and conventions
    - Identify files that will need changes
    - Look for similar implementations to follow

3. **Identify the approach:**
    - What files need to be created or modified?
    - What patterns should be followed?
    - Are there any technical decisions to make?
    - What order should changes be made in?

#### Exploration Subagent Prompt Template

When spawning a Task agent for codebase exploration, use this prompt:

```
Research the nexus codebase to inform implementation of issue #<number>: <title>

You should:
1. Find files related to the feature area
2. Identify existing patterns and conventions
3. Find similar implementations to follow
4. List files that will likely need changes

Return findings in this format:

---
FEATURE AREA: <description>

RELATED FILES:
- <file path>: <purpose>

PATTERNS TO FOLLOW:
- <pattern>: <where used, example file>

SIMILAR IMPLEMENTATIONS:
- <file>: <what it does, why relevant>

FILES LIKELY TO CHANGE:
- <file>: <what changes needed>

TECHNICAL CONSIDERATIONS:
- <any architectural decisions or trade-offs>
---
```

### Step 5A: Plan Only Mode

If user selected "Plan only":

1. **Create implementation plan** covering:
    - Files to modify/create (in order)
    - Key changes for each file
    - Technical approach and patterns to follow
    - Testing strategy
    - Potential risks or considerations

2. **Present plan to user** and ask for approval using AskUserQuestion:
    - **Approve and implement**: Proceed to implementation
    - **Approve plan only**: Save plan, stop here (user will implement later)
    - **Request changes**: Revise the plan based on feedback

3. **If "Approve plan only":**
    - Optionally add plan as a comment on the issue
    - Mark issue with `in-progress` label
    - Exit with summary

4. **If "Approve and implement":**
    - Continue to Step 6

### Step 5B: Full Implementation Mode

If user selected "Full implementation":

- Research phase (Step 4) is still REQUIRED - do not skip it
- Unlike Plan Only mode, do NOT present a detailed plan for approval
- Use the approach identified during research to guide implementation
- Continue directly to Step 6 (Setup Branch)

### Step 5C: Resume Mode

If user selected "Resume":

1. List existing worktrees to help user choose:

    ```bash
    git worktree list
    ```

2. Ask for branch name if not provided

3. Locate and change to the worktree directory:

    ```bash
    WORKTREE_PATH="../nexus-worktrees/<branch-name>"
    cd "$WORKTREE_PATH"
    ```

    If worktree doesn't exist, offer to create it from the existing remote branch.

4. Review current state:

    ```bash
    git status                  # Uncommitted changes
    git log --oneline -5        # Recent commits
    git diff main..HEAD         # All changes since main
    ```

5. **Light-touch research** (do NOT skip entirely):
    - Re-fetch the issue to confirm acceptance criteria are still current
    - Review what's already implemented vs what remains
    - Check if any relevant code has changed on `main` since work started:

    ```bash
    git log main --oneline -5    # Recent changes on main
    ```

6. Present a summary of what's been done and what remains
7. Ask user what to focus on next
8. Continue to Step 7 (Implementation) - skip full research but stay informed

### Step 6: Setup Worktree

1. **Ensure main repo is clean** (worktree creation requires no conflicts):

    ```bash
    git status
    ```

    If there are uncommitted changes in main repo, ask user how to proceed.

2. **Ensure worktrees directory exists:**

    ```bash
    mkdir -p ../nexus-worktrees
    ```

3. **Create feature branch in a new worktree:**

    Branch naming convention: `<type>/<issue-number>-<short-description>`
    - Types: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`
    - Example: `feat/42-user-authentication`

    ```bash
    BRANCH_NAME="<type>/<issue-number>-<short-description>"
    WORKTREE_PATH="../nexus-worktrees/$BRANCH_NAME"
    git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"
    ```

    If worktree creation fails (branch exists or path conflict):
    - Show the error to the user
    - If branch exists on remote, offer to check it out: `git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"`
    - Otherwise ask for an alternative branch name

4. **Change to the worktree directory:**

    ```bash
    cd "$WORKTREE_PATH"
    ```

    **IMPORTANT:** All subsequent Bash commands run in this worktree, not the main repo.

    **IMPORTANT:** When using Read, Edit, Write, Grep, or Glob tools, you MUST use absolute paths. These tools reset their working directory between calls. Use paths like:
    - `../nexus-worktrees/<branch-name>/apps/web/src/file.ts`
    - Or the full absolute path starting with `/Users/...`

    Do NOT use relative paths like `./src/file.ts` - they will resolve to the wrong location.

5. **Install dependencies** (worktree has separate node_modules):

    ```bash
    pnpm install
    ```

6. **Mark issue as in progress:**

    ```bash
    gh issue edit <number> --add-label in-progress
    ```

### Step 7: Implementation

1. **Make changes** following the plan:
    - Edit existing files using Edit tool
    - Create new files using Write tool
    - Follow patterns identified in research phase
    - Keep changes focused on acceptance criteria

2. **Run checks frequently:**

    ```bash
    pnpm typecheck    # After TypeScript changes
    pnpm lint         # After any code changes
    ```

3. **Run tests** after logic changes:

    ```bash
    pnpm test         # Full test suite
    ```

    If tests fail:
    1. Show the failure output
    2. Ask user using AskUserQuestion:
        - **Fix now**: Attempt to fix the failing tests
        - **Continue anyway**: Proceed (note in PR that tests need review)
        - **Abort**: Stop implementation, keep changes uncommitted

4. **For UI changes**, run smoke tests:

    ```bash
    pnpm -F web test:e2e:smoke
    ```

5. **For database schema changes**, run migrations:

    ```bash
    pnpm -F web db:generate   # Generate migration from schema changes
    pnpm -F web db:migrate    # Apply pending migrations
    ```

    If migrations fail, show the error and ask user how to proceed.

6. **If implementation reveals issues:**
    - Scope creep: Note it, stay focused on acceptance criteria
    - Blockers: Ask user how to proceed
    - New issues discovered: Offer to create follow-up issues

### Step 8: Verify Acceptance Criteria

Go through each acceptance criterion from the issue:

1. **Check each item** is satisfied
2. **Run relevant tests** to verify
3. **If any criterion is not met:**
    - Ask user if it should be addressed now
    - Or noted for follow-up

### Step 9: Commit Changes

1. **Review all changes:**

    ```bash
    git status
    git diff
    ```

2. **Stage relevant files** (avoid staging unrelated changes)

3. **Create commit** with message referencing the issue:

    ```bash
    git commit -m "<type>: <description> (#<issue-number>)"
    ```

    Examples:
    - `feat: add user authentication flow (#42)`
    - `fix: resolve file upload validation (#38)`

4. **Push branch:**

    ```bash
    git push -u origin <branch-name>
    ```

### Step 10: Create Pull Request

1. **Create PR** using gh CLI:

    ```bash
    gh pr create --title "<title>" --body "$(cat <<'EOF'
    ## Summary
    <Brief description of changes>

    Closes #<issue-number>

    ## Changes
    - <Change 1>
    - <Change 2>

    ## Test Plan
    - [ ] <How to verify this works>
    EOF
    )"
    ```

2. **Link PR to issue** (the `Closes #X` syntax handles this)

3. **Remove in-progress label:**

    ```bash
    gh issue edit <number> --remove-label in-progress
    ```

### Step 11: Finalize and Summary

1. **Update changelog** for significant changes:

    Add an entry to `docs/ai/changelog.md` summarizing what changed and why.

2. **Ask about worktree cleanup** using AskUserQuestion:
    - **Keep worktree**: Leave it for potential follow-up work
    - **Remove worktree**: Clean up now (branch remains on remote)

    If removing:

    ```bash
    cd <original-repo-path>
    git worktree remove "$WORKTREE_PATH"
    ```

3. **Provide a summary** including:
    - Issue worked on (number and title)
    - Branch name
    - Worktree path (if kept)
    - PR link
    - Key changes made
    - Files modified
    - Any follow-up items identified

## Handling Edge Cases

### Issue Not Ready

If the selected issue doesn't have `ready` label:

```
This issue hasn't been groomed yet. Would you like to:
1. Run /groom on this issue first
2. Choose a different issue
3. Work on it anyway (not recommended)
```

### Lint or Type Errors

If `pnpm lint` or `pnpm typecheck` fail during implementation:

1. Show the error output
2. Ask user:
    - **Fix now**: Attempt to resolve the errors
    - **Continue anyway**: Proceed (errors will need to be fixed before merge)
    - **Abort**: Stop implementation, keep changes uncommitted for user to fix

### Tests Failing

If tests fail during implementation:

1. Show the failure details
2. Ask user:
    - **Fix now**: Attempt to fix the failing tests
    - **Skip tests**: Continue without fixing (add note to PR)
    - **Abort**: Stop implementation, keep changes uncommitted

### Scope Creep Detected

If implementation reveals work beyond the issue scope:

1. Note the additional work needed
2. Ask user:
    - **Create follow-up issue**: Draft a new issue for the extra work
    - **Include anyway**: Expand scope (update issue if needed)
    - **Ignore**: Stay strictly within original scope

### Worktree Issues

If worktree creation or management fails:

1. **Branch already checked out elsewhere:**

    ```bash
    git worktree list  # Find where it's checked out
    ```

    Ask user to either remove the other worktree or use Resume mode.

2. **Stale worktree references:**

    ```bash
    git worktree prune  # Clean up stale entries
    ```

3. **Worktree directory already exists:**
    - Check if it's a valid worktree for this branch
    - If so, offer to resume instead
    - If not, ask user if it's safe to remove

## Managing Worktrees

Useful commands for worktree management (can be run from main repo):

```bash
git worktree list              # List all worktrees
git worktree remove <path>     # Remove a worktree (keeps branch)
git worktree prune             # Clean up stale worktree references
git branch -d <branch>         # Delete branch after worktree removed
```

To clean up after PR is merged:

```bash
git worktree remove ../nexus-worktrees/<branch-name>
git branch -d <branch-name>
```

## Notes

- ALWAYS read the issue thoroughly before starting
- ALWAYS research the codebase to understand existing patterns
- Follow the conventions in `docs/ai/conventions.md`
- Update `docs/ai/changelog.md` after significant changes
- Keep commits focused and atomic
- Reference the issue number in commits and PR
- Don't skip the planning phase unless resuming existing work
- All implementation happens in the worktree, not the main repo
- Run `pnpm install` in new worktrees before running commands
- Multiple `/work` sessions can run in parallel on different issues
