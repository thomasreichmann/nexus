---
name: refresh
description: Verify whether a groomed issue is still accurate
argument-hint: [issue-number] (optional)
allowed-tools: Bash, Task, AskUserQuestion, Read, Grep, Glob
disable-model-invocation: true
agent: refresh-agent
---

# Refresh Issue Command

This command verifies whether a previously groomed issue is still accurate after time has passed or blockers have been completed. It helps ensure issues stay aligned with the actual codebase state before work begins.

**Use cases:**

- Before starting work on an older `ready` issue
- After blockers are completed (infrastructure now exists that the issue referenced)
- Periodic backlog hygiene

## Dynamic Context

**Current ready issues:**
!`gh issue list --label ready --json number,title,updatedAt --limit 10 2>/dev/null || echo "Could not fetch issues"`

## Arguments

**Issue number:** $ARGUMENTS

## Instructions

### Step 1: Select Issue

If an issue number was provided above (not empty):

- Verify it has the `ready` label
- If not, inform the user that this command is for refreshing `ready` issues
- Suggest `/groom` for issues that need initial grooming
- Skip to Step 2 with that issue number

If no issue number was provided:

1. Fetch issues with `ready` label:

    ```bash
    gh issue list --label ready --json number,title,labels,updatedAt --limit 20 | \
      jq 'sort_by(.updatedAt)'
    ```

2. If no issues found, inform the user and exit.

3. Use AskUserQuestion to let the user select an issue:
    - Show oldest issues first (more likely to be stale)
    - Each option should include last updated date
    - Include "(oldest)" marker for the oldest issue

### Step 2: Research Phase (REQUIRED)

This phase gathers information about the issue and compares it to the current codebase state.

1. **Fetch full issue details and comments:**

    ```bash
    gh issue view <number> --json number,title,body,labels,createdAt,updatedAt
    gh issue view <number> --comments
    ```

2. **Parse issue structure:**
    - Description: What needs to be done
    - Acceptance Criteria: The definition of done
    - Out of Scope: What to explicitly avoid

3. **Identify referenced elements** in the issue:
    - File paths mentioned
    - API endpoints or routes
    - Component names
    - Function/method names
    - Database tables or columns
    - Environment variables
    - External dependencies or packages

4. **Check blocker status:**
    - Look for "blocked by #X" or "depends on #X" references in the body or comments
    - For each blocker, check if it's closed:

    ```bash
    gh issue view <blocker-number> --json state,title
    ```

5. **Compare issue expectations vs codebase reality:**

    Spawn a Task agent (subagent_type: "Explore") to isolate exploration and keep main context focused on analysis:
    - Verify referenced files still exist at the expected paths
    - Check if APIs/patterns mentioned in the issue still apply
    - Look for changes that might have happened since the issue was created
    - Find if any prerequisites mentioned have been implemented
    - Identify any new patterns or conventions that should be considered

### Step 3: Analysis Phase

Based on research, identify staleness in these categories:

**1. Completed Prerequisites:**

- Blockers that are now closed
- Infrastructure that now exists
- Features that have been implemented

**2. Outdated References:**

- File paths that have changed or no longer exist
- API endpoints that have been modified
- Components that have been renamed or refactored
- Patterns that have been superseded

**3. Changed Context:**

- New patterns or conventions that should be followed
- Related features that have been added
- Dependencies that have been updated

**4. Acceptance Criteria Changes:**

- Criteria that are now automatically satisfied
- Criteria that need adjustment based on new reality
- Criteria that are no longer relevant

### Step 4: Present Findings

Present findings to the user organized by category:

```markdown
## Issue Freshness Analysis: #<number> - <title>

### Summary

[Overall assessment: Fresh / Minor Updates Needed / Significant Updates Needed]

### Completed Prerequisites

- [x] Blocker #X is now closed: [title]
- [x] [Feature/infrastructure] now exists

### Outdated References

- File `old/path.ts` has moved to `new/path.ts`
- API endpoint `/old` is now `/new`
- Pattern X has been replaced with pattern Y

### Changed Context

- New convention: [description]
- Related feature added: [description]

### Acceptance Criteria Review

- [ ] Criterion 1: Still valid
- [ ] Criterion 2: Needs update - [reason]
- [x] Criterion 3: Already satisfied by [implementation]

### Recommended Updates

[List specific changes to make to the issue]
```

If no staleness detected:

```markdown
## Issue Freshness Analysis: #<number> - <title>

### Summary

This issue is still fresh and accurate.

- All file references are valid
- No completed blockers found
- Acceptance criteria are still appropriate
- Context matches current codebase state

No updates needed.
```

### Step 5: User Decision

Use AskUserQuestion with these options:

**If updates are recommended:**

- **Apply updates**: Edit the issue with proposed changes
- **Apply with modifications**: Let me review and adjust the changes first
- **Skip updates**: Keep the issue as-is (maybe it's fine for now)
- **Mark for re-grooming**: Send back to `needs-details` for more significant rework

**If no staleness detected:**

- **Confirm freshness**: Add a comment noting the issue was verified as current
- **Mark for re-grooming**: I see issues the analysis missed, send back for rework
- **Skip**: No action needed

### Step 6: Apply Updates (if approved)

**If "Apply updates" or "Apply with modifications":**

1. **For "Apply with modifications":**
    - Present the proposed new body
    - Let user make edits via AskUserQuestion or direct feedback
    - Incorporate changes

2. **Update the issue body:**

    ```bash
    gh issue edit <number> --body "<updated body>"
    ```

3. **Add a comment documenting what was refreshed:**

    ```bash
    gh issue comment <number> --body "$(cat <<'EOF'
    ## Issue Refreshed

    This issue was reviewed for freshness. Changes made:

    - [List changes]

    Verified against codebase state as of [date].
    EOF
    )"
    ```

**If "Mark for re-grooming":**

1. Update labels:

    ```bash
    gh issue edit <number> --remove-label ready --add-label needs-details
    ```

2. Add comment explaining why:

    ```bash
    gh issue comment <number> --body "Sent back for re-grooming: [reason from user or analysis]"
    ```

**If "Confirm freshness":**

1. Add a comment:

    ```bash
    gh issue comment <number> --body "Issue verified as fresh and accurate as of [date]. No updates needed."
    ```

### Step 7: Summary

Provide a summary including:

- Issue number and title
- Freshness assessment (Fresh / Updated / Sent for re-grooming)
- Key changes made (if any)
- Link to the issue

## Edge Cases

### Issue Not Ready

If the selected issue doesn't have `ready` label:

```
This command is for refreshing `ready` issues.

Issue #X has label: [current labels]

Would you like to:
1. Run /groom to groom this issue first
2. Choose a different issue
```

### No Ready Issues

If no `ready` issues exist:

```
No issues with the `ready` label found.

You can:
- Run /groom to prepare draft issues
- Check if issues exist with: gh issue list --limit 20
```

### Blockers Still Open

If the issue references blockers that are still open:

- Include this prominently in findings
- Note that some criteria may not be verifiable until blockers close
- Suggest waiting or working on blockers first

## Notes

- ALWAYS complete the research phase before presenting findings
- Do NOT make changes without user approval
- Preserve existing issue content - only update stale sections
- Be conservative with "still fresh" assessments - when in doubt, flag for review
- The goal is verification, not re-grooming. Suggest `/groom` for major rework
