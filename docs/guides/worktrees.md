# Git Worktrees for Parallel Claude Sessions

This guide explains how to use git worktrees to run multiple Claude Code sessions in parallel, each working on different features without conflicts.

## Why Worktrees?

When you run Claude Code inside the main repository, it works on a single branch. If you want to:

- Work on multiple issues simultaneously
- Have Claude implement one feature while you review another
- Keep the main repo clean on `main` while features are in progress

...you need isolated environments. Git worktrees provide this by creating separate working directories that share the same `.git` history.

## Setup

### Create a Worktrees Directory

Create a sibling directory to hold your worktrees:

```bash
cd ~/projects
mkdir nexus-worktrees
```

### Create Worktrees

Create generic worktrees for parallel sessions. Use simple names since they're not tied to specific features:

```bash
cd nexus
git worktree add ../nexus-worktrees/wt-1 --detach
git worktree add ../nexus-worktrees/wt-2 --detach
```

The `--detach` flag creates the worktree in detached HEAD state from the current commit, making it a clean slate for any feature.

### Install Dependencies

Each worktree needs its own `node_modules`:

```bash
cd ../nexus-worktrees/wt-1
pnpm install
```

### Copy Environment Files

Environment files are gitignored, so copy them from the main repo:

```bash
cp ~/projects/nexus/apps/web/.env.local ~/projects/nexus-worktrees/wt-1/apps/web/.env.local
```

Or pull fresh from Vercel:

```bash
cd ~/projects/nexus-worktrees/wt-1
pnpm env:pull
```

## Using Worktrees with Claude Code

### Start a Session

Open a terminal in a worktree and run Claude Code:

```bash
cd ~/projects/nexus-worktrees/wt-1
claude
```

When you run `/work`, Claude will:

1. Create a feature branch from `origin/main`
2. Implement the feature
3. Push and create a PR

The worktree itself stays available for the next task.

### Run Multiple Sessions

Open separate terminals for each worktree:

```bash
# Terminal 1
cd ~/projects/nexus-worktrees/wt-1
claude
# /work 42

# Terminal 2
cd ~/projects/nexus-worktrees/wt-2
claude
# /work 43
```

Each session is fully isolated - different branches, different changes.

## Worktree Lifecycle

### After Completing Work

When a PR is merged, the worktree's branch is stale. You can either:

**Option A: Reset for next task** (recommended)

```bash
cd ~/projects/nexus-worktrees/wt-1
git checkout --detach origin/main
git branch -D feat/42-old-feature  # Delete the old branch
```

**Option B: Leave as-is**

The next `/work` session will create a new branch from `origin/main` anyway. Old branches accumulate but don't cause issues.

### Cleaning Up Old Branches

Periodically clean up merged branches:

```bash
# From any worktree or main repo
git fetch --prune
git branch --merged origin/main | grep -v main | xargs git branch -d
```

### Removing a Worktree

If you no longer need a worktree:

```bash
cd ~/projects/nexus
git worktree remove ../nexus-worktrees/wt-3
```

## Common Issues

### "Branch is already checked out"

A branch can only be checked out in one worktree at a time. If you see this error:

```bash
git worktree list  # Find where it's checked out
```

Either remove that worktree or use a different branch name.

### Stale node_modules

If commands fail with module errors after switching branches:

```bash
rm -rf node_modules && pnpm install
```

### Missing .env.local

Each worktree needs its own environment file:

```bash
pnpm env:pull
# or
cp ~/projects/nexus/apps/web/.env.local ./apps/web/.env.local
```

### Worktree Out of Sync

If a worktree is behind `origin/main`:

```bash
git fetch origin main
git rebase origin/main  # If on a feature branch
# or
git checkout --detach origin/main  # To reset completely
```

## Quick Reference

| Command                            | Description            |
| ---------------------------------- | ---------------------- |
| `git worktree add <path> --detach` | Create new worktree    |
| `git worktree list`                | List all worktrees     |
| `git worktree remove <path>`       | Remove a worktree      |
| `git worktree prune`               | Clean stale references |

## Recommended Structure

```
~/projects/
├── nexus/                    # Main repo (stays on main)
└── nexus-worktrees/
    ├── wt-1/                 # Session 1
    ├── wt-2/                 # Session 2
    └── wt-3/                 # Session 3 (optional)
```
