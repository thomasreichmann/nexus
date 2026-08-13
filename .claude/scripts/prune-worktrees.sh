#!/usr/bin/env bash
# Teardown counterpart to .claude/hooks/worktree-setup.sh: report which linked
# worktrees are safe to remove, and (with --apply) remove them.
#
# A worktree is prunable only when all four hold:
#   1. clean      - no uncommitted or untracked changes
#   2. pushed     - no commits the remote hasn't seen
#   3. done       - its PR is MERGED, or it has no commits beyond origin/main
#   4. idle       - no Claude session activity for the applicable window
#
# The idle window is split because "merged" and "quiet" mean different things.
# A merged PR says the work landed, so the only thing left to protect is a live
# session doing post-merge validation - hours, not days. A worktree with no
# merged PR might be paused work, so it gets the long window. At ~10 new
# worktrees a day, each carrying its own ~1GB node_modules, the difference is
# roughly 11GB of live checkouts instead of 22GB.
#
# Sessions are NOT stored in the worktree; they live in
# ~/.claude/projects/<slugged-path>/ and survive removal. What removal costs is
# the `claude --resume` listing for that path (the transcripts stay readable,
# and recreating the same path brings the listing back). The idle check exists
# so an active worktree is never pruned mid-session, not to protect history.
#
# Dry run by default. Removal uses plain `git worktree remove` (no --force), so
# git itself is the last line of defence if this script's checks are ever wrong.
set -uo pipefail

apply=0
fetch=1
merged_idle_hours=12
idle_hours=48

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)              apply=1 ;;
    --no-fetch)           fetch=0 ;;
    --merged-idle-hours)  merged_idle_hours=${2:?--merged-idle-hours needs a value}; shift ;;
    --idle-hours)         idle_hours=${2:?--idle-hours needs a value}; shift ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v gh >/dev/null || { echo "prune-worktrees: gh CLI is required" >&2; exit 1; }

# launchd invokes this with cwd=/, so the repo is located from the script's own
# path (<checkout>/.claude/scripts/) rather than the working directory. A copy
# inside a linked worktree still resolves to the same shared .git.
invoked_from=$PWD
cd "$(dirname "$0")/../.." 2>/dev/null || { echo "prune-worktrees: cannot locate checkout" >&2; exit 1; }
git rev-parse --git-common-dir >/dev/null 2>&1 || { echo "prune-worktrees: not a git repo" >&2; exit 1; }
main_root=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
cd "$main_root" || exit 1

# Only set when invoked from inside a worktree - that one is never pruned out
# from under the caller. Empty under launchd, where no worktree is "current".
root=$(cd "$invoked_from" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)

[ "$fetch" = 1 ] && git fetch --quiet --prune origin 2>/dev/null

# Claude keys a project dir by the worktree's absolute path with /, . and _ all
# collapsed to '-'. Newest transcript mtime in that dir is the session clock.
session_age_hours() {
  local slug dir newest now
  slug=$(printf '%s' "$1" | tr '/._' '---')
  dir="$HOME/.claude/projects/$slug"
  [ -d "$dir" ] || { echo 99999; return; }
  newest=$(find "$dir" -name '*.jsonl' -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  [ -n "$newest" ] || { echo 99999; return; }
  now=$(date +%s)
  echo $(( (now - newest) / 3600 ))
}

prunable=()
# Under launchd every run appends to one log, so stamp non-tty output. A
# terminal already has the context and doesn't need the banner.
[ -t 1 ] || printf '=== %s ===\n' "$(date '+%F %T')"
printf '%-38s %-40s %s\n' WORKTREE BRANCH VERDICT

while IFS= read -r line; do
  case "$line" in
    worktree\ *) wt=${line#worktree } ;;
    locked*)     [ -n "${wt:-}" ] && locked[${#prunable[@]}]=1; wt_locked=1 ;;
    '')
      # end of a porcelain record - evaluate the worktree we just read
      [ -n "${wt:-}" ] || continue
      w=$wt; wt=''; was_locked=${wt_locked:-0}; wt_locked=0

      [ "$w" = "$main_root" ] && continue
      name=$(basename "$w")
      branch=$(git -C "$w" symbolic-ref --quiet --short HEAD 2>/dev/null || echo '(detached)')

      verdict=''; reason=''; window=0; pr_state=''
      if [ "$was_locked" = 1 ]; then
        verdict='keep - locked'
      elif [ "$w" = "$root" ]; then
        verdict='keep - current worktree'
      elif [ -n "$(git -C "$w" status --porcelain 2>/dev/null)" ]; then
        verdict="keep - uncommitted changes ($(git -C "$w" status --porcelain | wc -l | tr -d ' ') files)"
      fi

      # Only meaningful while the remote branch still exists. `gh pr merge
      # --delete-branch` removes it, and `git fetch --prune` then drops the
      # remote-tracking ref - so a merged worktree legitimately has no upstream,
      # and the PR state below is what settles it.
      if [ -z "$verdict" ] && git -C "$w" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
        unpushed=$(git -C "$w" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
        [ "$unpushed" != 0 ] && verdict="keep - $unpushed unpushed commit(s)"
      fi

      if [ -z "$verdict" ]; then
        ahead=$(git -C "$w" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
        # mergedAt comes back as UTC while git dates carry a local offset, so
        # jq's fromdate normalises both sides to epoch seconds before compare.
        pr=$(gh pr list --head "$branch" --state all --limit 1 --json number,state,mergedAt \
               --jq '.[0] | "\(.number) \(.state) \(if .mergedAt then (.mergedAt|fromdate) else 0 end)"' 2>/dev/null)
        read -r pr_num pr_state merged_ct <<< "$pr"
        case "$pr_state" in
          MERGED)
            # Squash-merged commits never land in main verbatim, so "ahead of
            # main" says nothing here. What would be unrecoverable is a commit
            # made after the merge, once the remote branch is gone - the one
            # case worth refusing.
            head_ct=$(git -C "$w" log -1 --format=%ct HEAD 2>/dev/null || echo 0)
            if [ "${merged_ct:-0}" != 0 ] && [ "$head_ct" -gt "$merged_ct" ]; then
              verdict="keep - commit after PR #$pr_num merged"
            else
              reason="PR #$pr_num merged"; window=$merged_idle_hours
            fi ;;
          OPEN)   verdict="keep - PR #$pr_num still open" ;;
          CLOSED) verdict="keep - PR #$pr_num closed unmerged" ;;
          *)      if [ "$ahead" = 0 ]; then reason='no PR, no commits past main'; window=$idle_hours
                  else verdict="keep - $ahead commit(s), no PR"; fi ;;
        esac
      fi

      if [ -z "$verdict" ]; then
        idle=$(session_age_hours "$w")
        if [ "$idle" -lt "$window" ]; then
          verdict="keep - session activity ${idle}h ago (needs ${window}h)"
        else
          # One append for every PRUNE verdict - a reported line that never
          # reaches the array would make --apply quietly do less than it said.
          if [ "$idle" -ge 99999 ]; then age='no sessions recorded'
          else age="idle ${idle}h"; fi
          verdict="PRUNE - $reason, $age"
          prunable+=("$w|$branch|$pr_state")
        fi
      fi

      printf '%-38s %-40s %s\n' "$name" "$branch" "$verdict"
      ;;
  esac
done < <(git worktree list --porcelain; echo)

echo
if [ ${#prunable[@]} -eq 0 ]; then
  echo "Nothing to prune."
  exit 0
fi

if [ "$apply" = 0 ]; then
  echo "${#prunable[@]} worktree(s) prunable. Re-run with --apply to remove them."
  exit 0
fi

for entry in "${prunable[@]}"; do
  IFS='|' read -r w branch pr_state <<< "$entry"
  if git worktree remove "$w"; then
    echo "removed $(basename "$w")"
    # Its e2e database goes with it - same name derivation as worktree-setup.sh.
    pg_bin=$(command -v dropdb >/dev/null && dirname "$(command -v dropdb)" || echo /opt/homebrew/opt/postgresql@17/bin)
    db="nexus_wt_$(basename "$w" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | cut -c1-50)"
    [ -x "$pg_bin/dropdb" ] && "$pg_bin/dropdb" --if-exists "$db" 2>/dev/null \
      && echo "  dropped database $db"
    # Squash-merged branches never look merged to `git branch -d`, so -D is the
    # only option - gated on the PR state, which is the authoritative signal.
    if [ "$pr_state" = MERGED ] && [ "$branch" != main ]; then
      git branch -D "$branch" >/dev/null 2>&1 && echo "  deleted branch $branch"
    fi
  else
    echo "SKIPPED $(basename "$w") - git refused the removal" >&2
  fi
done

git worktree prune
