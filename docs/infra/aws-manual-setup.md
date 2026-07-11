---
title: AWS Manual Setup
created: 2026-01-23
updated: 2026-07-11
status: superseded
tags:
    - infra
    - aws
aliases:
    - AWS Manual Setup
ai_summary: 'Superseded pointer — all AWS provisioning (dev and prod) lives in infra/terraform'
---

# AWS Manual Setup (superseded)

Nothing is provisioned by hand anymore. Both environments — S3 files bucket,
lifecycle/CORS/notifications, SNS restore-events topic + webhook subscription,
SQS queues + DLQs, worker Lambda, and IAM — are defined in
[`infra/terraform/`](../../infra/terraform/README.md), parameterized by
`environment` (#53 prod, #127 dev).

The hand-built dev resources this runbook used to document were
decommissioned and recreated from the Terraform modules in #127. For
operational commands (worker deploys, DLQ inspection, logs), see
[[../guides/background-jobs|Background Jobs Runbook]]; for webhook behavior,
[[../guides/webhooks|Webhook Handling]].
