# Prod is sa-east-1: the alpha testers are in Brazil, the prod Supabase project
# is in sa-east-1, and uploads go browser -> S3 directly (#53, #290).
environment          = "prod"
region               = "sa-east-1"
app_domain           = "nexus.thomasar.dev"
cors_allowed_origins = ["https://nexus.thomasar.dev"]

# database_url is intentionally absent: pass via TF_VAR_database_url (the prod
# Supabase transaction-pooler URL, port 6543). Never commit it.
