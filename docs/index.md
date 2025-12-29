---
title: Nexus
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - index
  - moc
aliases:
  - Home
  - Project Hub
---

# Nexus - Deep Storage Solution

Welcome to the Nexus project documentation. This is your central hub for building the MVP of a deep storage file solution.

## Project Overview

**Vision:** Build a simple, flexible deep storage solution leveraging AWS S3 storage tiers for cost-effective file archival and retrieval.

**Current Status:** MVP Planning & Development

**POC Status:** Completed - proved upload capability and AWS S3 cold storage retrieval works

> [!tip] Key Principle
> Keep it simple - build a "poster" project that can evolve and scale.

## Quick Navigation

### Architecture
- [[architecture/_index|Architecture Overview]] - System design and tech decisions
- [[tech-stack|Tech Stack]] - Technology choices and rationale
- [[principles|Design Principles]] - Core architectural principles
- [[system-design|System Design]] - Diagrams and data flow

### Guides
- [[guides/_index|Guides Overview]] - Technical documentation
- [[getting-started|Getting Started]] - Development environment setup
- [[nextjs-patterns|Next.js Patterns]] - Implementation best practices

### Planning
- [[planning/_index|Planning Overview]] - MVP planning and roadmap
- [[mvp-notes|MVP Planning Notes]] - Initial architecture considerations
- [[roadmap|Project Roadmap]] - Development phases and milestones

### Decisions
- [[decisions/_index|Architecture Decision Records]] - Documented decisions with context
- Use [[templates/adr-template|ADR Template]] for new decisions

### Dev Journal
- [[journal/_index|Dev Journal]] - Daily development notes
- Use [[templates/daily-note-template|Daily Note Template]]

### AI Documentation
- [[ai/_index|AI Docs Hub]] - Context for AI assistants
- [[ai/changelog|AI Changelog]] - Recent AI changes (read first!)
- [[ai/patterns|Code Patterns]] - Implementation templates
- [[ai/conventions|Conventions]] - Naming and style rules
- [[ai/prompts|Useful Prompts]] - Task prompt templates

### Resources
- [[resources/references|Resources & References]] - External documentation and links
- [[changelog|Changelog]] - Project version history
- [[contributing|Contributing Guide]] - How to contribute to docs

## Tech Stack Summary

| Component | Choice | Status |
|-----------|--------|--------|
| Frontend & Backend | Next.js (App Router) | Decided |
| Database | Supabase (Postgres) | Decided |
| Storage | AWS S3 + Glacier | Decided |
| Deployment | Vercel | Decided |
| Payments | Stripe | Decided |
| AI Dev Tool | Cursor + Claude | Decided |
| ORM | Drizzle vs Prisma | Pending |

## Key Decisions

**Decided:**
- Full-stack Next.js with App Router and Server Components
- Supabase for database, auth, and real-time
- AWS S3 Standard + Glacier Deep Archive for storage
- Vercel for deployment
- Stripe subscriptions for payments
- Cursor with Claude for AI-assisted development

**Pending:**
- ORM choice (Drizzle vs Prisma)
- Styling approach (Tailwind CSS likely)
- Pricing model details
- File upload chunking strategy
- Storage tier transition logic

## Recent Updates

```dataview
TABLE file.mtime as "Updated", status
FROM ""
WHERE file.name != "index" AND file.name != "_index" AND !contains(file.path, "templates")
SORT file.mtime DESC
LIMIT 5
```

## All Documents

```dataview
TABLE status, file.folder as "Section"
FROM ""
WHERE file.name != "index" AND file.name != "_index" AND !contains(file.path, "templates")
SORT file.folder, file.name ASC
```

## Important Notes

> [!warning] POC Code
> The POC proved the concept works. Do NOT use POC code as a technical reference for the MVP - start fresh with proper architecture.

> [!note] Flexibility
> All infrastructure components should be swappable. Don't lock into specific vendors.

> [!tip] Philosophy
> This is a "poster" project - keep it simple, focused, and not over-engineered.

> [!note] For AI Assistants
> See `CLAUDE.md` (repo root) for quick context, or `docs/ai/changelog.md` for recent changes.
