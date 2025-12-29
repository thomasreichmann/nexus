---
title: Planning
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - planning
  - moc
aliases:
  - Planning Index
---

# Planning

MVP planning, roadmap, and project phases for Nexus.

## Documents

- [[mvp-notes|MVP Planning Notes]] - Initial architecture considerations and decisions
- [[roadmap|Project Roadmap]] - Development phases and milestones

## Project Status

**POC:** Completed - proved S3 cold storage upload/retrieval works
**Current Phase:** MVP Planning & Development

## Dataview

```dataview
TABLE status, file.mtime as "Updated"
FROM "planning"
WHERE file.name != "_index"
SORT file.mtime DESC
```

## Related

- [[index|Back to Index]]
- [[architecture/_index|Architecture]]
