#!/usr/bin/env bash
# SessionStart hook: make a fresh `claude --worktree` checkout dev-ready.
# After .worktreeinclude copies the env files, a new worktree still needs two
# things: its own node_modules (never shared between worktrees) and a dev port
# that won't collide with another worktree's `pnpm dev`. No-ops in the main
# checkout and on resume/compact once node_modules exists.
set -uo pipefail

cat >/dev/null 2>&1 || true   # drain the SessionStart JSON payload on stdin

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

# Act only inside a linked worktree. In the main checkout --git-dir equals
# --git-common-dir; a linked worktree's --git-dir lives under
# <common>/worktrees/<name>, so the two paths differ.
[ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] && exit 0

# `claude -w feat/86` can't put a `/` in the worktree dir name, so it sanitizes
# to `feat+86` and names the branch `worktree-feat+86`. The dir name is fine, but
# the branch should be the slashed form the user actually typed. Recover it:
# strip the `worktree-` prefix and turn `+` back into `/`.
branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
case "$branch" in
  worktree-*)
    intended=${branch#worktree-}
    intended=${intended//+//}   # +  ->  /  (inverse of claude's path sanitising)
    if [ "$intended" != "$branch" ]; then
      if git show-ref --verify --quiet "refs/heads/$intended"; then
        echo "worktree-setup: leaving '$branch' (target '$intended' already exists)" >&2
      elif git branch -m "$branch" "$intended"; then
        echo "worktree-setup: renamed branch '$branch' -> '$intended'" >&2
      fi
    fi
    ;;
esac

# Fresh install only when deps are absent, so resume/compact re-runs are instant.
if [ ! -d node_modules ]; then
  echo "worktree-setup: pnpm install (fresh worktree)..." >&2
  pnpm install --frozen-lockfile >&2 \
    || echo "worktree-setup: install failed - run 'pnpm install' manually" >&2
fi

# .worktreeinclude normally copies the env files in, but a worktree created
# before that existed (or by plain `git worktree add`) has none, and `pnpm check`
# then fails in lib/env with "No client environment variables found".
main_env="$(dirname "$(git rev-parse --git-common-dir)")/apps/web/.env.local"
if [ ! -f apps/web/.env.local ] && [ -f "$main_env" ]; then
  cp "$main_env" apps/web/.env.local
  echo "worktree-setup: copied .env.local from the main checkout" >&2
fi

# Stable per-worktree dev port in 3001-4000, derived from the worktree name so
# it stays the same across sessions. 3000 stays reserved for the main checkout.
name=$(basename "$root")
port=$(( 3001 + $(printf '%s' "$name" | cksum | cut -d' ' -f1) % 1000 ))

# Per-worktree e2e database. Every worktree used to share one Supabase DB while
# the e2e fixtures use fixed identities (admin-e2e@test.local, e2e-test-file-1
# .txt), so two worktrees testing at once collided: sign-up 422s, duplicate-key
# inserts, and strict-mode violations from the other run's rows. The app server
# was already isolated per worktree by $port; this isolates the data too.
#
# Scoped to e2e on purpose. `pnpm dev` keeps pointing at the shared dev DB via
# .env.local, which is where the real data lives - only playwright.config.ts
# reads E2E_DATABASE_URL, and it falls back to DATABASE_URL when unset (CI).
pg_bin=$(command -v createdb >/dev/null && dirname "$(command -v createdb)" || echo /opt/homebrew/opt/postgresql@17/bin)
if [ -x "$pg_bin/createdb" ]; then
  db="nexus_wt_$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | cut -c1-50)"
  e2e_url="postgres://$USER@localhost:5432/$db"
  if ! "$pg_bin/psql" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$db"; then
    if "$pg_bin/createdb" "$db" 2>/dev/null; then
      echo "worktree-setup: created e2e database $db, migrating..." >&2
      DATABASE_URL="$e2e_url" pnpm -F db db:migrate >&2 \
        || echo "worktree-setup: migrate failed - run 'pnpm -F db db:migrate' manually" >&2
    else
      echo "worktree-setup: createdb $db failed - e2e will use the shared DB" >&2
      e2e_url=''
    fi
  fi
  [ -n "$e2e_url" ] && [ -n "${CLAUDE_ENV_FILE:-}" ] \
    && printf 'E2E_DATABASE_URL=%s\nDB_ENV=local\n' "$e2e_url" >> "$CLAUDE_ENV_FILE"
else
  echo "worktree-setup: no local postgres (brew install postgresql@17) - e2e shares the dev DB" >&2
fi

# CLAUDE_ENV_FILE persists vars into this session's Bash tool calls. turbo
# forwards everything (globalPassThroughEnv: ["*"]), so `pnpm dev` binds next dev
# to $port. playwright.config.ts reads PORT too (falls back to 3000), so e2e in
# this worktree targets $port as well — no collision with the main checkout.
[ -n "${CLAUDE_ENV_FILE:-}" ] && printf 'PORT=%s\n' "$port" >> "$CLAUDE_ENV_FILE"

# A SessionStart hook's stdout is injected into Claude's context.
echo "Worktree '$name' is dev-ready. PORT=$port is set for both 'pnpm dev' and e2e.${e2e_url:+ e2e uses its own database $db.}"
