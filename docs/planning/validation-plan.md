# Validation Plan: Photographer Beta Test

**Locked:** 2026-04-19
**Tester #1 onboarding target:** 2026-04-28
**Decision date:** 2026-06-09 (6 weeks after onboarding)

## Purpose

Test whether Nexus solves a real archival need for working photographers — not by asking them, but by observing whether their behavior changes. Avoid the failure mode of polite friend-feedback masquerading as validation.

## Hypothesis

Within 8 weeks of onboarding, photographers using Nexus will:

1. Integrate it into their **active** workflow — uploading recent shoots, not just legacy archive
2. Become emotionally invested enough to **volunteer feature wishes** ("I wish it had X")
3. **Refer other photographers without being asked**, generating inbound interest from people I didn't recruit

If all three happen, the product has earned trust and workflow integration. If none happen, the product is being politely tolerated, not used.

## Cohort

- **Tester 0 (mother):** Proof-of-concept user. Real ICP pain (15 years of shoots on closet drives, prior near-loss event). Trust her feedback on bugs, broken flows, and missing core features. Do **not** trust her feedback on prioritization, market signal, or willingness to pay — relationship bias makes those signals unreliable.
- **Validation cohort (target N=2):** Photographers recruited from her network, ideally friends-of-friends rather than direct friends. These are the data points the kill criterion measures against.

## Onboarding (per tester)

- 30-minute synchronous session (in person or screen-share)
- Watch them use it. Don't narrate. Note where they hesitate, what they skip, what they ask.
- This is the most information-dense data point you will ever get from each tester. Do not waste it on asynchronous setup-by-email.

## Weekly cadence

- One check-in per tester per week, for 8 weeks.
- Use a specific question, not "how's it going?":
    > "Did you shoot anything this week? Did it end up in Nexus? If not, where did it go?"
- Track every check-in in a per-tester log: date, observation, direct quotes when possible.

## Signals (measured against validation cohort, not tester 0)

| Signal               | Measurement                                                          |
| -------------------- | -------------------------------------------------------------------- |
| Workflow integration | At least one upload of files dated within last 30 days               |
| Emotional investment | Unprompted, substantive feature suggestion (not a surface complaint) |
| Unprompted referral  | At least one inbound contact saying "X told me about this"           |
| Active engagement    | More than one upload session per tester after week 1                 |

## Success bars

**Minimum (continue, with refinement):**

- 2 of 2 cohort testers upload at least one recent shoot
- 1 of 2 makes a substantive feature suggestion
- 1 unprompted referral leads to inbound contact

**Strong (clear go signal):**

- 2 of 2 upload recent shoots, multiple times
- Multiple feature wishes across testers
- 2+ unprompted referrals generating inbound interest

## Kill criterion

At **week 6**, if **0 of 2 cohort testers** have uploaded a recent shoot AND **0 unprompted referrals** have come through:

1. Pause all feature work immediately.
2. Spend exactly **2 weeks** on diagnostic interviews, using **pre-written questions** committed to before talking to any tester — no improvisation that lets you lead the witness.
3. After those 2 weeks, choose one of three:
    - **Continue** — only if interviews surface a specific finding that justifies it (e.g., "all cohort testers had unusually slow shooting weeks during the test" or "we identified a single UX blocker fixable in <1 week")
    - **Pivot the ICP** — try a different photographer segment or adjacent vertical
    - **Shut Nexus down**

There is no fourth option of "keep building features and check again later." If you find yourself wanting more time to interview, that's the answer.

## Decision date

**2026-06-09** is committed.

Tell at least one external person (a tester, a friend, a mentor) that this is the date. Social commitment removes the option to slip privately.

## What this test is NOT trying to validate

Surfaced and deferred during planning, so they don't sneak back in as scope creep:

- **Pricing optimization** — current $3/$12/$20 tiers are intentionally low to remove pricing as an objection; revisit after the test using observed retrieval data
- **Unit economics protection** (allowance/overage pricing) — worst-case AWS exposure at this scale is a rounding error; revisit at 50+ paying users
- **i18n / Portuguese localization** — testers are bilingual enough; revisit only if a tester explicitly asks
- **Folder / tag / label systems** beyond batch grouping — over-built without user pull

## Pre-test work

Required before onboarding tester #1:

- [ ] Batch primitive (upload session = batch, restore by batch) — see batch issue (TBD)
- [ ] Stripe test products configured for trial subscriptions
- [ ] Onboarding script (what you say in the first 30 minutes)
- [ ] Diagnostic interview questions written and committed — `docs/planning/diagnostic-interview-questions.md` (TBD)
- [ ] This validation plan reviewed and signed off
