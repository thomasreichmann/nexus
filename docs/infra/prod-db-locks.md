---
title: Prod DB Locks
created: 2026-10-20
updated: 2026-10-20
status: active
tags:
    - infra
    - database
    - runbook
aliases:
    - Migration blocked on a lock
    - Lock holder
ai_summary: 'Runbook: find and end the session holding a lock a prod migration needs, then re-run it'
---

# Prod DB Locks

What to do when a migration can't get its lock. Created 2026-10-20 (#555),
after #550's migration hit one on prod.

## How it shows up

`pnpm -F db db:migrate` gives each attempt 3 s to get its locks
(`LOCK_TIMEOUT` in `packages/db/src/scripts/migrateWithLockRetry.ts`), then
retries after 10 s, 30 s and 60 s. A lock held through all four attempts fails
the run:

```
Attempt 1 waited 3s for a lock and gave up; retrying in 10s
…
Migration failed: Failed query: ALTER TABLE "files" ADD COLUMN …
  cause: canceling statement due to lock timeout
Still blocked on a lock after 4 attempts. Find who holds it: docs/infra/prod-db-locks.md
```

Post-merge then posts **Post-merge migration failed** to Discord. Act quickly:

- Vercel deploys `main` independently of the migration (#556), so prod may
  already be serving code that needs the migration. If prod pages are
  failing, roll back first with `vercel rollback`, which returns production
  to the previous deployment. Then free the lock.
- A lock held for minutes usually belongs to a session nobody is waiting on
  anymore.

## Get a SQL prompt on prod

Vercel stores prod's `DATABASE_URL` as a sensitive variable, so `vercel env pull`
returns it empty. Go through Supabase's Management API instead. All it needs is
a personal access token, either:

- the one `supabase login` saved in `~/.supabase/access-token`, or
- one created under Dashboard → Account → Access Tokens.

```bash
export SUPABASE_ACCESS_TOKEN=$(< ~/.supabase/access-token)
PROD_REF=$(supabase projects list -o json | jq -r '.[] | select(.name == "nexus-prod") | .id')

prod_sql() {
    jq -n --arg query "$1" '{query: $query}' |
        curl --silent --show-error \
            -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
            -H 'Content-Type: application/json' \
            -d @- "https://api.supabase.com/v1/projects/$PROD_REF/database/query" |
        jq .
}
```

The API runs each query as `postgres`, so it can see and end every app session.

## Find the holder

The failed statement names the table. To see who holds a lock on it (`files`
here):

```bash
prod_sql "select a.pid, a.usename, a.application_name, a.state, a.wait_event,
                 a.backend_start, a.xact_start, now() - a.xact_start as open_for,
                 l.mode, left(a.query, 200) as query
          from pg_locks l join pg_stat_activity a using (pid)
          where l.relation = 'public.files'::regclass and l.granted
            and a.pid <> pg_backend_pid()
          order by a.xact_start"
```

To list every transaction open longer than a minute, whatever it locks:

```bash
prod_sql "select pid, usename, application_name, state, wait_event,
                 now() - xact_start as open_for, left(query, 200) as query
          from pg_stat_activity
          where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid()
          order by xact_start"
```

## Decide, then end it

App queries take milliseconds, so a transaction open for minutes is almost
never doing useful work. Through Supavisor, `application_name` is `Supavisor`
for every app session, so the query text and state are what tell you where it
came from.

| State and wait event                      | Usually means                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active` / `ClientRead`, old `xact_start` | The client sent the first half of a query and disappeared. #550's holder was this: a cold-start check left a query running on a Vercel instance that then froze (#554). Postgres never times this out, so end it. |
| `idle in transaction`                     | A client opened a transaction and never finished it. It's safe to end once you've checked the query isn't a deploy or a script someone is running.                                                                |
| `active`, no wait event                   | A long query that is really running. Find out what it is before ending it, or wait it out and re-run the migration.                                                                                               |

```bash
prod_sql "select pg_terminate_backend(<pid>)"
```

Run the holder query again: no rows means the lock is free.

## Re-run and recover

1. Re-run the failed jobs:
   `gh run rerun <run-id> --failed`. The prod worker deploy waits for the prod
   migration, so it goes out on this re-run as well.
2. Check the column, index or table landed:
   `prod_sql "select column_name from information_schema.columns where table_name = 'files'"`.
3. If you rolled Vercel back while the migration was missing, put the new
   deployment back with `vercel promote <deployment-url>`, then check
   `https://nexus.thomasar.dev/api/health`.

## Related

- [[supabase-manual-setup|Supabase Manual Setup]]: projects, pooler and secrets
- [[../ai/conventions#DB Migrations (Expand/Contract)|Conventions: DB Migrations]]
