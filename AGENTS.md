# Agent Map

This repo builds a Codex-style desktop app for `pi`: an Electron desktop surface, thin runtime drivers, release tooling, and repo-local plans/specs that let agents work without hidden context.

Read these first:

1. `README.md`
2. `docs/README.md`
3. `docs/SOURCE_OF_TRUTH.md`
4. `docs/SAFETY.md`
5. `docs/folder-map.md`
6. `plans/active/README.md`

Use the path-scoped instructions instead of guessing:

- Desktop app work: `apps/desktop/AGENTS.md`
- Desktop tests: `apps/desktop/tests/AGENTS.md`
- Driver work: `packages/pi-sdk-driver/AGENTS.md`
- Current remediation roadmap: `plans/active/README.md`

Current layout:

- Electron desktop app: `apps/desktop/`
- Website/docs demo surface: `apps/website/`
- Runtime compatibility drivers: `packages/pi-sdk-driver/`, `packages/session-driver/`
- Model/catalog metadata: `packages/catalogs/`
- Release and install helper scripts: `scripts/`
- Repo knowledge base: `docs/`
- Versioned execution plans: `plans/`
- Local agent skills: `.agents/`

Harness rules:

1. Keep this file short; put detailed knowledge under `docs/`, path-scoped `AGENTS.md`, or versioned plans.
2. Define success criteria before coding; if unclear, stop and clarify.
3. For non-trivial work, choose verification up front. Use the local `verify` skill in this checkout; use `self-test` only when that skill exists.
4. Do not create or switch to new branches unless the user explicitly asks; respect the current branch or worktree as intentional.
5. Commit in small focused checkpoints when asked to commit; do not batch unrelated changes.
6. Run `simplify` before closing non-trivial implementation work when that command is available.
7. If a workflow, boundary, or source of truth changes, update the relevant docs in the same change.

Product rules:

1. Preserve the Codex-style desktop product direction.
2. Desktop work is not done until it is verified on the real Electron surface, not only by unit tests.
3. Transcript/timeline behavior, session correctness, and Codex-style UX are product features, not polish.
4. Prefer clean reimplementation over patching around local complexity.

Safety rules:

1. Never delete user session history, cached transcripts, screenshots, temp artifacts, worktrees, or branches without explicit approval.
2. Ask before destructive commands, history rewrites, force pushes, production mutations, release publication, or secret rotation steps.
3. Treat files you did not edit as read-only when multiple agents may be working.
4. Do not print, commit, or preserve secrets in repo docs, logs, plans, screenshots, or command output.

Structure rules:

1. Prefer path-scoped guidance in nested `AGENTS.md` files over growing this file.
2. Keep the desktop renderer/main/preload boundary tight; avoid broad Node exposure to the renderer.
3. Keep `pi-sdk-driver` thin over `pi-mono`; do not fork or reimplement `pi` runtime behavior unless necessary.

Source of truth:

1. Root `AGENTS.md` is the repo instruction source of truth.
2. Root `CLAUDE.md` must remain a symlink to `AGENTS.md`.
