---
name: groom
description: Groom a GitHub issue from needs-details to ready
argument-hint: <issue-number>
disable-model-invocation: true
---

# Issue Grooming Command

Transform a draft issue (labeled `needs-details`) into an implementation-ready issue (labeled `ready`).

## Templates Reference

**Draft issues** (`.github/ISSUE_TEMPLATE/draft.yml`):

- Minimal: just a Description field
- Auto-labeled: `needs-details`

**Ready issues** (`.github/ISSUE_TEMPLATE/task.yml`):

- Description: What needs to be done and why
- Acceptance Criteria: Testable checkboxes
- Out of Scope: What this task explicitly does NOT include

## Arguments

**Issue number:** $ARGUMENTS

## Instructions

If no issue number was provided, stop and tell the user: `Pass an issue number, e.g. /groom 42`. Do not attempt to list or pick an issue.

Then verify the issue is actually a draft before spending tokens on research:

```bash
gh issue view <number> --json state,labels --jq '{state, labels: [.labels[].name]}'
```

If the issue is closed, or its labels don't include `needs-details` (e.g. it's already `ready`), stop and tell the user the issue's current state. Do not re-groom an already-groomed issue without explicit instruction.

Otherwise, proceed to Phase 1.

### Phase 1: Research & Discovery (REQUIRED)

1. **Spawn the research subagent** with `subagent_type: "groom-research"` (do NOT use `run_in_background`). Pass it the issue number. It fetches the issue, researches the codebase, and returns findings including `KEY DECISIONS NEEDED`, `CLARIFYING QUESTIONS`, and `ASSUMPTIONS I'M MAKING`.

2. **Ask the user** about each decision, question, and assumption the agent surfaced. Present alternatives where the agent identified them. Do not proceed until the user has resolved all open points.

### Phase 2: Draft & Finalize

Only proceed here AFTER getting user input on key decisions.

1. **Draft improved body** incorporating user decisions:

    ```markdown
    ## Description

    [Expanded description based on research AND user decisions]

    ## Acceptance Criteria

    - [ ] [Specific, testable criterion reflecting agreed approach]
    - [ ] [More criteria based on user input]

    ## Out of Scope

    - [Items explicitly excluded based on user decision]
    - [Scope boundaries the user confirmed]
    ```

2. **Proceed to Self-Review.** Do not apply the draft yet.

## Self-Review (REQUIRED)

Before applying the draft, review it for quality, codebase alignment, and related-issue relationships.

1. **Review draft quality inline.** Check the draft against `.claude/skills/groom/templates/review-criteria.md` yourself — the draft is already in context and no tool use is required. Verify description clarity, acceptance criteria specificity, scope boundaries, absence of ambiguous language, and appropriate labels (type, area). Fix any quality issues directly in the draft before spawning subagents.

2. **Spawn two review agents in the same message** (do NOT use `run_in_background` — make both Task calls in one message so they run concurrently and return results directly). Pass each the drafted issue body and the issue number:
    - `subagent_type: "groom-alignment-review"` — verifies referenced files/patterns exist, checks convention alignment, flags conflicts.
    - `subagent_type: "groom-related-issues"` — surfaces blocked-by, blocks, references, and overlapping-scope relationships across open issues.

3. **Collect results from both agents** (each Task's return value contains the agent's final structured output directly).

4. **Process findings:**
    - **Fix directly** in the draft: references to non-existent files/patterns.
    - **Collect for the user gate** (next step): convention divergence, potential conflicts with existing features, architectural trade-offs, discovered complexity that may affect scope, suggested issue relationships (blocked-by, blocks, duplicates), overlapping open issues.

5. **Surface concerns to the user before applying.** If the alignment review flagged convention concerns or potential conflicts, OR the related-issues review surfaced blocking/overlapping issues, present these and ask the user to confirm before proceeding. If nothing material was flagged, skip this step.

6. **Proceed to Apply.**

## Apply

1. **Write the new body and flip the label** to `ready`:

    ```bash
    gh issue edit <number> --body "<new body>"
    gh issue edit <number> --remove-label needs-details --add-label ready
    ```

2. **Report to the user:**
    - Link to the updated issue
    - Key decisions reflected in the draft
    - Any flagged concerns collected during Self-Review (for awareness — not blocking)

## References

- **Priority labels, type/area labels, and follow-up issue creation:** load `.claude/skills/groom/templates/labels-reference.md` when you need to suggest a priority label or create a follow-up issue.
- **Issue-relationship GraphQL (sub-issues, blocking):** `docs/ai/github-workflow.md`.

## Notes

- Preserve existing context from the original issue body in the new draft.
- If you identify work that should be separate (prerequisites, follow-ups, discovered scope), propose it as a new draft issue rather than expanding this one — see the labels reference for the process.
