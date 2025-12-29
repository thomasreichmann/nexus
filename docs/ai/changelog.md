---
title: AI Changelog
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - ai
  - changelog
  - meta
aliases:
  - AI Changes
  - Session Log
ai_summary: "Recent AI changes - READ THIS FIRST for context"
---

# AI Changelog

Recent changes made by AI assistants. **Read this first** to understand recent context.

---

## 2025-12-29

### Session: Monorepo & Infrastructure Decisions

Documented monorepo structure and infrastructure-as-code decisions.

**Decisions Made:**
- **Monorepo tooling:** pnpm workspaces + Turborepo
- **IaC:** Terraform (over CDK, for cloud-agnostic flexibility)
- **Structure:** `apps/web/` for Next.js, `infra/terraform/` for AWS
- **Shared packages:** Add `packages/` when needed, not upfront

**Files Modified:**
- `docs/architecture/tech-stack.md` - Added Monorepo Tooling and Terraform sections
- `docs/architecture/system-design.md` - Added Repository Structure section
- `docs/ai/context.md` - Updated file paths to `apps/web/` prefix, added IaC to decisions

**Why:** Finalizing architecture decisions before building. Terraform chosen after consulting with someone with more devops experience.

---

### Session: AI Documentation Simplification

Removed overly prescriptive rules and undefined patterns from AI documentation.

**Files Modified:**
- `CLAUDE.md` - Removed Do's/Don'ts lists, removed app directory structure
- `.cursorrules` - Removed patterns section and avoid section, simplified
- `docs/ai/patterns.md` - Removed all code examples, marked as draft
- `docs/ai/conventions.md` - Removed app directory structure and Server/Client Component patterns

**Why:** User feedback that defining hard rules limits AI creativity and can cause over-focus on don'ts. App structure isn't finalized, so specific patterns shouldn't be defined yet.

**Notes:**
- Keep general code quality guidelines (TypeScript, naming, error handling)
- Remove specific architecture that isn't decided yet
- Patterns will be added as they emerge during development

---

### Session: AI Documentation Setup

Created AI-friendly documentation structure for Claude Code and Cursor.

**Files Created:**
- `docs/ai/_index.md` - AI docs hub
- `docs/ai/context.md` - Project background and architecture
- `docs/ai/conventions.md` - Naming and style rules
- `docs/ai/patterns.md` - Code pattern templates
- `docs/ai/changelog.md` - This file
- `CLAUDE.md` - Root context for Claude Code
- `.cursorrules` - Root context for Cursor

**Why:** Enable AI assistants to understand the project instantly and generate consistent code.

**Notes:**
- All AI docs use `ai_summary` frontmatter for quick parsing
- Patterns are copy-paste ready templates
- Check `conventions.md` before generating code

---

### Session: Obsidian Enhancement

Added Canvas and Excalidraw support for visual documentation.

**Files Created:**
- `docs/architecture/system-overview.canvas` - Interactive architecture board
- `docs/architecture/drawings/` - Folder for Excalidraw diagrams

**Files Modified:**
- `docs/.obsidian/community-plugins.json` - Added excalidraw plugin
- `docs/architecture/_index.md` - Added Visual Tools section
- `docs/contributing.md` - Added Canvas/Excalidraw instructions

**Notes:**
- Canvas is for high-level architecture boards
- Excalidraw is for detailed hand-drawn diagrams
- Excalidraw files saved to `architecture/drawings/`

---

### Session: Documentation Vault Improvements

Added ADRs, dev journal, and additional templates.

**Files Created:**
- `docs/decisions/_index.md` - ADR index
- `docs/journal/_index.md` - Dev journal index
- `docs/templates/adr-template.md` - Architecture Decision Record template
- `docs/templates/meeting-notes-template.md` - Meeting notes template
- `docs/templates/feature-spec-template.md` - Feature specification template
- `docs/templates/daily-note-template.md` - Daily dev note template
- `docs/changelog.md` - Project changelog
- `docs/contributing.md` - Contribution guidelines

**Notes:**
- ADRs use numbered format: `001-decision-name.md`
- Daily notes configured for Templater plugin
- All templates use Templater syntax

---

### Session: Notion to Obsidian Migration

Migrated all documentation from Notion to Obsidian vault.

**Structure Created:**
```
docs/
├── index.md                # Main hub
├── architecture/           # System design
│   ├── tech-stack.md
│   ├── principles.md
│   └── system-design.md
├── guides/                 # How-to docs
│   ├── getting-started.md
│   └── nextjs-patterns.md
├── planning/               # Roadmap, planning
│   ├── mvp-notes.md
│   └── roadmap.md
└── resources/              # External links
    └── references.md
```

**Features Implemented:**
- YAML frontmatter on all docs
- Obsidian callouts (> [!note], etc.)
- Wikilinks for internal navigation
- Dataview queries for dynamic content
- Tags: #architecture, #guide, #planning, etc.

**Plugins Configured:**
- Dataview (required for queries)
- Templater (for templates)

**Notes:**
- Task tracking removed per user preference
- Emojis removed from filenames
- POC status preserved in prose

---

## How to Update This File

After completing significant work:

1. Add new entry under today's date (or create new date heading)
2. Use format: `### Session: Brief Description`
3. List files created/modified
4. Explain **WHY**, not just what
5. Add **Notes** for gotchas or context

Example:
```markdown
### Session: Auth Implementation
- Created `lib/auth/session.ts`
- Updated `middleware.ts`
- **Note:** Using Supabase auth helpers, not custom JWT
```
