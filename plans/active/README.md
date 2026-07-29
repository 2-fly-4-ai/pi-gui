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
| 2 | [phase-2-quality-infrastructure.md](phase-2-quality-infrastructure.md) | Lint + unit tests must exist BEFORE the big refactors in phases 3–4 so they act as a safety net | complete; full GitHub CI, Linux unit, macOS Electron core, and Linux AppImage proof green |
| 3 | [phase-3-renderer-decomposition.md](phase-3-renderer-decomposition.md) | App.tsx breakup; prerequisite for state-sync rework touching the same surfaces | complete; core, real-provider live, and native Electron proof green |
| 4 | [phase-4-state-sync-rearchitecture.md](phase-4-state-sync-rearchitecture.md) | Delta-based IPC state/transcript sync; fixes chat perf at the root | complete; full core/real-provider live/native green and long-transcript perf recorded |
| 5 | [phase-5-product.md](phase-5-product.md) | Auto-update, crash reporting, onboarding, Windows — best built on the cleaned foundation | in progress; 5a local updater integration, 5b crash/error reporting including packaged forced-crash proof, 5c first-run onboarding, 5d platform decision, and 5e website/docs implemented |
| — | [agents-and-subagents.md](agents-and-subagents.md) | Typed subagent lifecycle, durable runs, structured results; W1/W4 coordinate with phase 4's event protocol, W2 output cap + parser + full-output affordance and W3 persistence can start now | complete; W1–W7 and every built-in workflow verified against a real provider on Electron |
| PX0–PX8 | [product-experience-roadmap.md](product-experience-roadmap.md) | Evidence and safety foundations must precede checkpoints, provenance, branch comparison, and advanced review UX | complete; all 367 checklist items and unit/core/live/native/packaged/accessibility/performance/visual proof green |
| DM0–DM7 | [display-mode-performance.md](display-mode-performance.md) | Bounded projections, durable interaction state, and viewport residency are required before Display Mode can scale safely | complete; 200-session Electron proof and full core audit passed |

## Current Health Snapshot

- Phase 1 is complete, including the real Electron native paste/focus proof. Phases 3 and 4 are complete: after OpenAI re-authentication on 2026-07-21, all six provider-gated Electron cases passed, and the final real-auth live lane passed 39/39.
- Phase 2 is complete. Lint, unit, typecheck, 155/155 macOS Electron core tests, and Linux AppImage packaging passed in GitHub Actions on 2026-07-21; the Ubuntu `node-pty` unit coupling is removed. `@legendapp/list` is upgraded to 3.3.3 with timeline, packaged-app, runtime-dependency, and release-zip proof. `parse5`/`yargs` remain compatibility versions required by the bundled upstream runtime, not independent local upgrade TODOs.
- Phase 0 is complete. Local secret files, leaked local history refs, stale worktrees/branches, and `agentlog.txt` are cleaned up; GitHub secret scanning/push protection are enabled; the unrelated product's historical external credential rotation was explicitly waived on 2026-07-21.
- Phase 5 is mostly implementation-complete, but not fully closeable until the auto-update signed staging round-trip is run with real N/N+1 release artifacts. Local updater integration and Homebrew guidance are implemented; first-run onboarding has packaged proof; platform expansion now has a decision; crash/error reporting has zero-infra issue-draft, local native crash artifact, first-run reporting opt-in UX, and packaged forced-crash proof; website/docs are implemented.
- Agents/subagents W1–W7 are complete. Every built-in workflow passed against the real provider, including exact child aggregation, structured tool-use counts, a mid-run Electron relaunch with honest interrupted-state hydration, and a clean retry to completion.
- UI polish is archived as complete in [`../ui-polish.md`](../ui-polish.md) after the final light/dark screenshot harness, update-ready accent neutralization, and focus-reset cleanup.
- The next product-experience program is planned in [`product-experience-roadmap.md`](product-experience-roadmap.md). It covers all 52 accepted follow-up suggestions across immediate UI clarity, evidence-backed completion, checkpoints/undo, context and approvals, timeline/subagent legibility, branching/memory, guided review, artifacts/workspace productivity, and final Display Mode/delight work.
- 2026-07-26 product-experience implementation and verification are complete across PX0–PX8. Final proof includes lint, typecheck, 199/199 unit tests, production builds, 179/179 core Electron tests on final source, 40/40 real-provider Electron tests in one lane, 9/9 foreground native Electron tests, repeated timeline pinning (10/10), the focused timeline/change-review lane (11/11), packaged macOS app smoke on final source, and the expanded real-Electron screenshot lane in light, dark, forced-colors, compact, and narrow layouts. The completion audit added a 20,000-action palette regression, direct reduced-motion proof, and a durable evidence/checkpoint/context/export safety contract.
- 2026-07-21 closeout verification is green: lint, typecheck, build, 75 unit tests, 155/155 core Electron tests, 39/39 real-auth live Electron tests, 8/8 native Electron tests, packaged-app smoke, packaged-runtime dependency verification, and extracted release-zip smoke. GitHub Actions also passed gitleaks, lint, typecheck, unit, 155/155 macOS Electron core tests, and Linux AppImage packaging. Only the signed N/N+1 updater staging lane remains external.
- The repo-requested `simplify` closeout command was not available in the local environment on 2026-07-20; manual diff review and `git diff --check` were used instead.

## Rules for executing this roadmap

- Phase 0 items marked **[approval]** are destructive (history rewrite, worktree deletion) and require explicit user go-ahead per root `AGENTS.md` Safety rules. Everything else can proceed.
- Every phase defines success criteria and a verification plan up front; desktop-facing work is not done until verified on the real Electron surface.
- Update the Status column here as phases start/land; move a phase file to `plans/` (archived) when complete.
- Commit in small checkpoints inside each phase; run `simplify` before closing each phase when available, and record it as blocked when the command is missing.
- If a phase reveals missing repo knowledge, add it under `docs/` or a path-scoped `AGENTS.md` in the same change.
