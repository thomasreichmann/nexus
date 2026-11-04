<!--
Sync Impact Report
Version change: template -> 1.0.0
Modified principles:
- Template principle 1 -> I. Archival-First Product Semantics
- Template principle 2 -> II. Type-Safe Boundaries
- Template principle 3 -> III. Explicit Asynchronous State
- Template principle 4 -> IV. Security and Secret Hygiene
- Template principle 5 -> V. Simple, Readable TypeScript
Added sections:
- Operational Constraints
- Development Workflow and Quality Gates
Removed sections: None
Follow-up TODOs: None
-->

# Nexus Constitution

## Core Principles

### I. Archival-First Product Semantics

Nexus MUST preserve its core product promise: cold archival storage for files that users rarely
access, with Glacier-backed durability and explicit restore latency. Every storage feature MUST
make the archive-vs-restore lifecycle visible to the user, and download access MUST only be
issued after a retrieval reaches a ready state. Features that imply instant access to archived data
MUST either model the required restore flow or be rejected.

Rationale: Nexus is "Dropbox for archival," not general hot storage. Correct expectations around
latency, durability, and restore status are part of the product contract.

### II. Type-Safe Boundaries

All external input MUST be validated before business logic executes. tRPC procedures MUST use Zod
schemas for mutation inputs, environment variables MUST be validated through the canonical env
schema, and database access MUST use the typed Drizzle schema and `@nexus/db` exports. Shared job,
webhook, and storage payloads MUST have explicit TypeScript types at package boundaries.

Rationale: Nexus coordinates browser uploads, S3, SQS, SNS, Stripe, and Postgres. Type-safe
boundaries prevent silent data shape drift across those systems.

### III. Explicit Asynchronous State

Long-running work MUST be represented as durable state transitions, not hidden side effects.
Glacier restores, SQS jobs, webhooks, billing events, and worker tasks MUST record pending,
in-progress, completed, failed, or equivalent terminal states. Webhooks and retries MUST be
idempotent, and terminal states MUST guard against replayed or out-of-order events.

Rationale: Restore and billing flows depend on third-party retries and delayed completion. Durable,
idempotent state transitions keep user-visible status accurate and prevent double-processing.

### IV. Security and Secret Hygiene

Secrets MUST never be committed or emitted in logs. AWS, Stripe, Supabase, auth, and email
credentials MUST remain in environment configuration or managed secret stores. Logs MAY include
non-sensitive identifiers and status values, but MUST redact tokens, access keys, database URLs,
webhook secrets, and personally sensitive file metadata. Webhook handlers MUST verify signatures
before applying state changes.

Rationale: Nexus handles user archives, payment flows, and cloud infrastructure credentials.
Secret leakage or unauthenticated webhook mutation is a release-blocking security failure.

### V. Simple, Readable TypeScript

Implementation MUST favor direct functions, small modules, and straightforward control flow.
New abstractions MUST earn their place by removing duplication or making boundaries clearer. Clean
Architecture, DDD layers, repository patterns, logging frameworks, and other structural overhead
MUST NOT be introduced unless an amendment documents the concrete need. Domain failures in the
web server MUST use `DomainError` or its subclasses from `apps/web/server/errors.ts`.

Rationale: The project values code that a senior developer can read without extra documentation.
Small, explicit TypeScript keeps feature work fast and reviewable.

## Operational Constraints

Nexus is a pnpm/Turborepo monorepo using Next.js 16, React 19, TypeScript, tRPC v11, Drizzle ORM,
Supabase Postgres, BetterAuth, Stripe, AWS S3 Glacier, SQS, SNS, and Lambda. Changes MUST respect
workspace ownership: web UI and API code live under `apps/web`, worker job handling under
`apps/worker`, database schema and migrations under `packages/db`, and AWS infrastructure under
`infra/terraform`.

Database schema changes MUST include generated and applied Drizzle migrations using the db package
workflow before being considered complete. S3 and Glacier operations MUST be asynchronous or have
explicit error propagation through domain errors. Utilities shared by web code MUST live in
`apps/web/lib` rather than being inlined inside routers or services.

Production infrastructure managed by Terraform is the source of truth for prod AWS resources.
Development resources that are documented as hand-built MUST NOT be replaced or applied through
Terraform until the relevant migration work is explicitly scoped.

## Development Workflow and Quality Gates

Work MUST stay scoped to the selected story, issue, or Spec Kit feature. Before changing code,
contributors MUST verify the current branch and project context when a task is branch- or
story-specific. Commits MUST include only files relevant to the requested change.

The minimum validation gate for ordinary changes is `pnpm -F web typecheck && pnpm lint`, or the
project gate script when the story defines one. Changes that touch tests, workers, database code,
infrastructure, or E2E-covered UI MUST run the smallest relevant additional command documented in
project guidance. E2E validation MUST use the smallest Playwright tier that covers the change and
MUST NOT run destructive validate tests unless explicitly requested.

Every feature specification and implementation plan MUST describe affected state transitions,
validation boundaries, security implications, and the verification commands required for release.
A change that cannot be verified locally MUST document the blocker and the safest remaining manual
check.

## Governance

This constitution supersedes conflicting project conventions for Spec Kit planning and review.
AGENTS.md, CLAUDE.md, README files, ADRs, and feature specs provide operational detail, but they
MUST be interpreted in a way that satisfies these principles.

Amendments MUST update this file, include a Sync Impact Report, and explain the semantic version
change. Versioning follows semantic versioning: MAJOR for incompatible governance or principle
redefinitions, MINOR for added principles or materially expanded guidance, and PATCH for wording,
clarifications, or non-semantic corrections.

Compliance MUST be reviewed during feature planning and before merge. Reviewers MUST reject changes
that bypass input validation, obscure async state, leak secrets, skip required migrations, or add
unjustified architectural complexity. Exceptions require an explicit written rationale in the
feature spec, PR, or ADR and MUST include a follow-up path back to compliance.

**Version**: 1.0.0 | **Ratified**: 2026-08-02 | **Last Amended**: 2026-08-02
