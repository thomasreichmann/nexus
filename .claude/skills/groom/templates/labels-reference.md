# Labels & Follow-up Issues Reference

Load this file during grooming when you need to suggest a priority label, choose type/area labels, or create follow-up issues.

## Core Labels

| Label           | Meaning                                   |
| --------------- | ----------------------------------------- |
| `needs-details` | Draft issue, not ready for implementation |
| `ready`         | Fully detailed, ready for implementation  |

## Priority Labels

Issues should have a priority label for triage and backlog prioritization:

| Label                | Color  | When to Use                             |
| -------------------- | ------ | --------------------------------------- |
| `priority: critical` | Red    | Must be addressed immediately           |
| `priority: high`     | Orange | Important, should be addressed soon     |
| `priority: medium`   | Yellow | Normal priority                         |
| `priority: low`      | Green  | Nice to have, address when time permits |

Suggest a priority based on:

- Business impact and user-facing visibility
- Blocking status (does this unblock other work?)
- Security or stability implications
- Milestone deadlines

## Creating Follow-up Issues

During grooming, you may identify work that should be separate issues (prerequisites, follow-ups, discovered scope). When creating these:

1. **Get user approval** before creating any new issues.
2. **Create as draft** with the `needs-details` label.
3. **Link related issues** using GitHub's native relationships.

**For issue relationships (sub-issues, blocking):** read `docs/ai/github-workflow.md` for the GraphQL commands and the decision guide on when to use parent/child vs. blocking relationships.
