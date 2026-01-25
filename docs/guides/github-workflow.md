---
title: GitHub Workflow
created: 2026-01-18
updated: 2026-01-18
status: active
tags:
    - guide
    - github
    - workflow
aliases:
    - Issue Guidelines
    - GitHub Issues
---

# GitHub Workflow

Guidelines for creating and managing GitHub issues using the web UI.

## Creating Issues

### When to Create an Issue

- Any non-trivial work (new features, bug fixes, refactors)
- Work that needs tracking or coordination
- Ideas that need discussion before implementation

Skip issues for: typos, single-line fixes, dependency bumps.

### Issue Structure

Every issue should have:

1. **Title** - Brief, descriptive (e.g., "Add dark mode toggle to settings")
2. **Description** - What and why (2-3 sentences)
3. **Acceptance Criteria** - Checkbox list of specific, testable outcomes
4. **Out of Scope** - What this issue explicitly doesn't cover

### Template

```markdown
## Description

[What this issue addresses and why it matters]

## Acceptance Criteria

- [ ] [Specific, testable criterion]
- [ ] [Another criterion]

## Out of Scope

- [What this doesn't cover]
- [Potential follow-up work]
```

### Labels

Apply two labels - area and type:

| Area           | Description                          |
| -------------- | ------------------------------------ |
| `frontend`     | UI, components, pages                |
| `backend`      | API, database, auth                  |
| `infra`        | AWS, Terraform, CI/CD                |
| `docs`         | Documentation                        |
| `architecture` | Foundational patterns/infrastructure |

| Type       | Description          |
| ---------- | -------------------- |
| `feature`  | New functionality    |
| `bug`      | Something broken     |
| `chore`    | Maintenance, cleanup |
| `refactor` | Code improvement     |

## Prerequisites Checklist

Before creating an implementation issue, ask:

1. **What modules does this need?** (e.g., `lib/storage/`, `lib/stripe/`)
2. **Do those modules exist?** If not, create foundational issues first
3. **What patterns does this follow?** Check if architecture is documented
4. **What database tables does this need?** List schema dependencies

If any prerequisite doesn't exist, create it as a separate issue with `architecture` label and add it to "Blocked By".

## Issue Relationships

GitHub supports native parent/child relationships between issues. Use these to organize related work.

### Creating Sub-Issues

When one issue depends on or follows from another:

1. Open the **parent issue**
2. In the issue body, find the **Sub-issues** section (or add one)
3. Click **Add sub-issue** or use the `+` button
4. Search for or create the child issue

Alternatively, from any issue:

1. Click the **...** menu (top right)
2. Select **Add sub-issue** or **Convert to sub-issue**

### When to Use Sub-Issues

| Scenario                             | Structure                              |
| ------------------------------------ | -------------------------------------- |
| Feature with follow-up config work   | Parent: feature, Child: config         |
| Epic broken into phases              | Parent: epic, Children: phases         |
| Bug that reveals related issues      | Parent: original, Children: discovered |
| Implementation with separate testing | Parent: implementation, Child: testing |

### Viewing Relationships

- Parent issues show a **Sub-issues** section with progress
- Child issues show **Parent issue** link at the top
- Project boards can group by parent

## Issue Lifecycle

### Status Labels

| Label           | Meaning                                         |
| --------------- | ----------------------------------------------- |
| `needs-details` | Requires more information before work can start |
| `needs-triage`  | Needs investigation/confirmation                |
| `ready`         | Fully specified, ready for implementation       |
| `blocked`       | Waiting on external dependency                  |

### Priority Labels

| Label                | Meaning                                 |
| -------------------- | --------------------------------------- |
| `priority: critical` | Must be addressed immediately           |
| `priority: high`     | Important, should be addressed soon     |
| `priority: medium`   | Normal priority                         |
| `priority: low`      | Nice to have, address when time permits |

### Workflow

1. **New issue** - Add `needs-details` or `needs-triage` if unclear
2. **Clarified** - Remove status label, add `ready`
3. **In progress** - Assign yourself, link PR
4. **Completed** - Close via PR (`Closes #42`) or manually

## Referencing Issues

| Context  | How                                                      |
| -------- | -------------------------------------------------------- |
| Commits  | Include `(#42)` in message: `feat: add login form (#42)` |
| PRs      | Add `Closes #42` in body to auto-close on merge          |
| Comments | Just type `#42` for auto-link                            |

## Related

- [[getting-started|Getting Started]] - Development setup
- [[../ai/github-workflow|GitHub Workflow (CLI)]] - AI agent guide with CLI commands
- [[_index|Back to Guides]]
