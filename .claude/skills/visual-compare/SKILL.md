---
name: visual-compare
description: Visually compare design options (colors, tokens, variants) in a live preview
argument-hint: [what to compare]
allowed-tools: Task, AskUserQuestion
---

# Visual Compare

Two-phase workflow. AskUserQuestion does not work reliably in subprocess agents, so the main thread handles user interaction.

## Phase 1: Generate Options (subprocess)

Use the Task tool to spawn the comparison agent:

- **subagent_type:** `visual-compare-agent`
- **prompt:** `$ARGUMENTS`

The agent will research the target CSS variable, generate 4 options, write them to the preview page (`data.json`), and return a structured summary with the option labels and descriptions.

## Phase 2: User Picks (main thread)

After the subprocess returns:

1. Tell the user to check **http://localhost:3000/dev/preview** to compare visually
2. Use **AskUserQuestion** with the option labels from the subprocess summary
3. If user picks "Other", re-run Phase 1 with adjusted prompt

## Phase 3: Apply Choice (resume subprocess)

Resume the same agent using the Task tool's `resume` parameter:

- **resume:** the agent ID from Phase 1
- **prompt:** `User chose: <selected option label>. Apply the value to the target CSS file, clean up data.json, and return a final summary.`

Report the final summary back to the user.

## Autonomous Mode (programmatic use)

When another agent invokes visual-compare-agent with `autonomous: true`, the entire flow collapses into a single Task invocation — no user interaction or resume needed.

```
Task tool call:
  subagent_type: visual-compare-agent
  prompt: |
    Compare CSS variable options:
    - variable: --destructive
    - file: apps/web/app/globals.css
    - mode: dark
    - context: error states and destructive action buttons
    - autonomous: true
```

The agent generates options, picks the best fit, applies it, cleans up data.json, and returns a `CHOSEN: / APPLIED:` summary. See the agent definition for full details on selection criteria and return format.
