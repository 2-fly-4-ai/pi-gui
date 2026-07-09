# Phase 0 — Secrets Remediation & Repo Hygiene

## Goal

Eliminate the credential-leak risk, clear repo debris, and establish the agent-first harness that lets later phases run from repo-local instructions instead of hidden chat context.

## Harness model

This phase adopts the same pattern used in the sibling repos:

- Root `AGENTS.md` stays short and acts as the map.
- Durable knowledge lives under `docs/`.
- Active work lives under `plans/active/` with success criteria and verification.
- Destructive operations are fenced with explicit **[approval]** gates.
- Repeatable rules become mechanical checks, scripts, hooks, or CI jobs instead of reminders.

Initial harness docs added for this repo:

- `docs/README.md`
- `docs/SOURCE_OF_TRUTH.md`
- `docs/SAFETY.md`
- `docs/folder-map.md`
- `docs/workflows/agent-first-change.md`

## Findings being fixed

- Root `.env` contains production secrets for an unrelated product (Stripe live/test secret keys, `POSTGRES_PASSWORD`, `PGPASSWORD`, webhook secrets, admin/monitoring tokens; ~37 secret lines). A referenced `.env.backup` may hold more.
- Commit `cf7bb03` ("fixing new skills", 2026-05-21) committed the full 157-line `.env`. It exists on local branches `feature/agent-observability-panel`, `fix/log-scope-and-thread-cwd`, `fix/native-scrollbar-intent`. It is NOT on any remote ref — the repo (`github.com/2-fly-4-ai/pi-gui`) is public, so pushing any of those branches leaks everything.
- `.worktrees/` holds 10 stale feature worktrees totaling ~18 GB.
- `agentlog.txt` (19.6 MB) untracked at repo root.
- ~10 stale local branches, ~16 remote branches, many merged.
- `apps/desktop/package.json` has ~50 near-identical `test:*` scripts.
- Global `*.js` / `*.css` gitignore with un-ignore exceptions is fragile.

## Constraints

- **[approval]** History rewrite and worktree/branch deletion are destructive; get explicit user confirmation listing exactly what will be removed before running anything.
- Never delete session history, cached transcripts, or screenshots (root AGENTS.md).
- Secret rotation happens outside this repo (Stripe dashboard, DB, etc.) — the plan tracks it but the user performs it.
- Keep `AGENTS.md` compact. Put long-lived details in `docs/` and path-scoped `AGENTS.md` files.

## Steps

0. **Done 2026-07-08 — Agent harness baseline.** Update root `AGENTS.md` into a compact agent map; add repo-local docs for source of truth, safety, folder map, and the default agent-first workflow. Verify doc links and the `CLAUDE.md -> AGENTS.md` symlink.
1. **In progress 2026-07-08 — Rotate credentials (user action, track only).** Assume compromise of every value in `.env`/`.env.backup`. Credential names are listed in `docs/security/credential-rotation-checklist.md`; user still needs to rotate them in the owning systems.
2. **Pending user action — Relocate secrets.** Move `.env` and any `.env.backup` out of the repo working tree entirely (user's password manager / secrets store). Confirm nothing in this repo reads them (verified: nothing does).
3. **[approval] Purge `cf7bb03` from local history.** For each of the three branches: if the branch's unique work is already merged to main, delete the branch; otherwise `git rebase --onto <parent-of-cf7bb03>` past the secrets commit (or `git filter-repo` scoped to those refs). Then `git reflog expire --expire=now --all && git gc --prune=now` so no dangling copy survives.
4. **Mostly done 2026-07-08 — Secret scanning guardrails.** Added `gitleaks/gitleaks-action@v3` to CI, added `.githooks/pre-commit` with `gitleaks protect --staged --redact`, and documented local scanning + GitHub push protection in `docs/security/secret-scanning.md`. Repo-admin action still needed to enable GitHub push protection.
5. **Audit done 2026-07-08; approval required for removal — Prune worktrees.** For each entry in `.worktrees/`: verify its branch is merged or abandoned (compare against main), then `git worktree remove` + branch delete. Anything with unmerged unique commits gets listed for the user to decide. Current audit is in `docs/security/repo-hygiene-audit.md`.
6. **Partially done 2026-07-08 — Delete `agentlog.txt`** [approval — user artifact] and add `agentlog.txt` to `.gitignore`. Ignore rule is in place; deletion still requires approval.
7. **Audit done 2026-07-08; approval required for deletion — Branch cleanup.** Delete merged local branches; list remote branches safe to delete for the user to confirm. Current audit is in `docs/security/repo-hygiene-audit.md`.
8. **Done 2026-07-08 — Consolidate `test:*` scripts.** Kept `test:e2e:runner` as the single parameterized entry; deleted one-spec `test:core:*`, `test:live:*`, `test:native:*`, and dev-reload wrappers; kept tier entries and `test:prod:*`; updated `apps/desktop/README.md`.
9. **Done 2026-07-08 — Gitignore hardening.** Replaced the global `*.js`/`*.css`/`index.html` ignore + un-ignore pattern with targeted generated-output ignores and kept source CSS/HTML trackable.

## Success Criteria

- Root `AGENTS.md` is a short agent map, and detailed repo knowledge is discoverable under `docs/`.
- `docs/README.md`, `docs/SOURCE_OF_TRUTH.md`, `docs/SAFETY.md`, `docs/folder-map.md`, and `docs/workflows/agent-first-change.md` exist and are cross-linked from the active roadmap.
- `CLAUDE.md` remains a symlink to `AGENTS.md`.
- No file in the working tree or any local/remote ref contains the leaked secrets (`gitleaks detect` over full history passes).
- CI fails on a synthetic committed secret (verify by test commit on a scratch branch, then drop it).
- `.worktrees/` contains only worktrees with live unmerged work; disk usage documented before/after.
- `pnpm --filter @pi-gui/desktop run test:e2e:core` still passes after script consolidation.

## Verification

- `test -L CLAUDE.md && test "$(readlink CLAUDE.md)" = "AGENTS.md"`.
- `test -f docs/README.md && test -f docs/SOURCE_OF_TRUTH.md && test -f docs/SAFETY.md && test -f docs/folder-map.md && test -f docs/workflows/agent-first-change.md`.
- Link/path spot-check: every doc referenced from root `AGENTS.md` and `plans/active/README.md` exists.
- `gitleaks detect --source . --log-opts="--all"` clean.
- `git branch --contains <new-tip-shas>` shows no ref containing the old secrets blob (`git cat-file` on the old blob SHA fails after gc).
- Run one consolidated e2e script end-to-end to prove the runner path works.

## Verification Notes

- 2026-07-08: package JSON parse check passed for root and desktop package.
- 2026-07-08: docs/symlink presence check passed, including `CLAUDE.md -> AGENTS.md`.
- 2026-07-08: `.githooks/pre-commit` shell syntax check passed; `agentlog.txt`, `.env`, and `.env.backup` are ignored.
- 2026-07-08: `.env.backup` is absent; search across `apps/`, `packages/`, `scripts/`, `.github/`, and package manifests found no `dotenv`/`loadEnv`/env-file loader.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run typecheck` passed.
- 2026-07-08: `gitleaks` was not installed locally, so local `gitleaks detect` could not be run.
- 2026-07-08: Fixed the Electron test helper to strip inherited `ELECTRON_RUN_AS_NODE`; `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/navigation.spec.ts` passed.
- 2026-07-08: Restored virtualized timeline marker classes (`timeline--virtualized`, `timeline__virtual-row`) and fixed native upward-scroll intent after programmatic bottom alignment.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run typecheck` and `pnpm --filter @pi-gui/desktop run build` passed after the final trimmed timeline fixes.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts apps/desktop/tests/core/thread-return-subagents.spec.ts apps/desktop/tests/core/timeline-pinning.spec.ts -g "long assistant|virtualized transcript rows|native timeline scroll away"` passed after the final trimmed timeline fixes.
- 2026-07-08: Full `test:e2e:core` was not rerun after the final narrowed fixes. Before the final narrowed fixes, it exposed two deeper pinning cases still needing work: off-bottom restore after IPC-created session switch, and preserving exact scrollTop while streaming into a non-bottom row.
- 2026-07-08: Follow-up timeline work fixed the two deeper pinning cases in isolation: `timeline-pinning.spec.ts -g "keeps a virtualized thread off-bottom|same row"` passed, and the full `timeline-pinning.spec.ts` passed 10/10 after rebuild.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run typecheck` and `pnpm --filter @pi-gui/desktop run build` continued to pass after follow-up scroll/virtualization changes.
- 2026-07-08: Follow-up scroll/virtualization hardening passed `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-native-scroll.spec.ts -g "dragging the timeline scrollbar thumb" --repeat-each=5`.
- 2026-07-08: Follow-up off-bottom composer hardening passed `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts -g "keeps the mid-thread viewport stable" --repeat-each=5`.
- 2026-07-08: Combined timeline lane passed: `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-native-scroll.spec.ts apps/desktop/tests/core/timeline-pinning.spec.ts` (15/15).
- 2026-07-08: Full core lane passed after rebuild: `pnpm --filter @pi-gui/desktop run test:e2e:core` (130/130).
