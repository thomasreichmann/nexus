# Dev shares prod's region and module set (#127); only names (-dev suffix),
# CORS, and the webhook endpoint differ. The app_domain is the stable Vercel
# branch URL for the long-lived `dev` branch (post-merge keeps it synced with
# main), which serves the Preview tier — dev Supabase + dev AWS env vars.
# Vercel deployment protection covers *.vercel.app URLs, so the SNS
# subscription needs the protection-bypass token: pass it via
# TF_VAR_webhook_bypass_query="?x-vercel-protection-bypass=<token>".
# Never commit the token (Vercel dashboard: nexus-web > Settings >
# Deployment Protection > Protection Bypass for Automation).
environment = "dev"
region      = "us-east-1"
app_domain  = "nexus-web-git-dev-thomasreichmanns-projects.vercel.app"

# The dev-branch deployment also carries a branch-scoped NEXT_PUBLIC_APP_URL
# (Vercel Preview tier, git branch "dev") pointing at this same URL, so links
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
