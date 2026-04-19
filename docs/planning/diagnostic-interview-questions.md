# Diagnostic Interview Questions

**Use:** Run these interviews IF the kill criterion in `docs/planning/validation-plan.md` fires at week 6 — to understand _why_ before deciding pivot/shutdown/continue.

**Pre-commitment:** These questions are written before talking to any tester. They are not to be edited mid-test or "improved" after seeing early results — that defeats the purpose. Edit only between full test cycles.

## Design principles

- **Behavior, not opinion.** "Walk me through the last time you..." beats "Do you think...". People lie about opinions; they describe behavior accurately.
- **Past-tense, not hypothetical.** "What did you do" beats "What would you do."
- **Open, not leading.** "Tell me about..." beats "Did you find X frustrating?"
- **Don't ask for product validation directly.** No "would you pay," no "would you recommend." The signal is in their actual behavior during the test, not their stated intention.

## Format

- 30-45 minutes per tester
- 1-on-1, synchronous (video or in person)
- Recorded with consent
- One interview per cohort tester

## Script

### Opening (2 min)

> "Thanks for trying Nexus over the past 6 weeks. I want to understand what your experience was — not just whether you liked it, but what actually happened in your day-to-day. Some questions might feel obvious, that's fine. Honest answers are more valuable to me than nice ones. There are no wrong answers."

### Section A — Workflow baseline (5 min)

1. Walk me through what happens after you finish a shoot, from card to client delivery.
2. Where did your last 3 shoots end up — physically and digitally?
3. When was the last time, before this test, that you needed to find an old shoot? Walk me through what you did.

### Section B — Actual use of Nexus (10 min)

4. When was the last time you used Nexus? Walk me through what you did.
5. What's the most recent shoot you uploaded to it?
6. _(If they uploaded recent shoots)_ What made you choose Nexus for that one?
7. _(If they didn't upload recent shoots)_ What did you do with [last shoot] instead? Why?
8. Was there a shoot during this test where you thought about uploading to Nexus but didn't? What happened?

### Section C — Trust check (5 min)

9. After you uploaded, did you delete the original from your drive? Why or why not?
10. If your computer died tomorrow, what would you do? Where would you start?
11. Is there a kind of file you'd never put in Nexus? Why?

### Section D — Social / referral (5 min)

12. Have you talked about Nexus with anyone since starting the test? What did you say?
13. _(If yes)_ What was their reaction? Did they ask follow-up questions?
14. _(If no)_ What stopped you?
15. Who's one photographer you know who you would NOT recommend Nexus to, and why?

### Section E — The "almost" zone (5 min)

16. What's the one thing that would have to be true for Nexus to become the default place your new shoots go?
17. What's the one thing that would make you delete the local copy after uploading, every time?
18. Was there a moment during the test where you almost stopped using it? What was happening?

### Section F — Context check (5 min)

19. How was the past 6 weeks workload-wise — normal, unusually busy, unusually light?
20. Anything else about Nexus or the test you want to tell me that I haven't asked about?

## Interviewer rules

- **No follow-ups that reveal the answer you want.** Bad: "...because the upload was slow, right?" Good: "Tell me more about that."
- **Long pauses are OK.** Don't fill silence. Let them think.
- **Take notes verbatim where possible.** Direct quotes are gold; your paraphrasing is biased.
- **Don't defend the product.** Even if they say something wrong or unfair, do not argue. You are collecting data, not selling.
- **Don't promise to fix anything.** "That's interesting, tell me more" — never "we'll add that."

## What NOT to ask

- "Do you like the product?" — worthless signal
- "Would you pay $X?" — people lie about hypothetical money
- "What features should we build?" — premature wish-list, not signal

## After the interviews

Synthesize across all cohort interviews:

- Are there shared themes (e.g., all testers cited the same friction)?
- Did external context explain the failure (e.g., everyone had a slow shooting period)?
- Is there a single, specific, fixable blocker?

Use these findings to make the kill-criterion decision: continue (only with named finding), pivot ICP, or shut down. There is no fourth option of "wait and see."
