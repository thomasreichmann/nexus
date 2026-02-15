---
title: Guides
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
    - guide
    - moc
aliases:
    - Guides Index
---

# Guides

Technical documentation, setup guides, and implementation patterns for the Nexus project.

## Documents

- [[getting-started|Getting Started]] - Development environment setup
- [[nextjs-patterns|Next.js Patterns]] - Implementation patterns and best practices
- [[logging|Logging]] - Server and client-side logging with pino
- [[lambda-development|Lambda Development]] - Lambda worker conventions and SQS job processing
- [[background-jobs|Background Jobs Runbook]] - AWS resource ARNs, deployment, and operations
- [[webhooks|Webhook Handling]] - Webhook handler architecture, idempotency, and testing patterns

## Dataview

```dataview
TABLE status, file.mtime as "Updated"
FROM "guides"
WHERE file.name != "_index"
SORT file.mtime DESC
```

## Related

- [[index|Back to Index]]
- [[architecture/_index|Architecture]]
