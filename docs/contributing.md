---
title: Contributing Guide
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - meta
  - guide
aliases:
  - How to Contribute
  - Doc Guidelines
---

# Contributing to Documentation

Guidelines for contributing to the Nexus documentation vault.

## Quick Start

1. Open `/docs` folder as an Obsidian vault
2. Install required plugins (Dataview, Templater, Excalidraw)
3. Read this guide
4. Start writing!

## Folder Structure

| Folder | Purpose | Template |
|--------|---------|----------|
| `architecture/` | System design, tech decisions | `doc-template` |
| `decisions/` | Architecture Decision Records | `adr-template` |
| `guides/` | How-to documentation | `doc-template` |
| `journal/` | Daily dev notes | `daily-note-template` |
| `planning/` | Roadmap, MVP planning | `doc-template` |
| `resources/` | External links | `doc-template` |
| `templates/` | Document templates | — |

## Creating Documents

### Use Templates

Always use the appropriate template:

1. `Ctrl/Cmd + N` to create new note
2. Open command palette (`Ctrl/Cmd + P`)
3. Search "Templater: Insert template"
4. Select the right template

### Naming Conventions

| Type | Format | Example |
|------|--------|---------|
| Regular docs | `kebab-case.md` | `getting-started.md` |
| ADRs | `NNN-description.md` | `001-use-nextjs.md` |
| Daily notes | `YYYY-MM-DD.md` | `2025-01-15.md` |
| MOC files | `_index.md` | `_index.md` |

## Writing Style

### Frontmatter

Every document must have YAML frontmatter:

```yaml
---
title: Document Title
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft | active | archived
tags:
  - relevant-tag
aliases:
  - alternate-name
---
```

### Status Values

| Status | Meaning |
|--------|---------|
| `draft` | Work in progress, not ready for use |
| `active` | Current, maintained |
| `archived` | Historical, no longer maintained |

### Tags

Use existing tags when possible:

- `#architecture` - System design
- `#guide` - How-to docs
- `#planning` - Roadmap, planning
- `#decisions` / `#adr` - ADRs
- `#reference` - External resources
- `#journal` - Daily notes
- `#meta` - Docs about docs

Tech-specific: `#nextjs`, `#supabase`, `#aws`, `#stripe`

### Links

- **Internal links**: Use wikilinks `[[doc-name|Display Text]]`
- **Section links**: `[[doc-name#Section|Text]]`
- **External links**: Standard markdown `[text](url)`

### Callouts

Use Obsidian callouts for emphasis:

```markdown
> [!note]
> General information

> [!tip]
> Helpful advice

> [!warning]
> Caution required

> [!important]
> Critical information
```

## Updating Documents

1. Update the `updated:` date in frontmatter
2. Make your changes
3. Update [[changelog]] if significant
4. Commit with descriptive message

## Visual Tools

### Canvas

Use Canvas for high-level architecture boards:
- `Ctrl/Cmd + P` → "Create new canvas"
- Add cards, link to notes, draw connections
- Save in `architecture/` folder

### Excalidraw

Use Excalidraw for detailed diagrams:
- `Ctrl/Cmd + P` → "Excalidraw: Create new drawing"
- Hand-drawn style, great for flowcharts
- Save in `architecture/drawings/` folder
- Embed in notes: `![[drawing-name]]`

## Code Blocks

Use language hints for syntax highlighting:

````markdown
```typescript
const example = "code here";
```
````

## Review Checklist

Before committing:

- [ ] Frontmatter is complete
- [ ] Status is appropriate
- [ ] Tags are relevant
- [ ] Links work (no broken wikilinks)
- [ ] Code blocks have language hints
- [ ] Updated date is current

## Related

- [[index|Back to Index]]
- [[templates/doc-template|Doc Template]]
