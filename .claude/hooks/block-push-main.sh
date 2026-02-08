#!/bin/bash
# Block git push commands that target main or master branches.
# Catches: git push origin main, git push -u origin master, git push --force origin main

COMMAND=$(jq -r '.tool_input.command' < /dev/stdin)

if echo "$COMMAND" | grep -qE '\bgit\s+push\b.*\b(main|master)\b'; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Pushing directly to main/master is not allowed. Use a PR instead."
    }
  }'
fi
