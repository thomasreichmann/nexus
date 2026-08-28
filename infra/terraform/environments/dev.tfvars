# Dev shares prod's region and module set (#127); only names (-dev suffix),
# CORS, and the webhook endpoint differ. app_domain is dev.nexus.thomasar.dev:
# a Cloudflare CNAME → Vercel custom domain pinned to the long-lived `dev`
# branch (post-merge keeps it synced with main), which serves the Preview tier
# — dev Supabase + dev AWS env vars. The ops-alerts subscription reaches it
# with no bypass token because Vercel Authentication is OFF on the nexus-web
# project: pinning a custom domain to a preview branch does NOT exempt it (only
# the production domain is exempt), and the Hobby plan has no per-domain
# exception, so #317 disabled deployment protection project-wide and retired the
# project-wide Protection Bypass token the old *.vercel.app URL depended on.
environment = "dev"
region      = "us-east-1"
app_domain  = "dev.nexus.thomasar.dev"

# Inert here — dev alarms notify Discord only (see alarms.tf) — but required.
alert_email = "thomasalmeidar@gmail.com"

# The dev-branch deployment also carries a branch-scoped NEXT_PUBLIC_APP_URL
# (Vercel Preview tier, git branch "dev") pointing at this same domain, so links
# in dev-triggered emails (e.g. restore-completed) don't say localhost like
# ordinary previews do.

# Local dev + every Vercel preview deployment may talk to the dev bucket.
cors_allowed_origins = [
  "http://localhost:*",
  "http://127.0.0.1:*",
  "https://*.vercel.app",
]

# Worker notifications (#425). Both values are public — the from-address is in
# every email header, and posthog_key is the write-only ingestion key the
# browser bundle already carries (it is literally readable from the deployed
# page source) — so they live here rather than behind a TF_VAR. Same key as
# prod on purpose: one PostHog project serves both, and ANALYTICS_ENVIRONMENT
# in lambda.tf is what separates their events, the same way VERCEL_ENV does for
# the app.
resend_from_email = "noreply@nexus.thomasar.dev"
posthog_key       = "phc_zQAczyqqiupW6zDxQ6i28Ez4oWpKR6r9QMfo8SX3pxxE"

# database_url and resend_api_key are intentionally absent: pass via
# TF_VAR_database_url (the dev Supabase transaction-pooler URL, port 6543) and
# TF_VAR_resend_api_key. Never commit them.
