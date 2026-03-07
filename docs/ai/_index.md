---
title: AI Documentation
created: 2025-12-29
updated: 2026-03-07
status: active
tags:
    - ai
    - moc
    - meta
aliases:
    - AI Context
    - AI Docs
ai_summary: 'Central hub for AI-readable project documentation'
---

# AI Documentation

Documentation optimized for AI assistants (Claude Code, Cursor) to understand and work with the Nexus codebase.

## Documents

### Core Context

- [[context|Project Context]] - Background, data model, tech stack
- [[conventions|Conventions]] - Naming, structure, style rules (terse reference)
- [[patterns|Code Patterns]] - Implementation examples

### Workflow

- [[github-workflow|GitHub Workflow]] - Issue creation, relationships, and management

### Detailed Conventions

Full code examples and detailed explanations live in `docs/conventions/`:

- [[../conventions/naming|Naming]] - File, component, function, variable naming
- [[../conventions/typescript|TypeScript]] - Types, interfaces, imports
- [[../conventions/components|Components]] - Structure, organization, comments
- [[../conventions/error-handling|Error Handling]] - tRPC, boundaries, forms
- [[../conventions/testing|Testing]] - Smoke tests, auth tests, unit tests

## Quick Start for AI

1. **Read `CLAUDE.md`** (repo root) for project overview and commands
2. **Reference `conventions.md`** for naming and structure rules
3. **Check `patterns.md`** when generating code

## Related

- [[index|Back to Index]]
- [[architecture/_index|Architecture]]
- [[guides/_index|Guides]]
