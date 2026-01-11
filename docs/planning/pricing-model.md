# Pricing Model

## Decisions Summary

| Decision | Choice |
|----------|--------|
| Tier structure | 3 fixed tiers + Enterprise |
| Free tier | No (30-day free trial instead) |
| Retrieval model | Unlimited (baked into price) |
| Annual discount | ~17% (2 months free) |
| Enterprise features | SSO, audit logs, SLAs, dedicated support, usage-based option |

## Market Research

### Competitor Landscape

| Provider | Price/TB | Retrieval | Target User |
|----------|----------|-----------|-------------|
| Google Drive | $5/TB | Instant | Consumer |
| Dropbox | $6/TB | Instant | Consumer |
| iCloud | $5/TB | Instant | Consumer |
| Backblaze B2 | $6/TB | Instant | Developer (S3 API) |
| Wasabi | $7/TB | Instant | Developer (S3 API) |
| **AWS Glacier DA** | $1/TB | 12-48h | Developer |

**Market gap:** No consumer-friendly archival storage exists. Developer options (B2, Wasabi) require S3 API knowledge. Consumer options (Google, Dropbox) are instant-access at premium prices.

**Our position:** Consumer-friendly interface + archival pricing = unique value prop.

## AWS Cost Breakdown

### Base Costs (S3 Glacier Deep Archive, US East)

| Component | Cost |
|-----------|------|
| Storage | $0.00099/GB/month (~$1/TB) |
| PUT/COPY/POST requests | $0.05 per 1,000 |
| Bulk retrieval (12-48h) | $0.0025/GB |
| Standard retrieval (3-5h) | $0.02/GB |
| Metadata overhead | 40KB/object (8KB Standard + 32KB Deep Archive) |
| Minimum storage | 180 days |

### Assumptions

| Parameter | Starter | Pro | Max |
|-----------|---------|-----|-----|
| Storage | 1 TB | 5 TB | 10 TB |
| Average file size | 10 MB | 10 MB | 10 MB |
| Files at capacity | 100,000 | 500,000 | 1,000,000 |
| Monthly retrieval % | 10% | 5% | 5% |
| Retrieval volume/mo | 100 GB | 250 GB | 500 GB |

### Per-Tier AWS Cost Calculation

**Starter (1TB)**
```
Storage:     1000 GB × $0.00099   = $0.99/month
Metadata:    ~4 GB × $0.001       = $0.004/month
Retrieval:   100 GB × $0.0025     = $0.25/month
─────────────────────────────────────────────────
Ongoing total:                      $1.25/month

One-time upload: 100k × $0.05/1000 = $5.00
```

**Pro (5TB)**
```
Storage:     5000 GB × $0.00099   = $4.95/month
Metadata:    ~20 GB × $0.001      = $0.02/month
Retrieval:   250 GB × $0.0025     = $0.63/month
─────────────────────────────────────────────────
Ongoing total:                      $5.60/month

One-time upload: 500k × $0.05/1000 = $25.00
```

**Max (10TB)**
```
Storage:     10000 GB × $0.00099  = $9.90/month
Metadata:    ~40 GB × $0.001      = $0.04/month
Retrieval:   500 GB × $0.0025     = $1.25/month
─────────────────────────────────────────────────
Ongoing total:                      $11.19/month

One-time upload: 1M × $0.05/1000 = $50.00
```

## Final Pricing

### Recommended: $3 / $12 / $20

| Tier | Storage | Monthly | Annual | Per TB | Margin | vs Google Drive |
|------|---------|---------|--------|--------|--------|-----------------|
| Starter | 1 TB | $3 | $30 | $3.00 | 2.4x | 40% cheaper |
| Pro | 5 TB | $12 | $120 | $2.40 | 2.1x | 52% cheaper |
| Max | 10 TB | $20 | $200 | $2.00 | 1.8x | 60% cheaper |

**Why this pricing:**
- Progressive value rewards upgrades ($/TB decreases at higher tiers)
- 1.8-2.4x margin is sustainable for growth phase
- Entry point ($3) is low enough for casual users to try
- Power users save more, incentivizing higher tiers
- "Up to 60% cheaper" is compelling marketing copy

### Margin Analysis

| Tier | AWS Cost | Price | Margin | Gross Profit |
|------|----------|-------|--------|--------------|
| Starter | $1.25 | $3 | 2.4x | $1.75/user/mo |
| Pro | $5.60 | $12 | 2.1x | $6.40/user/mo |
| Max | $11.19 | $20 | 1.8x | $8.81/user/mo |

## Risk Scenarios

### Heavy Retrieval User

If a user retrieves 50% of storage monthly:
```
Starter: 500GB × $0.0025 = $1.25 additional → total cost $2.50 (still profitable)
Pro:     2.5TB × $0.0025 = $6.25 additional → total cost $11.85 (barely profitable)
Max:     5TB × $0.0025   = $12.50 additional → total cost $23.69 (LOSS of $3.69)
```

**Mitigation:** Monitor retrieval patterns. Consider soft limits or fair-use policy if abuse detected.

### Small Files Problem

If average file size is 1MB instead of 10MB (10x more objects):
```
Starter: 1M files × $0.05/1000 = $50 upload cost (vs $5)
Pro:     5M files × $0.05/1000 = $250 upload cost (vs $25)
Max:     10M files × $0.05/1000 = $500 upload cost (vs $50)
```

**Mitigation:** Consider minimum file size recommendation (5MB+) or auto-bundling small files.

### 180-Day Minimum Storage

Files deleted before 180 days still incur full 180-day storage charge.
- Early churn is costly (user pays $3, we pay $6 in storage)
- Refund policy: No refunds for deleted files (cover in ToS)
- Consider: Require credit card for free trial to reduce tire-kickers

## Tier Definitions

### Starter ($3/month, $30/year)

- 1 TB storage
- Unlimited uploads
- Unlimited retrievals (12-48h)
- End-to-end encryption
- Email support
- 30-day free trial

### Pro ($12/month, $120/year)

- 5 TB storage
- Unlimited uploads
- Unlimited retrievals (12-48h)
- End-to-end encryption
- Priority email support
- 30-day free trial

### Max ($20/month, $200/year)

- 10 TB storage
- Unlimited uploads
- Unlimited retrievals (12-48h)
- End-to-end encryption
- Priority email support
- 30-day free trial

### Enterprise (Contact Sales)

- Custom storage (20TB+)
- Usage-based pricing option
- SSO / SAML
- Audit logs
- SOC 2 report access
- Custom retention policies
- Dedicated support
- SLA guarantees (99.9% uptime)
- Expedited retrieval option (3-5h)

## Frontend Messaging Updates

### Hero Section
- **Old:** "just $1/TB/month"
- **New:** "Up to 60% cheaper than traditional cloud storage"

### Features Section
- **Old:** "90% cost savings" / "Pay $1/TB/month"
- **New:** "Up to 60% cheaper" / "Starting at $3/month for 1TB"

### Retrieval Time
- **Old:** "3-12 hour retrieval"
- **New:** "12-48 hour retrieval" (accurate for Glacier Deep Archive bulk)

### Pricing Cards
Update to reflect new 3-tier structure with accurate storage amounts and prices.

## Open Questions

1. Credit card required for free trial? (Recommend: Yes, to reduce abuse)
2. Storage add-ons between tiers? (e.g., +1TB for $2/mo)
3. Should Max tier have any additional features beyond storage?
