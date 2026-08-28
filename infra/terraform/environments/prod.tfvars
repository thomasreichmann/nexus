# Prod runs in us-east-1 for now: multi-region (sa-east-1, closer to the Brazil
# alpha testers) is deferred until we validate whether the latency win justifies
# the ~3.2x Glacier Deep Archive cost markup in South America. Keeping prod in the
# default US region matches dev and keeps storage economics healthy. Revisit
# multi-region later; uploads go browser -> S3 directly (#53, #290).
environment          = "prod"
region               = "us-east-1"
app_domain           = "nexus.thomasar.dev"
cors_allowed_origins = ["https://nexus.thomasar.dev"]
alert_email          = "thomasalmeidar@gmail.com"

# Worker notifications (#425). Both values are public — the from-address is in
# every email header, and a PostHog project key is the write-only ingestion key
# the browser bundle already carries — so they live here rather than behind a
# TF_VAR. posthog_key is the prod value of NEXT_PUBLIC_POSTHOG_KEY in Vercel;
# left empty the worker simply never reports.
resend_from_email = "noreply@nexus.thomasar.dev"
posthog_key       = ""

# database_url and resend_api_key are intentionally absent: pass via
# TF_VAR_database_url (the prod Supabase transaction-pooler URL, port 6543) and
# TF_VAR_resend_api_key. Never commit them.
