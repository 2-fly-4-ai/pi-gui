# Plans Index

This directory holds durable execution plans for the Pi desktop app. Current work lives under
[`active/`](active/); older or standalone plans remain here until they are folded into docs or
archived elsewhere.

## Active

- [`active/README.md`](active/README.md) - current deep-review remediation roadmap and status table.
- [`active/phase-0-secrets-and-hygiene.md`](active/phase-0-secrets-and-hygiene.md) - secrets remediation, repo hygiene, and agent harness.
- [`active/phase-1-electron-hardening.md`](active/phase-1-electron-hardening.md) - Electron security and boundary hardening.
- [`active/phase-2-quality-infrastructure.md`](active/phase-2-quality-infrastructure.md) - lint, unit tests, CI, and dependency hygiene.
- [`active/phase-3-renderer-decomposition.md`](active/phase-3-renderer-decomposition.md) - renderer/App decomposition and CSS split.
- [`active/phase-4-state-sync-rearchitecture.md`](active/phase-4-state-sync-rearchitecture.md) - state/transcript sync rearchitecture and timeline correctness.
- [`active/phase-5-product.md`](active/phase-5-product.md) - product maturity: updates, crash reporting, onboarding, platforms, website/docs.
- [`active/agents-and-subagents.md`](active/agents-and-subagents.md) - typed subagent lifecycle, durable runs, and structured results.

## Standalone Or Archived

- [`display-mode.md`](display-mode.md) - display mode plan; partially superseded by the active roadmap's state-sync and polish work.
- [`ui-polish.md`](ui-polish.md) - completed 2026-07-10 minimalist visual polish cleanup pass.
- [`phase-1-codex-parity/plan.md`](phase-1-codex-parity/plan.md) - early Codex parity plan retained for historical context.
- [`pi-app-mvp/plan.md`](pi-app-mvp/plan.md) - MVP plan retained for historical context.
- [`sidebar-unseen-notification-consistency/plan.md`](sidebar-unseen-notification-consistency/plan.md) - sidebar unread/notification consistency plan retained for historical context.

When a plan graduates, either move it out of `active/` or update this index with its final status and replacement source of truth.
