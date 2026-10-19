---
title: 'ADR-003: Glacier Direct Upload for V1'
created: 2026-08-02
updated: 2026-08-02
status: accepted
tags:
    - decisions
    - adr
    - storage
    - glacier
aliases:
    - Storage Tier Decision
---

# ADR-003: Glacier Direct Upload for V1

## Status

Accepted

## Context

Kandrive's core value proposition is long-term, low-cost storage where users
accept slower retrieval in exchange for lower cost. Three project documents
currently describe conflicting default storage tier behavior:

- `README.md` states all uploads go directly to Glacier.
- `docs/architecture/tech-stack.md` states S3 Glacier Deep Archive is the
  default for all files.
- `docs/architecture/system-design.md` describes uploads landing in S3
  Standard first, then transitioning to Glacier via lifecycle policy.

Only the first behavior (direct-to-Glacier) is actually implemented. The
other two describe a more elaborate architecture that was never built for
V1. This ADR formalizes which behavior is authoritative and marks the other
two as future direction rather than current state.

## Decision

For V1, all file uploads are sent directly to S3 Glacier (standard Glacier
tier, not Deep Archive). There is no intermediate S3 Standard stage and no
lifecycle-based tier transition.

## Options Considered

1. **Direct-to-Glacier (chosen)** — simplest path; matches what is actually
   implemented today.
2. **S3 Standard → lifecycle transition to Glacier** — would give users a
   brief "fast access" window after upload before the file cools down, but
   adds meaningful complexity (lifecycle rules, dual-tier metadata, transition
   monitoring) with no validated user need for it yet.
3. **Deep Archive as default** — cheaper per GB than standard Glacier, but
   with materially longer and more expensive retrieval — a worse fit for the
   product's fast-turnaround retrieval promise, and not something users have
   asked for.

## Consequences

**Positive:**

- Matches the "Keep It Simple" principle already documented in
  `docs/architecture/principles.md`: avoid building for problems that don't
  exist yet.
- Every file has a consistent, predictable retrieval time from the moment
  it's stored — no ambiguity about whether a file is still fast-access or
  has already cooled down.
- Removes an entire class of bugs/edge cases around tier-transition timing
  that a lifecycle-based design would introduce.
- Coherent with the core product promise: users explicitly choose to trade
  speed for cost when they store a file, rather than experiencing an
  unannounced cooldown.

**Negative:**

- No "fast access grace period" after upload — if a user needs to
  immediately re-access a just-uploaded file, they pay the same retrieval
  cost/delay as any long-stored file.
- If user research later shows demand for a short-term "hot" window
  post-upload, this decision will need to be revisited alongside a new ADR.

## Documentation Impact

The following documents describe behavior that is **not** V1 and should be
marked as future/aspirational, not current state:

- `docs/architecture/tech-stack.md` — remove "Deep Archive default" as
  current behavior; reframe as a possible future optimization.
- `docs/architecture/system-design.md` — remove the S3 Standard → lifecycle
  transition flow from the current-state description; move to a "Future
  Considerations" or "Not in V1" section if one exists.

## Notes

This is a scope decision, not technical debt — it is the deliberate,
correct choice for the current product stage, consistent with the
project's "Build for Flexibility" principle (the tier logic can be revisited
without redesigning the storage layer itself).
