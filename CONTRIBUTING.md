# Contributing to Nexus

## Workflow

All non-trivial work follows an issue-first workflow:

```
Create Issue → Work on branch → Reference issue in commits → PR → Merge closes issue
```

### 1. Create an Issue First

Before starting work, create a GitHub Issue using the Task template:

- **Description**: What needs to be done and why
- **Acceptance Criteria**: Checkboxes defining "done"
- **Out of Scope**: What this task does NOT include

### 2. Work on a Branch

```bash
git checkout -b feat/short-description
# or: fix/..., chore/..., docs/...
```

### 3. Reference Issues in Commits

Include the issue number in commit messages:

```bash
git commit -m "feat: add login form (#42)"
git commit -m "fix: resolve auth redirect (#42)"
```

### 4. Create a Pull Request

PRs must include either:

- **Issue reference**: `Closes #42` in the PR body
- **No-issue reason**: `No-Issue: typo fix` for trivial changes

Valid no-issue reasons:

- `typo` / `docs only` - Documentation or typo fixes
- `ci config` - CI/build configuration only
- `deps` - Dependency bump
- `hotfix` - Emergency fix (requires follow-up issue)

### 5. PR Checklist

Before requesting review:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm -F web test:e2e:smoke` passes (if UI changed)
- [ ] Updated `docs/ai/changelog.md` (if significant change)

## Labels

Issues use labels for organization:

| Type   | Labels                                                                  |
| ------ | ----------------------------------------------------------------------- |
| Area   | `frontend`, `backend`, `infra`, `docs`                                  |
| Type   | `feature`, `bug`, `chore`                                               |
| Status | `ready`, `needs-details`, `needs-triage`, `blocked`, `good-first-issue` |

## Code Conventions

See `docs/ai/conventions.md` for naming, structure, and style guidelines.

## AI Tools

AI assistants (Claude, Copilot, etc.) follow the same workflow:

- Ask for or propose issues before non-trivial work
- Reference issues in commits
- No AI attribution in commits or PR descriptions
