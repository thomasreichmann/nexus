---
title: Architecture
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - architecture
  - moc
aliases:
  - Architecture Index
---

# Architecture

System architecture, design patterns, and technical decisions for the Nexus MVP.

## Documents

- [[tech-stack|Tech Stack]] - Technology choices and rationale
- [[principles|Design Principles]] - Core architectural principles
- [[system-design|System Design]] - Architecture diagrams and data flow

## Visual Tools

- [[system-overview.canvas|System Overview Canvas]] - Interactive architecture board
- `drawings/` - Excalidraw diagrams (create with Excalidraw plugin)

> [!tip] Creating Diagrams
> Use **Canvas** for high-level architecture boards with linked notes.
> Use **Excalidraw** for detailed hand-drawn style diagrams.

## Quick Reference

| Decision | Choice | Status |
|----------|--------|--------|
| Framework | Next.js (App Router) | Decided |
| Database | Supabase (Postgres) | Decided |
| Storage | AWS S3 + Glacier | Decided |
| Deployment | Vercel | Decided |
| Payments | Stripe | Decided |
| ORM | Drizzle vs Prisma | Pending |

## Dataview

```dataview
TABLE status, file.mtime as "Updated"
FROM "architecture"
WHERE file.name != "_index"
SORT file.mtime DESC
```

## Related

- [[index|Back to Index]]
- [[guides/_index|Guides]]
