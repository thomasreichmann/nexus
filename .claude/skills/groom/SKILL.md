---
name: groom
description: Groom GitHub issues from needs-details to ready
argument-hint: '[issue-number] (optional)'
disable-model-invocation: true
---

# Groom Issue

Turn a draft issue (`needs-details`) into an implementation-ready one (`ready`): verify its claims, settle the real decisions, rewrite the body so an implementer needs nothing else, delete what the rewrite obsoletes.

**Issues needing grooming:**
!`gh issue list --label needs-details --json number,title --template '{{range .}}#{{.number}} {{.title}}{{"\n"}}{{end}}' 2>/dev/null || echo "(could not fetch)"`

**Issue number:** $ARGUMENTS

**Issue (pre-fetched, with comments):**
!`gh issue view $(printf '%s' "$ARGUMENTS" | sed 's/^#//') --json number,title,labels,body,comments --template '#{{.number}} — {{.title}}{{"\n"}}labels: {{range .labels}}{{.name}}, {{end}}{{"\n\n"}}{{.body}}{{"\n"}}{{range .comments}}{{"\n"}}--- comment by {{.author.login}} ---{{"\n"}}{{.body}}{{"\n"}}{{end}}' 2>/dev/null || echo "(no issue number given — pick from the list above)"`

## Workflow

1. **Pick.** If an issue number was given, use it (pre-fetched above — don't re-fetch). Otherwise show the needs-details list and ask which to groom; more than one is fine.

2. **Spawn & summarize.** Per issue, in one block: spawn a `groom-research` agent in the background with its full task — the issue body, all comments verbatim, the commit the refs were written against if a comment names one, and the report format from step 4 — and run `ToolSearch select:SendMessage` (needed for follow-ups). Multiple issues get their researchers in the same block; they run concurrently. Then briefly summarize: what the draft wants, what the comments add, which open questions look like real forks.

3. **Fill the research window.** The researcher takes minutes; use them:
    - Batch-fetch every issue and PR the body or comments reference: `gh issue view <m> --json state,title` — closed siblings change what this issue still owns.
    - Check for overlaps: `gh issue list --search "<keywords>" --state open`.
    - Read `docs/ai/github-workflow.md` if you haven't this session (labels, relationship commands).
    - Grab numeric comment ids for step 6's cleanup: `gh api repos/{owner}/{repo}/issues/<n>/comments --jq '.[] | {id, user: .user.login}'`.

4. **Judge the research.** The report must contain:
    - **Claim audit** — every body/comment claim it relied on, each with a verdict: confirmed (current file:line), moved, obsolete (what changed it), or unverified.
    - **Pattern evidence** — verbatim quotes (with paths) of the patterns the groomed body will point at.
    - **Real decisions** — forks where more than one approach is genuinely viable, each option with evidence and a lean. Preferences aren't forks.
    - **Draft ingredients** — candidate acceptance criteria (each testable, each traceable to evidence) and candidate out-of-scope items.
    - **Declared skips** — what it didn't check and why that's safe.

    Judge before drafting: every criterion candidate has evidence attached, obsolete claims are dropped rather than paraphrased, decisions are genuine forks. Gaps get a targeted follow-up to the same researcher via SendMessage — never respawn (respawning loses its context and re-bills the reading).

5. **Decide.** Put the real forks to the user in one AskUserQuestion round, your lean listed first. If the user isn't reachable (autonomous run), take the researched lean and state the decision and its rationale in the body.

6. **Rewrite & apply.** Draft the new body in the task-template shape — `## Description` (what and why, decisions inline with their rationale), `## Acceptance Criteria` (testable checkboxes), `## Out of Scope`. The body must stand alone: `/work`'s explorer reads it without the comments. Fold in only what survives from the comments — verified refs, the reasoning behind decisions; drop what's stale or delegated to other issues. Present per issue: the new body, label changes, comments to delete. On approval (in an autonomous run, step 5's decision rule already applies — proceed and report):
    - `gh issue edit <n> --body-file <scratchpad file>`
    - `gh issue edit <n> --remove-label needs-details --add-label ready` — suggest a `priority: *` label if none is set.
    - Delete investigation comments the rewrite folded in or obsoleted: `gh api -X DELETE repos/{owner}/{repo}/issues/comments/<numeric-id>`. A groomed issue carries one source of truth, not a body plus a stale comment disputing it.

7. **Follow-ups.** Work discovered but out of scope becomes new draft issues (`needs-details`), created only with user approval and linked per `docs/ai/github-workflow.md`. Close with one line per issue: what changed, decisions made, link.
