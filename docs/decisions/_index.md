---
title: Architecture Decision Records
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
    - decisions
    - adr
    - moc
aliases:
    - ADRs
    - Decision Log
---

# Architecture Decision Records

This folder contains Architecture Decision Records (ADRs) - documents that capture important architectural decisions made during the project, along with their context and consequences.

## Why ADRs?

- **Historical context**: Understand why decisions were made
- **Onboarding**: Help new team members understand the architecture
- **Avoid revisiting**: Prevent re-debating settled decisions
- **Learn from mistakes**: Document what didn't work and why

## ADR Status

| Status       | Meaning                           |
| ------------ | --------------------------------- |
| `proposed`   | Under discussion, not yet decided |
| `accepted`   | Decision made and in effect       |
| `deprecated` | No longer applies, superseded     |
| `superseded` | Replaced by another ADR           |

## Decisions

```dataview
TABLE status, created as "Date"
FROM "decisions"
WHERE file.name != "_index"
SORT created DESC
```

## Creating a New ADR

1. Use the [[adr-template|ADR Template]]
2. Number sequentially: `001-decision-name.md`
3. Keep titles short but descriptive
4. Fill in all sections, even if brief

## Related

- [[index|Back to Index]]
- [[architecture/_index|Architecture]]
