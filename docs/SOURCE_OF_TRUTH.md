# Source Of Truth

Last established on July 8, 2026 while adopting the agent-first harness pattern from the sibling repos.

## Direct-Edit Sources

These are intended to be edited and reviewed directly:

- `apps/desktop/` for the Electron app, renderer/main/preload code, desktop tests, and desktop package config
- `apps/website/` for the website/demo surface
- `packages/pi-sdk-driver/` for the thin compatibility layer over `pi-mono`
- `packages/session-driver/` for session driver behavior
- `packages/catalogs/` for model/catalog metadata
- `scripts/` for release, install, and verification helper scripts
- `.github/workflows/` for CI and release workflow definitions
- `docs/` for durable repo knowledge
- `plans/` for versioned execution plans and remediation roadmaps
- `.agents/skills/` for repo-local agent skills

## Path-Scoped Instruction Sources

- Root coordination: `AGENTS.md`
- Desktop app: `apps/desktop/AGENTS.md`
- Desktop tests: `apps/desktop/tests/AGENTS.md`
- Driver package: `packages/pi-sdk-driver/AGENTS.md`

Prefer the closest `AGENTS.md` when instructions overlap.

## Generated Or External Surfaces

Prefer regeneration or package tooling over hand edits for:

- `node_modules/`
- package build output such as `dist/`, `out/`, `.vite/`, `.next/`, and Electron build artifacts
- Playwright reports and screenshots
- release archives, downloaded installers, and packaged app output
- imported pi docs/media under `docs/readme/` unless the task is specifically about maintaining that imported copy

If a generated file is edited by hand, document why regeneration was not appropriate.

## Runtime And Private Data

These are not source of truth and should not be committed:

- `.env`, `.env.*`, private keys, tokens, cookies, passwords, and webhook secrets
- local session history, cached transcripts, support artifacts, screenshots, videos, traces, HARs, and logs
- `.worktrees/` contents unless explicitly preserving a checked-in instruction file
- `agentlog.txt` and other local debugging logs
- release zips, installers, downloaded packages, and temp folders

## Rule Of Thumb

If a change affects desktop UX, transcript/timeline behavior, session correctness, IPC, or runtime execution, start in `apps/desktop/` and verify on Electron.

If a change affects pi runtime compatibility, start in `packages/pi-sdk-driver/` and keep the package thin over upstream `pi` behavior.

If a change affects release, install, or packaging, start with `scripts/`, `.github/workflows/`, and the package-level scripts that already own that path.

If a change affects repo operations or agent behavior, update `AGENTS.md`, `docs/`, or `plans/` in the same change.
