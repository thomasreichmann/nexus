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
# every email header, and posthog_key is the write-only ingestion key the
# browser bundle already carries (it is literally readable from the deployed
# page source) — so they live here rather than behind a TF_VAR. One PostHog
# project serves both environments; ANALYTICS_ENVIRONMENT in lambda.tf is what
# separates their events, the same way VERCEL_ENV does for the app.
resend_from_email = "noreply@nexus.thomasar.dev"
posthog_key       = "phc_zQAczyqqiupW6zDxQ6i28Ez4oWpKR6r9QMfo8SX3pxxE"

# CloudFront URL-signing key, public half (#345). The private half was generated
# alongside it (README.md "CloudFront signing key") and lives only in the app's
# env as CLOUDFRONT_PRIVATE_KEY.
cloudfront_public_key_pem = <<-EOT
  -----BEGIN PUBLIC KEY-----
  MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAynnTJrVMN7j3rfBwxsJJ
  E1b5znZcEB3BSfFmEUEpFGxfMtRxDiurjlf/cA0f9XDQFq8yRCi9SrsIiJV4J4Ll
  pp1a7XAn+GYKl9i6yiK778++a4QTb3Qe55TrHCWdFBSs8yOmQRLR4DXkNeU9/MRA
  inyYJu7bZYXOZesGCEyoKETulDFf9PQXRdjrwN1qJZJVRI7Bt0TiDlo5HleWwXOL
  kRW/0prMGU0sFSvvQFAyTEYH/cGSKPMnz3gGEe75cs/rndiRrETi2nmPT2go/Hut
  NR+qBP+a2OTJaOZaXJnQ/ACyk38JLxPs1DhsIOo3mDFof3YAHKQj2l5i1IjCH4Am
  KQIDAQAB
  -----END PUBLIC KEY-----
  EOT

# database_url and resend_api_key are intentionally absent: pass via
# TF_VAR_database_url (the prod Supabase transaction-pooler URL, port 6543) and
# TF_VAR_resend_api_key. Never commit them.
