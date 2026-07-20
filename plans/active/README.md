# Active Roadmap — Deep Review Remediation

Source: full-project review, 2026-07-08. Implements every finding from that review, sequenced so each phase de-risks the next. One phase = one or more focused branches/checkpoints; do not batch phases together.

This roadmap is also the repo's agent-first execution harness. Agents should start with root
[`AGENTS.md`](../../AGENTS.md), then read [`docs/README.md`](../../docs/README.md),
[`docs/SOURCE_OF_TRUTH.md`](../../docs/SOURCE_OF_TRUTH.md), and
[`docs/SAFETY.md`](../../docs/SAFETY.md) before executing a phase. Use
[`docs/folder-map.md`](../../docs/folder-map.md) for orientation and
[`docs/workflows/agent-first-change.md`](../../docs/workflows/agent-first-change.md) for the
default agent loop.

## Sequencing

| Phase | Plan | Why this order | Status |
| --- | --- | --- | --- |
| 0 | [phase-0-secrets-and-hygiene.md](phase-0-secrets-and-hygiene.md) | Live secrets one push away from public leak; hygiene items are quick and unblock tooling | complete; historical external rotation explicitly waived |
| 1 | [phase-1-electron-hardening.md](phase-1-electron-hardening.md) | Security gaps compound as webview surfaces grow (side browser, VS Code embed) | complete; native Electron paste proof green |
| 2 | [phase-2-quality-infrastructure.md](phase-2-quality-infrastructure.md) | Lint + unit tests must exist BEFORE the big refactors in phases 3–4 so they act as a safety net | locally complete; Linux unit CI fix prepared and renderer virtualization dependency upgraded; remote proof pending |
| 3 | [phase-3-renderer-decomposition.md](phase-3-renderer-decomposition.md) | App.tsx breakup; prerequisite for state-sync rework touching the same surfaces | locally complete; core, credential-free live, and native Electron proof green; live-provider proof blocked by expired OAuth login |
| 4 | [phase-4-state-sync-rearchitecture.md](phase-4-state-sync-rearchitecture.md) | Delta-based IPC state/transcript sync; fixes chat perf at the root | locally complete; full core/live/native green and long-transcript perf recorded; live-provider proof blocked by expired OAuth login |
| 5 | [phase-5-product.md](phase-5-product.md) | Auto-update, crash reporting, onboarding, Windows — best built on the cleaned foundation | in progress; 5a local updater integration, 5b crash/error reporting including packaged forced-crash proof, 5c first-run onboarding, 5d platform decision, and 5e website/docs implemented |
| — | [agents-and-subagents.md](agents-and-subagents.md) | Typed subagent lifecycle, durable runs, structured results; W1/W4 coordinate with phase 4's event protocol, W2 output cap + parser + full-output affordance and W3 persistence can start now | locally complete; W1–W7 implemented and verified on Electron surfaces; live-provider workflow proof blocked by expired OAuth login |

## Current Health Snapshot

- Phase 1 is complete, including the real Electron native paste/focus proof. Phases 3 and 4 are implementation-complete with strong core coverage. Their paid live-provider lane was attempted on 2026-07-21; all six gated cases reached the real Electron runtime and reported `No API key for provider: openai-codex`, while the runtime credential check reported `Failed to refresh OAuth token for openai-codex`. Re-authentication is required before rerunning that proof.
- Phase 2 is locally complete pending remote proof. Lint, unit, and typecheck are green; the remote Ubuntu `node-pty` unit coupling is removed locally; `@legendapp/list` is upgraded to 3.3.3 with timeline, packaged-app, runtime-dependency, and release-zip proof. `parse5`/`yargs` remain compatibility versions required by the bundled upstream runtime, not independent local upgrade TODOs.
- Phase 0 is complete. Local secret files, leaked local history refs, stale worktrees/branches, and `agentlog.txt` are cleaned up; GitHub secret scanning/push protection are enabled; the unrelated product's historical external credential rotation was explicitly waived on 2026-07-21.
- Phase 5 is mostly implementation-complete, but not fully closeable until the auto-update signed staging round-trip is run with real N/N+1 release artifacts. Local updater integration and Homebrew guidance are implemented; first-run onboarding has packaged proof; platform expansion now has a decision; crash/error reporting has zero-infra issue-draft, local native crash artifact, first-run reporting opt-in UX, and packaged forced-crash proof; website/docs are implemented.
- Agents/subagents W1–W7 are locally implemented: durable audit correlation/backfill, multi-child aggregation, structured workflow metadata, Display Mode backfill, live artifact scanning, cancel/retry, in-app transcript preview, role hygiene with bounded dry-run, and live typed observability are all present. Running every built-in workflow against a real provider remains blocked by the same expired OpenAI OAuth login.
- UI polish is archived as complete in [`../ui-polish.md`](../ui-polish.md) after the final light/dark screenshot harness, update-ready accent neutralization, and focus-reset cleanup.
- 2026-07-21 local closeout verification is green: lint, typecheck, build, 72 unit tests, 155/155 core Electron tests, 32/32 credential-free live Electron tests (6 real-provider tests skipped by contract), 8/8 native Electron tests, packaged-app smoke, packaged-runtime dependency verification, and extracted release-zip smoke. Remote CI confirmation and credential-gated lanes remain separate external proofs.
- The repo-requested `simplify` closeout command was not available in the local environment on 2026-07-20; manual diff review and `git diff --check` were used instead.

## Rules for executing this roadmap

- Phase 0 items marked **[approval]** are destructive (history rewrite, worktree deletion) and require explicit user go-ahead per root `AGENTS.md` Safety rules. Everything else can proceed.
- Every phase defines success criteria and a verification plan up front; desktop-facing work is not done until verified on the real Electron surface.
- Update the Status column here as phases start/land; move a phase file to `plans/` (archived) when complete.
- Commit in small checkpoints inside each phase; run `simplify` before closing each phase when available, and record it as blocked when the command is missing.
- If a phase reveals missing repo knowledge, add it under `docs/` or a path-scoped `AGENTS.md` in the same change.
