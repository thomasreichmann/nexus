---
title: Dev Journal
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - journal
  - moc
aliases:
  - Daily Notes
  - Dev Log
---

# Dev Journal

Daily development notes, progress tracking, and learnings.

## Purpose

- Track daily progress and blockers
- Document decisions made during development
- Capture learnings and discoveries
- Maintain context across sessions

## Creating Daily Notes

Use the [[daily-note-template|Daily Note Template]] or configure Obsidian's Daily Notes core plugin:

1. Settings → Core plugins → Daily notes
2. Set template: `templates/daily-note-template`
3. Set folder: `journal`
4. Use hotkey or click calendar

## Recent Entries

```dataview
TABLE file.ctime as "Date"
FROM "journal"
WHERE file.name != "_index"
SORT file.name DESC
LIMIT 10
```

## This Week

```dataview
LIST
FROM "journal"
WHERE file.name != "_index" AND file.cday >= date(today) - dur(7 days)
SORT file.name DESC
```

## Related

- [[index|Back to Index]]
