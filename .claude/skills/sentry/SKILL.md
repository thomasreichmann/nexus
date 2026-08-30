---
name: sentry
description: Query Sentry issues and events from the CLI — org defaults, the REST detail lookup, and auth-token gotchas. Use when investigating errors, alerts, or crash reports in Sentry.
---

# Sentry queries

`sentry-cli` is installed and authenticated with a user token; org and project
defaults live in `~/.sentryclirc`, so no flags are needed:

```bash
sentry-cli issues list --query "environment:preview"   # prod uses environment:production
sentry-cli events list --max-rows 20
```

Issue detail (stack trace, the `cause` chain, event count) needs the REST API:
`curl -H "Authorization: Bearer $(grep token= ~/.sentryclirc | cut -d= -f2)" \
  https://sentry.io/api/0/issues/<id>/events/latest/`.

Do not use the `sntrys_` token in Vercel env — it is a CI token for source-map
upload and 403s on every read endpoint. `SENTRY_AUTH_TOKEN` in the environment
overrides `~/.sentryclirc`, so don't source repo env files before querying.
