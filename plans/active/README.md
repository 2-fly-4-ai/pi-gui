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
| 0 | [phase-0-secrets-and-hygiene.md](phase-0-secrets-and-hygiene.md) | Live secrets one push away from public leak; hygiene items are quick and unblock tooling | local cleanup complete; credential/admin actions pending |
| 1 | [phase-1-electron-hardening.md](phase-1-electron-hardening.md) | Security gaps compound as webview surfaces grow (side browser, VS Code embed) | implemented; native focus proof blocked |
| 2 | [phase-2-quality-infrastructure.md](phase-2-quality-infrastructure.md) | Lint + unit tests must exist BEFORE the big refactors in phases 3–4 so they act as a safety net | implemented; CI proof pending; dep upgrades gated |
| 3 | [phase-3-renderer-decomposition.md](phase-3-renderer-decomposition.md) | App.tsx breakup; prerequisite for state-sync rework touching the same surfaces | implemented; live/visual proof pending |
| 4 | [phase-4-state-sync-rearchitecture.md](phase-4-state-sync-rearchitecture.md) | Delta-based IPC state/transcript sync; fixes chat perf at the root | implemented; full core green; long-transcript perf recorded; live proof pending |
| 5 | [phase-5-product.md](phase-5-product.md) | Auto-update, crash reporting, onboarding, Windows — best built on the cleaned foundation | in progress; 5a local updater integration, 5b crash/error reporting including packaged forced-crash proof, 5c first-run onboarding, 5d platform decision, and 5e website/docs implemented |
| — | [ui-polish.md](ui-polish.md) | Minimalist visual polish from the 2026-07-08 real-Electron screenshot review; phase 3 CSS split already landed, so token work now updates split stylesheets directly | in progress; C1/C2/C3/C4/C5/K1/K2/K3/K4/D1/D2/D3/D4/D5 slices, focused T topbar-token checkpoint, T1/T2/T4 token cleanup, T3 surface/border + settings control color-token slices, A1 focused accent audit + update-ready follow-up, K4 focus-reset cleanup, and final light/dark screenshot harness implemented |
| — | [agents-and-subagents.md](agents-and-subagents.md) | Typed subagent lifecycle, durable runs, structured results; W1/W4 coordinate with phase 4's event protocol, W2 output cap + parser + full-output affordance and W3 persistence can start now | in progress; W1 inventory/design + typed-event + prompt-correlation slices, W2 cap/parser/full-output affordance, W3 persistence + lifecycle + artifact-event/filesystem-backfill/live-scan + retry/cancel updates, W4 Display Mode activity + structured workflow metadata slices, and W5 workflow role-validation + built-in restore + direct no-Agent reporting slices implemented |

## Current Health Snapshot

- Good to treat as implementation-complete pending external proof: phases 1, 3, and 4. Each has strong core Electron coverage recorded; remaining proof is native focus or live-provider validation that depends on local focus/credentials.
- Good to treat as infrastructure-complete pending remote proof: phase 2. Lint, unit, typecheck, and core lanes are green locally; remaining closeout is CI proof on a PR. Dependency upgrades are intentionally gated in `docs/runtime-deps.md`, not open-ended TODOs.
- Not fully closeable without external user/admin action: phase 0. Local secret files, leaked local history refs, stale worktrees/branches, and `agentlog.txt` are cleaned up; credential rotation and GitHub push-protection enablement still happen in external systems.
- Phase 5 is mostly implementation-complete, but not fully closeable until the auto-update signed staging round-trip is run with real N/N+1 release artifacts. Local updater integration and Homebrew guidance are implemented; first-run onboarding has packaged proof; platform expansion now has a decision; crash/error reporting has zero-infra issue-draft, local native crash artifact, first-run reporting opt-in UX, and packaged forced-crash proof; website/docs are implemented.
- Still product work: agents/subagents W1/W3/W4/W5-W7 follow-ups around audit correlation, multi-role/multi-child aggregation, full transcript side-drawer, user-defined workflows, role hygiene, and observability upgrades. Structured workflow metadata, Display Mode durable-run backfill, live artifact scanning, and active-run cancel controls for workflow runs are implemented.
- UI polish is broadly advanced and repeatedly screenshot-verified. The final light/dark screenshot harness, follow-up update-ready accent neutralization, and focus-reset cleanup are implemented; remaining closeout is a decision on whether to archive the plan as complete or keep it open for future polish findings.

## Rules for executing this roadmap

- Phase 0 items marked **[approval]** are destructive (history rewrite, worktree deletion) and require explicit user go-ahead per root `AGENTS.md` Safety rules. Everything else can proceed.
- Every phase defines success criteria and a verification plan up front; desktop-facing work is not done until verified on the real Electron surface.
- Update the Status column here as phases start/land; move a phase file to `plans/` (archived) when complete.
- Commit in small checkpoints inside each phase; run `simplify` before closing each phase when available, and record it as blocked when the command is missing.
- If a phase reveals missing repo knowledge, add it under `docs/` or a path-scoped `AGENTS.md` in the same change.
