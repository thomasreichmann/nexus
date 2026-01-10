---
title: GitHub MCP Server Setup
created: 2026-01-10
updated: 2026-01-10
status: active
tags:
    - ai
    - github
    - mcp
---

# GitHub MCP Server Setup

Configure the GitHub MCP Server for AI tools to interact with GitHub issues and PRs.

## Why MCP?

The GitHub MCP Server provides:

- **Structured responses** - Less token cost than parsing `gh` CLI output
- **Tool-specific config** - Only load the tools you need
- **Built-in security** - Lockdown mode and content sanitization

## Setup

### 1. Create a GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create a new token with:
    - Repository access: Select this repository
    - Permissions: Issues (Read and write), Pull requests (Read and write)
3. Copy the token

### 2. Configure Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
    "mcpServers": {
        "github": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": {
                "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token>"
            }
        }
    }
}
```

### 3. Verify Setup

In Claude Code, the GitHub tools should now be available:

- `issue_read` - Read issue details
- `issue_write` - Create/update/close issues

## Usage

AI tools will use MCP to:

- List open issues: Check what work is already tracked
- Read issue details: Understand scope and acceptance criteria
- Create issues: With user approval, create new task issues
- Update issues: Add comments, update labels, close when done

## Fallback

If MCP is unavailable, AI tools fall back to `gh` CLI with `--json` flag:

```bash
gh issue list --json number,title,state
gh issue view 42 --json title,body,labels
gh issue create --title "..." --body "..."
```

## Related

- [[../ai/conventions|Code Conventions]] - Issue-driven development workflow
- [GitHub MCP Server Docs](https://github.com/modelcontextprotocol/servers)
