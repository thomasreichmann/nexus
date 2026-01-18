---
title: GitHub Workflow for AI Agents
created: 2026-01-18
updated: 2026-01-18
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

How to create, link, and manage GitHub issues using the CLI and GraphQL API.

## Creating Issues

### Before Creating

1. **Get explicit approval** - Draft the issue content and present to user first
2. **Check for duplicates** - Search existing issues: `gh issue list --search "keyword"`
3. **Determine scope** - One issue per coherent unit of work

### Issue Format

```bash
gh issue create --title "Brief descriptive title" --label "area,type" --body "$(cat <<'EOF'
## Description

What and why (2-3 sentences).

## Acceptance Criteria

- [ ] Specific, testable criterion
- [ ] Another criterion

## Out of Scope

- What this issue explicitly doesn't cover
- Potential follow-up work (create separate issues)
EOF
)"
```

### Labels

Combine area + type:

| Area       | Type       |
| ---------- | ---------- |
| `frontend` | `feature`  |
| `backend`  | `bug`      |
| `infra`    | `chore`    |
| `docs`     | `refactor` |

Example: `--label "backend,feature"`

## Issue Relationships

GitHub supports native issue relationships. Use these instead of just mentioning issues in descriptions.

### Sub-Issues (Parent/Child)

When work naturally breaks down into a parent task with child tasks:

```bash
# Get issue node IDs
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    parent: issue(number: 30) { id }
    child: issue(number: 31) { id }
  }
}'

# Link child to parent
gh api graphql -f query='
mutation {
  addSubIssue(input: {
    issueId: "PARENT_NODE_ID",
    subIssueId: "CHILD_NODE_ID"
  }) {
    issue {
      number
      subIssues(first: 5) {
        nodes { number title }
      }
    }
  }
}'
```

### When to Use Sub-Issues

| Scenario                                        | Action                                   |
| ----------------------------------------------- | ---------------------------------------- |
| Implementation plan mentions "follow-up ticket" | Create as sub-issue of main ticket       |
| Feature breaks into phases                      | Parent = epic, children = phases         |
| Bug fix reveals related issues                  | Parent = original, children = discovered |
| Config/setup depends on core implementation     | Core = parent, config = child            |

### Removing Sub-Issue Relationship

```bash
gh api graphql -f query='
mutation {
  removeSubIssue(input: {
    issueId: "PARENT_NODE_ID",
    subIssueId: "CHILD_NODE_ID"
  }) {
    issue { number }
  }
}'
```

## Updating Issues

### Add Comment

```bash
gh issue comment 42 --body "Status update or clarification"
```

### Update Labels

```bash
# Add label
gh issue edit 42 --add-label "ready"

# Remove label
gh issue edit 42 --remove-label "blocked"
```

### Close Issue

```bash
gh issue close 42 --comment "Completed in PR #45"
```

## Referencing Issues

| Context                 | Format                              |
| ----------------------- | ----------------------------------- |
| Commit message          | `feat: add login form (#42)`        |
| PR body                 | `Closes #42` (auto-closes on merge) |
| Related but not closing | `Related to #42`                    |

## Token Efficiency

- Fetch only needed fields: `gh issue view 42 --json title,body,state`
- Don't re-fetch issues already read in the session
- Use `--limit` when listing: `gh issue list --limit 10`

## Examples

### Create Feature with Follow-up

```bash
# Create main issue
gh issue create --title "Add error verbosity to logging" \
  --label "backend,feature" \
  --body "..."
# Returns: Created issue #30

# Create follow-up as separate issue first
gh issue create --title "Add env var config for error verbosity" \
  --label "backend,chore" \
  --body "..."
# Returns: Created issue #31

# Link as sub-issue
gh api graphql -f query='...'  # Link #31 as child of #30
```

### Check Issue Relationships

```bash
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    issue(number: 30) {
      title
      subIssues(first: 10) {
        nodes { number title state }
      }
      parent { number title }
    }
  }
}'
```

## Related

- [[conventions|Code Conventions]] - Commit message format
- [[../guides/github-workflow|GitHub Workflow (UI)]] - Human guide for GitHub UI
- [[_index|Back to AI Docs]]
