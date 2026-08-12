---
title: Uptime Monitoring
created: 2026-08-12
updated: 2026-08-12
status: active
tags:
    - infra
    - monitoring
    - observability
aliases:
    - Uptime Monitoring
    - Health Check
ai_summary: 'How the deployed app is uptime-monitored: /api/health + the scheduled Uptime workflow'
---

# Uptime Monitoring

How the deployed app is monitored for availability. Created 2026-08-12 (#333, part of #326).

## What exists

| Piece                | Location                                 | Role                                                                              |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| Health endpoint      | `apps/web/app/api/health/route.ts`       | `GET /api/health` — 200 + `{ status, checks }` when the DB is reachable, 503 else |
| Pinger               | `.github/workflows/uptime.yml`           | Scheduled GET against prod + dev every ~15 min; a failed run is the alert         |
| Discord notification | `DISCORD_ALERT_WEBHOOK_URL` repo secret  | Posted by the workflow's `Notify Discord` step on failure                         |
| Email notification   | GitHub's built-in workflow-failure email | Sent to the workflow author on scheduled-run failure                              |

Monitored URLs:

- prod: `https://nexus.thomasar.dev/api/health`
- dev: `https://dev.nexus.thomasar.dev/api/health` (public since Vercel protection was disabled project-wide, #317/#320)

## Why this shape

The other scheduled checks ([[supabase-manual-setup|Supabase keepalive]], `s3-event-health.yml`) connect to the DB or AWS **directly from GitHub Actions** — a full app outage leaves all of them green. The Uptime workflow is the only check that goes through the deployed app over the public internet.

No third-party pinger (UptimeRobot/BetterStack were considered and rejected — no new external services). The known trade-off: this monitor is blind if GitHub Actions itself is down, and scheduled runs can be delayed under load, so treat detection latency as 15–30 min.

The workflow's Discord step is raw `curl`, not the shared `lib/alerts` module the other scheduled checks use — deliberately. Going through `lib/alerts` requires checkout + Node + pnpm install, and an outage alert must not depend on the repo toolchain being healthy. The cost is cosmetic: uptime alerts post as plain text instead of the styled embed every other alert gets.

> [!important] Escalation path is in-house, not SaaS.
> If monitoring must ever survive an Actions outage, build a small pinger in AWS via the existing `infra/` Terraform setup and the monorepo — do not add a third-party service.

## The health endpoint

`GET /api/health` is unauthenticated (the `proxy.ts` matcher only covers `/dashboard/*` and the auth pages) and `force-dynamic`. It runs `select 1` through the app's own drizzle connection (transaction pooler), so a green response means the deployed app can reach its database — not just that Vercel served a page.

Response bodies are deliberately generic (`ok`/`down` per check, nothing else): the route is public, so no driver errors, hostnames, or timing details. A 503 is expected control flow — it logs via `logger` but does not report to Sentry or `lib/alerts`; during a real outage the app can't deliver either, which is the whole reason the pinger is external to the app.

S3 is not checked here (kept DB-only for speed and fewer false 503s); tier drift and event-pipeline health have their own nightly workflow.

## Changing the monitor

Everything lives in `.github/workflows/uptime.yml`:

- **Cadence**: the `cron` expression (nominal `*/15`).
- **URLs / environments**: the job matrix.
- **Timeout / retries**: the retry loop in the `GET` step (3 attempts, `--max-time 30` each, 10s apart) — transient blips retry before a run fails. Each attempt logs one line (HTTP status + latency); a failed run also gets an `::error` annotation and a step summary on the run page.
- **Discord**: the `DISCORD_ALERT_WEBHOOK_URL` repo secret (shared with `s3-event-health.yml`); unset degrades to a no-op.
- **Email**: GitHub notifies the workflow author when a scheduled run fails, per their GitHub notification settings — no config in-repo.
- **Manual run**: `workflow_dispatch` (Actions tab → Uptime → Run workflow), or `gh workflow run uptime.yml`.

During an outage the workflow alerts once per run per environment (no dedup/cooldown); at the current cadence that's up to ~4 Discord messages an hour per environment until resolved or the schedule is paused (Actions tab → Uptime → ⋯ → Disable workflow).

## Related

- [[supabase-manual-setup|Supabase Manual Setup]] — DB secrets the other scheduled checks depend on
- [[aws-manual-setup|AWS Manual Setup]] — AWS-side manual configuration
