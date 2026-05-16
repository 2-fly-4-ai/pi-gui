# Port Performance Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the valuable, non-overlapping work from `perf/chat-performance-foundation` onto the current polished `main` without regressing the approved composer/settings/GitHub UX.

**Architecture:** Keep `main` as the source of truth. Manually port feature groups from the perf branch in small commits, skipping the older Git quick actions implementation because `main` has the newer GitHub dialogs. Resolve conflicts in favor of current `main` UX unless the perf branch adds isolated behavior.

**Tech Stack:** Electron, React, TypeScript, Playwright, Vitest, pnpm workspace.

---

## Feature Groups

### Task 1: Chat streaming performance foundation

**Bring forward:** assistant delta batching, timeline row stability/virtualization, markdown memoization, and chat performance regression coverage.

**Source commits:**
- `0589356 test: cover chat streaming performance regressions`
- `6dd2ed4 test: harden chat performance diagnostics`
- `1b1a4f2 test: fix virtualization diagnostic row count`
- `cb8af31 perf: coalesce assistant transcript deltas`
- `fc5f1b9 perf: isolate composer renders from transcript updates`
- `3eed6ee perf: avoid stringifying transcripts during scroll sync`
- `44a5730 perf: preserve stable timeline row identities`
- `911b030 perf: keep long assistant messages virtualized`
- `09b9306 perf: memoize markdown timeline rendering`
- `fd8b669 test: keep chat diagnostics test-scoped`
- `a04f20b perf: recover after assistant flush failures`

**Files:**
- Create: `apps/desktop/electron/assistant-delta-batcher.ts`
- Create/modify: `apps/desktop/src/conversation-timeline-rows.ts`
- Modify: `apps/desktop/electron/app-store-composer.ts`
- Modify: `apps/desktop/src/conversation-timeline.tsx`
- Modify: `apps/desktop/src/timeline-item.tsx`
- Modify: `apps/desktop/src/message-markdown.tsx`
- Modify: `apps/desktop/src/composer-panel.tsx`
- Test: `apps/desktop/tests/core/chat-performance.spec.ts`
- Test: `apps/desktop/tests/core/timeline-layout.spec.ts`
- Test helper: `apps/desktop/tests/helpers/electron-app.ts`

**Verification:**
```bash
pnpm --filter @pi-gui/desktop typecheck
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts apps/desktop/tests/core/timeline-layout.spec.ts apps/desktop/tests/core/composer-controls.spec.ts
```

### Task 2: Terminal selection context

**Bring forward:** selected terminal text can be formatted and sent to chat without losing markdown.

**Source commits:**
- `c542cc4 feat: format terminal selections for chat`
- `e74ea92 fix: preserve terminal selection markdown`
- `2f3cccb test: cover terminal selection context`
- `5b9a4a3 test: tighten terminal selection context coverage`
- `0c84020 feat: add terminal selections to chat`
- `790f391 fix: constrain terminal selection fallback`

**Files:**
- Create: `apps/desktop/src/terminal-selection-context.ts`
- Modify: `apps/desktop/src/terminal-panel.tsx`
- Modify: `apps/desktop/src/composer-panel.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/tests/core/integrated-terminal.spec.ts`

**Verification:**
```bash
pnpm --filter @pi-gui/desktop typecheck
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/integrated-terminal.spec.ts apps/desktop/tests/core/composer-controls.spec.ts
```

### Task 3: Command palette

**Bring forward:** command palette model/UI, shortcut routing, keyboard access, and actions.

**Source commits:**
- `771d0fe feat: add command palette model`
- `052ae30 test: cover command palette`
- `aebc0fe feat: route command palette shortcut`
- `237ecdd feat: add command palette surface`
- `857c4f3 fix: improve command palette keyboard access`
- `48bf7d6 feat: wire command palette actions`
- `43c5f25 fix: skip disabled command palette actions`

**Files:**
- Create: `apps/desktop/src/command-palette-model.ts`
- Create: `apps/desktop/src/command-palette.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/topbar.tsx`
- Test: `apps/desktop/tests/core/navigation.spec.ts`

**Verification:**
```bash
pnpm --filter @pi-gui/desktop typecheck
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/navigation.spec.ts apps/desktop/tests/core/composer-controls.spec.ts
```

### Task 4: Assistant plan panel

**Bring forward:** plan detection, assistant plan panel surface, markdown plan title, and thread-only gating.

**Source commits:**
- `8a992b9 feat: detect assistant plans`
- `798affd fix: detect simple plan headings`
- `cd07fce test: cover assistant plan panel`
- `f92914a test: tighten latest plan panel coverage`
- `3fbaec7 feat: add assistant plan panel surface`
- `0fce24e fix: render plan title as markdown`
- `f78ed75 feat: show assistant plan panel`
- `08a6e86 fix: gate plan panel to thread view`
- `7deca44 style: add plan panel grid texture`
- `24c6ddd style: align git and plan surfaces`

**Files:**
- Create: `apps/desktop/src/plan-panel-model.ts`
- Create: `apps/desktop/src/plan-panel.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/display-mode-view.tsx`
- Modify: `apps/desktop/src/message-markdown.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/display-mode.spec.ts`
- Test: `apps/desktop/tests/core/timeline-layout.spec.ts`

**Verification:**
```bash
pnpm --filter @pi-gui/desktop typecheck
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/display-mode.spec.ts apps/desktop/tests/core/timeline-layout.spec.ts
```

### Task 5: Small layout fixes

**Inspect and port if still relevant:**
- `624e331 fix: wait for vscode webview readiness`
- `f3ebf20 fix: collapse compacted session summaries`
- `edb7d62 fix: make sidebar toggle responsive`
- `a24aea6 fix: keep toaster out of shell layout`
- `32a2dba fix: render toaster outside shell grid`

**Verification:** run targeted Playwright tests for each touched surface and `typecheck`.

### Explicit skips

Do not port the perf branch's older Git quick actions implementation unless a specific missing behavior is identified. Current `main` owns GitHub actions and dialogs.
