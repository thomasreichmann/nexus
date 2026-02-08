---
name: work
description: Work on a ready GitHub issue (implement, test, commit, PR)
argument-hint: [issue-number] (optional)
allowed-tools: Bash, Task, AskUserQuestion, Read, Grep, Glob, Edit, Write
disable-model-invocation: true
agent: work-agent
---

# Work on Issue Command

Implement a `ready`-labeled GitHub issue: research, implement, review, commit, and open a PR.

## Dynamic Context

**Current git status:**
!`git status --short 2>/dev/null || echo "Not in a git repo"`

**Current branch:**
!`git branch --show-current 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "Unknown"`

**Recent changelog entries:**
!`head -50 docs/ai/changelog.md 2>/dev/null || echo "No changelog found"`

## Prerequisites

Issues must have the `ready` label (groomed with clear description, acceptance criteria, out-of-scope section).

## Arguments

**Issue number:** $ARGUMENTS

## Instructions

### Step 1: Select Issue

If an issue number was provided above, verify it has the `ready` label. If not, inform the user and suggest running `/groom` first.

If no issue number was provided:

1. Fetch issues: `gh issue list --label ready --json number,title,labels,milestone --limit 20` (exclude any with `in-progress` label)
2. If none found, inform the user and exit
3. Use AskUserQuestion to let the user select an issue

After selection, mark it in-progress: `gh issue edit <number> --add-label in-progress`

### Step 2: Understand the Issue

1. Fetch full details: `gh issue view <number> --json number,title,body,labels,milestone`
2. Parse: Description, Acceptance Criteria, Out of Scope
3. Present a brief summary showing you understand the requirements

### Step 3: Research Phase

1. **Read conventions:** Use Read tool on `docs/ai/conventions.md`

2. **Explore codebase** using the `explore-issue` agent:
    - Spawn a Task with `subagent_type: explore-issue`
    - Find related files, existing patterns, similar implementations
    - Identify files to create or modify

3. **Identify approach:** files to change, patterns to follow, technical decisions, change order

### Step 4: Setup Branch

1. Fetch latest: `git fetch origin main`
2. Create feature branch from `origin/main`:
    - Convention: `<type>/<issue-number>-<short-description>` (types: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`)
    - Example: `git checkout -b feat/42-user-authentication origin/main`
3. If branch exists, see `templates/edge-cases.md` for resolution

### Step 5: Implementation

Make changes following the approach from research:

- Edit existing files with Edit tool, create new files with Write tool
- Keep changes focused on acceptance criteria — avoid scope creep

**Core loop — repeat until green:**

```bash
pnpm check    # lint + build + test (REQUIRED before committing)
```

Fix any failures before proceeding. For UI changes, also run:

```bash
pnpm -F web test:e2e:smoke    # REQUIRED for UI changes
```

For specialized scenarios (DB migrations, CSS tokens, visual-compare), see `templates/implementation-guide.md`.

If implementation reveals out-of-scope work, note it for follow-up issues — stay focused on acceptance criteria.

### Step 6: Verify Acceptance Criteria

Go through each acceptance criterion from the issue:

1. Confirm each item is satisfied by the implementation
2. Run relevant tests to verify
3. If any criterion is not met, ask the user whether to address now or note for follow-up

### Step 7: Self-Review (REQUIRED)

**You MUST spawn 3 parallel review agents before committing. DO NOT skip this step or proceed directly to commit.**

1. Get the diff of all changes:

    ```bash
    git diff --name-only
    git diff
    ```

2. **Spawn 3 review agents in parallel** using Task tool:
    - `subagent_type: conventions-review` — check against project conventions
    - `subagent_type: code-quality-review` — check for over-engineering and unnecessary complexity
    - `subagent_type: reuse-review` — check for code duplication and reuse opportunities

    Pass each agent the changed files list and diff content.

3. Collect findings from all 3 agents.

4. If issues found, present them grouped by category, then use AskUserQuestion:
    - **Fix all**: Auto-fix all identified issues
    - **Fix selected**: Let user pick which to fix
    - **Skip**: Proceed without fixes (add note to PR)

5. Apply any approved fixes, then re-run `pnpm check` to verify.

6. If no issues found, proceed to Step 8.

### Step 8: Commit Changes

**GATE CHECK — Before proceeding, confirm Step 7 was completed:**

- Did you spawn all 3 review agents (conventions, code-quality, reuse)?
- Did you collect and process their findings?
- Did you apply approved fixes or confirm no issues were found?

**If ANY answer is NO, STOP and return to Step 7 now.**

1. Review changes: `git status` and `git diff`
2. Stage relevant files (avoid staging unrelated changes)
3. Commit with issue reference:
    ```bash
    git commit -m "<type>: <description> (#<issue-number>)"
    ```
4. Push branch: `git push -u origin <branch-name>`

### Step 9: Create Pull Request

Create PR using the template from `templates/pr-body.md`:

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<fill in from templates/pr-body.md>
EOF
)"
```

Include `Closes #<issue-number>` in the body. Then remove the in-progress label:

```bash
gh issue edit <number> --remove-label in-progress
```

### Step 10: Summary

Provide a summary including:

- Issue worked on (number and title)
- Branch name and PR link
- Key changes made and files modified
- Any follow-up items identified

## Notes

- ALWAYS read the issue thoroughly before starting
- ALWAYS research the codebase to understand existing patterns
- NEVER skip self-review — always spawn review agents before committing
- Follow conventions in `docs/ai/conventions.md`
- Update `docs/ai/changelog.md` after significant changes
- Keep commits focused and atomic; reference the issue number in commits and PR
- For edge cases (issue not ready, lint errors, branch conflicts, etc.), see `templates/edge-cases.md`
