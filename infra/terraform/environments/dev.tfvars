# Dev shares prod's region and module set (#127); only names (-dev suffix),
# CORS, and the webhook endpoint differ. app_domain is dev.nexus.thomasar.dev:
# a Cloudflare CNAME → Vercel custom domain pinned to the long-lived `dev`
# branch (post-merge keeps it synced with main), which serves the Preview tier
# — dev Supabase + dev AWS env vars. The SNS subscription reaches this endpoint
# with no bypass token because Vercel Authentication is OFF on the nexus-web
# project: pinning a custom domain to a preview branch does NOT exempt it (only
# the production domain is exempt), and the Hobby plan has no per-domain
# exception, so #317 disabled deployment protection project-wide and retired the
# project-wide Protection Bypass token the old *.vercel.app URL depended on.
environment = "dev"
region      = "us-east-1"
app_domain  = "dev.nexus.thomasar.dev"

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

# database_url is intentionally absent: pass via TF_VAR_database_url (the dev
# Supabase transaction-pooler URL, port 6543). Never commit it.
