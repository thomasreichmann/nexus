---
title: AI Documentation
created: 2025-12-29
updated: 2025-12-29
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

## Purpose

This folder contains context and instructions that help AI:

- Understand the project instantly
- Generate code matching project patterns
- Follow naming conventions automatically
- Avoid deprecated approaches
- Maintain context across sessions

## Documents

### Core Context

- [[context|Project Context]] - Detailed background, business logic, data model
- [[conventions|Conventions]] - Naming, structure, style rules
- [[patterns|Code Patterns]] - Implementation examples to follow

### Workflow

- [[changelog|AI Changelog]] - Recent changes (read first for context)
- [[prompts|Useful Prompts]] - Templates for common tasks

## Quick Start for AI

1. **Read `CLAUDE.md`** (repo root) for quick project overview
2. **Check `changelog.md`** for recent changes and context
3. **Reference `patterns.md`** when generating code
4. **Follow `conventions.md`** for naming and structure

## Root Files

| File           | Purpose                      |
| -------------- | ---------------------------- |
| `CLAUDE.md`    | Claude Code reads this first |
| `.cursorrules` | Cursor IDE context           |

## Related

- [[index|Back to Index]]
- [[architecture/_index|Architecture]]
- [[guides/_index|Guides]]
