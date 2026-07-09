# Agent-First Change Workflow

Use this loop for non-trivial repo work. The goal is to make the task legible to future agents, not just to land code once.

## 1. Orient

- Read `AGENTS.md`, `docs/README.md`, `docs/SOURCE_OF_TRUTH.md`, and the closest path-scoped `AGENTS.md`.
- Read the relevant active plan under `plans/active/` when one exists.
- Define success criteria before editing.
- Identify approval gates before running commands that delete, rewrite history, publish, or mutate production.

## 2. Plan Verification

- Map changed files to the closest package and real user surface.
- Read package scripts before assuming command names.
- For desktop-visible behavior, plan an Electron verification lane.
- For docs-only work, verify links, path references, and repository invariants such as the `CLAUDE.md` symlink.

## 3. Implement

- Keep edits scoped to the owning package, doc, or plan.
- Prefer existing helpers and local patterns.
- If the task exposes missing knowledge, add or update a doc instead of relying on chat context.
- If the same rule should apply repeatedly, prefer a script, lint, CI check, or checklist that future agents can run.

## 4. Prove

- Run the smallest convincing check while iterating.
- Before closing, run the strongest practical verification for the changed surface.
- Record exact commands and blockers in the final handoff.

## 5. Keep The Harness Clean

- Keep `AGENTS.md` short and route deeper guidance into `docs/`.
- Move completed plans out of `plans/active/` or clearly mark them historical.
- Do not leave secret values, private artifacts, or ambiguous generated files behind.
