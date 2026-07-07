# Pi Goal Desktop Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `pi-goal` into pi-gui as a built-in persistent per-thread goal feature with `/goal` commands, model-callable goal tools, compact topbar status, and expandable composer details.

**Architecture:** Implement the goal runtime as a built-in pi extension factory inside `@pi-gui/pi-sdk-driver`, reusing the upstream `pi-goal` store/format/prompt/accounting semantics but adapting UI output to pi-gui's supported `setStatus`/`setWidget` host UI. Add a desktop renderer parser that recognizes the goal extension UI state and renders a compact topbar pill while the existing extension dock provides expandable composer details.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` extension API, `typebox` schemas, Electron renderer React, Playwright Electron live lane.

---

## Scope

- Add built-in goal extension support to session runtime creation.
- Port `pi-goal` command/tool/store/accounting behavior with desktop-safe UI.
- Render goal status in both topbar and composer dock.
- Add focused live Electron regression coverage for `/goal` set/pause/resume/clear UI behavior.

## Non-Goals

- Do not change user-installed extension discovery or delete/move custom extensions.
- Do not add arbitrary TUI custom-component support to pi-gui.
- Do not redesign the extension dock outside the goal-specific topbar pill.
- Do not require users to install `code-yeongyu/pi-goal` separately.

## Acceptance Criteria

- `/goal <objective>`, `/goal`, `/goal pause`, `/goal resume`, and `/goal clear` are available in pi-gui sessions by default.
- The model has `create_goal`, `get_goal`, and `update_goal` tools, with `update_goal` limited to `complete`.
- Goal state persists per thread/session and survives app reload through a JSON file in the session extension store.
- Active, paused, budget-limited, and complete goals update pi-gui extension UI through a composer dock summary/body.
- Active/paused/budget-limited/complete goals render as a compact topbar indicator on thread view.
- Setting/resuming an active goal queues the hidden continuation prompt unless disabled by `PI_GOAL_DISABLE_CONTINUATION=1` for deterministic tests.
- Verification includes typecheck/build plus a targeted real Electron Playwright live spec.

## File Structure

- Create `packages/pi-sdk-driver/src/goal/types.ts`: goal domain types and guards.
- Create `packages/pi-sdk-driver/src/goal/validation.ts`: objective and token-budget validation.
- Create `packages/pi-sdk-driver/src/goal/store.ts`: per-session JSON persistence and accounting.
- Create `packages/pi-sdk-driver/src/goal/format.ts`: labels, compact token/time formatting, tool responses.
- Create `packages/pi-sdk-driver/src/goal/prompt.ts`: hidden continuation and budget-limit prompts.
- Create `packages/pi-sdk-driver/src/goal/continuation.ts`: continuation gating helpers.
- Create `packages/pi-sdk-driver/src/goal/command.ts`: `/goal` argument parser.
- Create `packages/pi-sdk-driver/src/goal/ui.ts`: desktop-safe `setStatus`/`setWidget` updates.
- Create `packages/pi-sdk-driver/src/goal/extension.ts`: built-in extension factory registering tools, commands, and lifecycle hooks.
- Modify `packages/pi-sdk-driver/src/npm-package-fallback.ts`: include the built-in goal extension factory in `resourceLoaderOptions.extensionFactories`.
- Modify `packages/pi-sdk-driver/package.json`: add direct `typebox` runtime dependency.
- Create `apps/desktop/src/goal-session-ui.ts`: parse goal status/details from `SessionExtensionUiStateRecord` for topbar rendering.
- Modify `apps/desktop/src/topbar.tsx`: accept and render `goalIndicator`.
- Modify `apps/desktop/src/App.tsx`: derive selected goal indicator and pass it to `Topbar`.
- Modify `apps/desktop/src/styles/main.css`: style the compact goal pill.
- Create `apps/desktop/tests/live/pi-goal.spec.ts`: real Electron regression coverage.

## Tasks

### Task 1: Port goal domain/runtime files into `pi-sdk-driver`

**Files:**
- Create: `packages/pi-sdk-driver/src/goal/types.ts`
- Create: `packages/pi-sdk-driver/src/goal/validation.ts`
- Create: `packages/pi-sdk-driver/src/goal/store.ts`
- Create: `packages/pi-sdk-driver/src/goal/format.ts`
- Create: `packages/pi-sdk-driver/src/goal/prompt.ts`
- Create: `packages/pi-sdk-driver/src/goal/continuation.ts`
- Create: `packages/pi-sdk-driver/src/goal/command.ts`

- [ ] Copy upstream behavior from `/tmp/pi-goal/src/goal/*` and adjust imports to local files.
- [ ] Keep the storage schema `{ version: 1, goal }` and statuses `active | paused | budgetLimited | complete`.
- [ ] Keep validation limits: objective max 4,000 characters and positive safe integer token budgets.
- [ ] Run `pnpm --filter @pi-gui/pi-sdk-driver run typecheck` and fix TypeScript errors.

### Task 2: Add desktop-safe goal UI adapter

**Files:**
- Create: `packages/pi-sdk-driver/src/goal/ui.ts`

- [ ] Export stable keys `GOAL_STATUS_KEY = "goal"` and `GOAL_WIDGET_KEY = "goal"`.
- [ ] Implement `goalStatusIndicator(goal)` with text matching upstream intent: `Pursuing goal`, `Goal paused (/goal resume)`, `Goal unmet`, and `Goal achieved` plus compact usage where useful.
- [ ] Implement `updateGoalUi(ctx, goal)` using only `ctx.ui.setStatus()` and `ctx.ui.setWidget()` so pi-gui can render it.
- [ ] Clear both status and widget when `goal === null`.

### Task 3: Register built-in goal extension factory

**Files:**
- Create: `packages/pi-sdk-driver/src/goal/extension.ts`
- Modify: `packages/pi-sdk-driver/src/npm-package-fallback.ts`
- Modify: `packages/pi-sdk-driver/package.json`

- [ ] Port upstream `src/index.ts` to `createGoalExtension(pi)` using `@earendil-works/pi-coding-agent` types and `typebox`.
- [ ] Preserve command behavior and model tool descriptions.
- [ ] Use `goalStoreRef(ctx)` with `ctx.sessionManager.getSessionDir()` and `ctx.sessionManager.getSessionId()`; fall back to `${PI_CODING_AGENT_DIR}/extensions/pi-goal/no-session/<cwd-hash>` when no session file exists.
- [ ] Gate hidden continuation queueing with `process.env.PI_GOAL_DISABLE_CONTINUATION !== "1"` so the live UI test can stay deterministic without changing production default behavior.
- [ ] Add `typebox` to `packages/pi-sdk-driver/package.json` dependencies.
- [ ] Inject the extension factory through `resourceLoaderOptions.extensionFactories` in `createResourceLoaderOptions()` without overriding user/project extension loading.

### Task 4: Render the topbar goal indicator

**Files:**
- Create: `apps/desktop/src/goal-session-ui.ts`
- Modify: `apps/desktop/src/topbar.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`

- [ ] Parse the extension status with key `goal` into `{ text, status }`, where status is inferred from the status text prefix.
- [ ] In `App.tsx`, derive `selectedGoalIndicator` from `selectedExtensionUi` with `useMemo`.
- [ ] Pass `selectedGoalIndicator` to `Topbar`.
- [ ] Render a compact pill with `data-testid="goal-topbar-indicator"` after the session title/running label.
- [ ] Style variants for active, paused, budget-limited, and complete without disrupting existing topbar actions.

### Task 5: Add real Electron regression coverage

**Files:**
- Create: `apps/desktop/tests/live/pi-goal.spec.ts`

- [ ] Launch pi-gui with `envOverrides: { PI_GOAL_DISABLE_CONTINUATION: "1" }`.
- [ ] Create a named thread and wait for `/goal` command discovery in `sessionCommandsBySession`.
- [ ] Submit `/goal Ship the release notes` and assert topbar pill text plus composer dock details.
- [ ] Submit `/goal pause` and assert paused topbar/dock state.
- [ ] Submit `/goal resume` and assert active topbar/dock state.
- [ ] Submit `/goal clear` and assert the goal topbar pill and extension dock disappear.

### Task 6: Verification and checkpoint

**Commands:**
- `pnpm --filter @pi-gui/pi-sdk-driver run typecheck`
- `pnpm --filter @pi-gui/desktop run typecheck`
- `pnpm --filter @pi-gui/desktop run build`
- `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/live/pi-goal.spec.ts`

**Close condition:** Report exact verification output and note if broader live/core lanes remain blocked by unrelated existing failures.

## Self-Review

- Spec coverage: commands, tools, persistence, hidden prompts, composer dock, topbar indicator, and real Electron verification are each covered by a task.
- Placeholder scan: no task relies on TBD/TODO language; every required file and behavior is named.
- Type consistency: goal keys are consistently `goal`; desktop parser consumes `SessionExtensionUiStateRecord`; runtime injects via `extensionFactories`.
