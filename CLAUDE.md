# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nexus is a deep storage solution using AWS S3 tiers (Standard → Glacier) for cost-effective file archival. Think "Dropbox for archival" - users upload files they want to keep long-term but don't need instant access to.

**Phase:** MVP Planning & Development (POC complete)
**Stack:** Next.js 16 / Supabase / AWS S3 / Stripe / Vercel
**Monorepo:** pnpm workspaces + Turborepo
**IaC:** Terraform
**ORM:** Drizzle | **Styling:** Tailwind | **Storage:** Glacier-first
**API:** tRPC v11 | **Testing:** Vitest + Playwright

## Repository Structure

```
nexus/
├── apps/web/          # Next.js application
├── infra/terraform/   # AWS infrastructure (S3, IAM)
└── docs/              # Obsidian documentation vault
```

## Documentation

The `docs/` folder is an Obsidian vault with all project documentation:

```
docs/
├── ai/               # AI context - start here
│   ├── changelog.md  # Recent changes - read first
│   ├── context.md    # Project background & data model
│   └── conventions.md # Naming, structure, code style
├── architecture/     # System design
├── guides/           # Implementation patterns
└── planning/         # Roadmap & MVP scope
```

**Before writing code:** Read `docs/ai/conventions.md` for naming conventions and component structure guidelines.

**After making changes:** Update `docs/ai/changelog.md` with what changed and why.
