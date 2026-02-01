# Decision: npm OIDC Trusted Publishers for trpc-devtools

**Date:** 2026-02-01
**Status:** Resolved
**Package:** trpc-devtools

## Context

When setting up automated publishing for the `trpc-devtools` npm package, we initially used manual publishing with OTP (one-time password) authentication. This required human interaction for every publish:

```bash
npm publish --access public --otp=123456
```

This was problematic because:

1. Required the maintainer to be present for every release
2. Couldn't be automated in CI/CD
3. Blocked AI-assisted development workflows

## Motivation

We wanted fully automated publishing triggered by git tags:

```bash
git tag trpc-devtools@0.1.3
git push origin trpc-devtools@0.1.3
# → GitHub Actions publishes automatically
```

### Options Considered

1. **Granular Access Token (90 days max)** - npm deprecated classic tokens and limited granular tokens to 90-day expiration with required 2FA
2. **npm OIDC Trusted Publishers** - Token-less publishing using GitHub Actions' OIDC identity

We chose trusted publishers to avoid token rotation overhead.

## Implementation Journey

### Attempt 1: Basic OIDC Setup

Initial workflow:

```yaml
jobs:
    publish:
        runs-on: ubuntu-latest
        permissions:
            contents: read
            id-token: write
        steps:
            - uses: actions/checkout@v4
            - uses: pnpm/action-setup@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: 22
                  registry-url: 'https://registry.npmjs.org'
            - run: pnpm install && pnpm -F trpc-devtools build
            - run: npm publish --provenance --access public
```

**Result:** Failed with `E404 Not Found`

```
npm error 404 Not Found - PUT https://registry.npmjs.org/trpc-devtools
npm notice Access token expired or revoked
```

### Attempt 2: Add GitHub Environment

Research indicated npm trusted publishers might require a GitHub environment.

Added `environment: npm` to the workflow and created a matching GitHub environment.

**Result:** Same `E404` error

### Attempt 3: Remove registry-url

Suspected `setup-node` with `registry-url` was creating an `.npmrc` that interfered with OIDC.

Removed `registry-url` from setup-node configuration.

**Result:** `ENEEDAUTH - This command requires you to be logged in`

The npm CLI wasn't using OIDC at all.

### Attempt 4: Add repository Field

Research revealed `repository.url` in package.json must match provenance metadata.

Added to package.json:

```json
{
    "repository": {
        "type": "git",
        "url": "https://github.com/thomasreichmann/nexus.git",
        "directory": "packages/trpc-studio"
    }
}
```

**Result:** Still `ENEEDAUTH`

### Attempt 5: Node.js 24 (Solution)

Further research found the critical requirement: **npm OIDC trusted publishing requires npm >= 11.5.1 or Node.js >= 24**.

Node.js 22 ships with npm 10.x, which doesn't have OIDC support.

Changed workflow:

```yaml
- uses: actions/setup-node@v4
  with:
      node-version: 24 # Was 22
      cache: 'pnpm'
```

**Result:** Success!

## Final Configuration

### npm Trusted Publisher Settings

On npmjs.com package settings:

- **Repository owner:** thomasreichmann
- **Repository name:** nexus
- **Workflow filename:** publish-trpc-devtools.yml
- **Environment:** npm

### GitHub Environment

Created environment named `npm` at:
`https://github.com/thomasreichmann/nexus/settings/environments`

No additional protection rules needed.

### Workflow

```yaml
name: Publish trpc-devtools

on:
    push:
        tags:
            - 'trpc-devtools@*'

jobs:
    publish:
        runs-on: ubuntu-latest
        environment: npm
        permissions:
            contents: read
            id-token: write
        steps:
            - uses: actions/checkout@v4
            - uses: pnpm/action-setup@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: 24 # Required for npm OIDC
                  cache: 'pnpm'
            - name: Install dependencies
              run: pnpm install --frozen-lockfile
            - name: Build package
              run: pnpm -F trpc-devtools build
            - name: Run tests
              run: pnpm -F trpc-devtools test -- --run
            - name: Publish to npm
              run: npm publish --provenance --access public
              working-directory: packages/trpc-studio
```

### package.json Requirements

```json
{
    "repository": {
        "type": "git",
        "url": "https://github.com/thomasreichmann/nexus.git",
        "directory": "packages/trpc-studio"
    },
    "homepage": "https://github.com/thomasreichmann/nexus/tree/main/packages/trpc-studio#readme"
}
```

## Key Learnings

1. **Node.js version matters** - OIDC trusted publishing requires Node.js 24+ or npm 11.5.1+
2. **repository field required** - Must match GitHub repo for provenance verification
3. **Environment matching** - GitHub environment name must match npm trusted publisher config
4. **No NODE_AUTH_TOKEN** - Don't set this env var when using OIDC; it overrides the OIDC flow
5. **No registry-url needed** - setup-node's registry-url can interfere with OIDC

## Error Reference

| Error                  | Cause                                | Solution                                        |
| ---------------------- | ------------------------------------ | ----------------------------------------------- |
| `E404 Not Found`       | OIDC token rejected, config mismatch | Verify trusted publisher settings match exactly |
| `ENEEDAUTH`            | npm not using OIDC                   | Use Node.js 24+ for npm 11.5+ with OIDC support |
| `Access token expired` | Invalid/missing OIDC exchange        | Don't set NODE_AUTH_TOKEN, use Node.js 24+      |

## References

- [npm trusted publishing docs](https://docs.npmjs.com/trusted-publishers/)
- [GitHub blog: npm trusted publishing GA](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)
- [Troubleshooting guide](https://remarkablemark.org/blog/2025/12/19/npm-trusted-publishing/)
- [[../guides/trpc-devtools|trpc-devtools package guide]]
