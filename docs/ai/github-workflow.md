---
title: GitHub Workflow for AI Agents
created: 2026-01-18
updated: 2026-03-07
status: active
tags:
    - ai
    - github
    - workflow
aliases:
    - Issue Management
    - GitHub CLI
ai_summary: 'How AI agents should create, link, and manage GitHub issues'
---

# GitHub Workflow for AI Agents

## Creating Issues

1. **Get explicit approval** — draft content, present to user first
2. **Check duplicates** — `gh issue list --search "keyword"`
3. **One issue per coherent unit of work**

```bash
gh issue create --title "Brief title" --label "area,type,status" --body "$(cat <<'EOF'
## Description
What and why.

## Acceptance Criteria
- [ ] Criterion

## Out of Scope
- Not covered
EOF
)"
```

### Labels

| Area           | Type       | Status          |
| -------------- | ---------- | --------------- |
| `frontend`     | `feature`  | `needs-details` |
| `backend`      | `bug`      | `ready`         |
| `infra`        | `chore`    |                 |
| `docs`         | `refactor` |                 |
| `architecture` |            |                 |

Project labels: `trpc-devtools` (for npm package), none for Nexus core.
Every issue MUST have exactly one status label (`needs-details` or `ready`).

### Prerequisites Checklist

Before creating: check what modules/tables/patterns are needed. If prerequisites don't exist, create foundational issues first with `architecture` label.

## Issue Relationships

### GraphQL Helper Pattern

```bash
# Get node IDs for any two issues
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    a: issue(number: NUM_A) { id }
    b: issue(number: NUM_B) { id }
  }
}'
```

### Sub-Issues (Parent/Child)

Use when B is _part of_ A.

```bash
gh api graphql -f query='
mutation { addSubIssue(input: { issueId: "PARENT_ID", subIssueId: "CHILD_ID" }) { issue { number } } }'

# Remove:
mutation { removeSubIssue(input: { issueId: "PARENT_ID", subIssueId: "CHILD_ID" }) { issue { number } } }
```

### Blocking (Dependencies)

Use when B must complete _before_ A can start.

```bash
gh api graphql -f query='
mutation { addBlockedBy(input: { issueId: "BLOCKED_ID", blockingIssueId: "BLOCKING_ID" }) { issue { number } } }'

# Remove:
mutation { removeBlockedBy(input: { issueId: "BLOCKED_ID", blockingIssueId: "BLOCKING_ID" }) { issue { number } } }
```

### Check Relationships

```bash
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    issue(number: NUM) {
      title
      parent { number title }
      subIssues(first: 10) { nodes { number title state } }
    }
  }
}'
```

## Updating Issues

```bash
gh issue comment 42 --body "Status update"
gh issue edit 42 --add-label "ready"
gh issue edit 42 --remove-label "blocked"
gh issue close 42 --comment "Completed in PR #45"
```

## Referencing Issues

| Context      | Format                       |
| ------------ | ---------------------------- |
| Commit       | `feat: add login form (#42)` |
| PR (closing) | `Closes #42`                 |
| PR (related) | `Related to #42`             |

## Token Efficiency

- Fetch only needed fields: `--json title,body,state`
- Don't re-fetch issues already read
- Use `--limit` when listing

## Related

- [[conventions|Code Conventions]] - Commit message format
- [[_index|Back to AI Docs]]
