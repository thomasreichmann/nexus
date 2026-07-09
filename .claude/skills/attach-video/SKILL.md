---
name: attach-video
description: Upload a local video or image to GitHub and get a URL that renders as an inline player / image in issue, PR, and comment markdown. Use when posting recorded UI evidence or screenshots.
argument-hint: [path to .mp4/.mov/.png/.gif] (optional)
allowed-tools: Bash, Read
---

# Attach video / image to GitHub

Turns a local media file into a `github.com/user-attachments/...` URL. Unlike a
raw or jsDelivr link, this URL renders as an **inline video player** (or inline
image) directly in issue / PR / comment markdown — no click-out.

## Usage

```bash
./tooling/media-attach/run.sh path/to/clip.mp4
```

The path is relative to the **repo root** (`tooling/media-attach/` in the
checkout you're working in), not this skill's directory — run it from the repo
root or use an absolute path.

It prints one URL. Drop that URL on its own line (blank line above and below) in
the markdown body and GitHub renders a player:

```markdown
### Demo

https://github.com/user-attachments/assets/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Images use the same tool; embed them as `![alt](url)`.

Options: `--repo owner/repo` (defaults to the current git remote). Repo is
resolved automatically otherwise.

## Constraints

- Video files must be **under 10 MB** (GitHub's limit). Compress first if larger.
- Supported: mp4, mov, webm, png, jpg, gif, and other GitHub-supported types.
- The URL 404s if you open it directly — that's expected. It only resolves once
  referenced in a GitHub markdown body. Post it in the comment to see it work.

## If it reports missing setup

The tool needs a one-time local setup on this machine. If `run.sh` exits with a
"one-time local setup not found" message, **ask the user to complete it** — do
not try to configure it yourself.

## When to use it

Posting recorded UI evidence on an issue or PR: embed the inline player plus
still frames. This is the preferred format for video evidence — see the evidence
media-format note in memory.
