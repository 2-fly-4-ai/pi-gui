# Safety

This repo is a desktop app with local sessions, transcripts, screenshots, logs, worktrees, release tooling, and historical secret-risk cleanup in progress. Treat local artifacts as user data unless proven otherwise.

## Approval Required

Get explicit user approval before:

- deleting or pruning worktrees, branches, session directories, cached transcripts, screenshots, videos, temp artifacts, or logs
- rewriting git history, expiring reflogs, running aggressive garbage collection, force-pushing, or deleting remote refs
- publishing releases, uploading packages, changing Homebrew tap state, or mutating production services
- rotating secrets or changing secret storage outside this repo
- running destructive cleanup scripts whose target set was not listed to the user first

## Secrets

- Never commit `.env`, `.env.*`, private keys, tokens, cookies, webhook secrets, passwords, or copied secret values.
- Never paste full secret values into plans, issues, logs, screenshots, or command output.
- Use redacted names when tracking rotation work, for example `STRIPE_SECRET_KEY` rather than the value.
- Assume any committed secret is compromised and requires out-of-band rotation by the user.

## Private Artifacts

Do not commit or delete without approval:

- session history and cached transcripts
- screenshots, videos, traces, HARs, and support artifacts
- runtime logs, local databases, downloaded packages, release archives, and temp folders
- `.worktrees/` contents and branch-specific work

## Desktop Boundary

- Keep preload APIs narrow and explicit.
- Do not expose broad filesystem, shell, process, or environment access to the renderer.
- Verify visible desktop behavior on the real Electron surface when desktop code changes.

## Rule Of Thumb

If the operation changes history, removes user evidence, exposes secrets, touches production, or publishes something users can install, stop and ask first.
