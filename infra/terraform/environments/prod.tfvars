# Prod runs in us-east-1 for now: multi-region (sa-east-1, closer to the Brazil
# alpha testers) is deferred until we validate whether the latency win justifies
# the ~3.2x Glacier Deep Archive cost markup in South America. Keeping prod in the
# default US region matches dev and keeps storage economics healthy. Revisit
# multi-region later; uploads go browser -> S3 directly (#53, #290).
environment          = "prod"
region               = "us-east-1"
app_domain           = "nexus.thomasar.dev"
cors_allowed_origins = ["https://nexus.thomasar.dev"]

# database_url is intentionally absent: pass via TF_VAR_database_url (the prod
# Supabase transaction-pooler URL, port 6543). Never commit it.
