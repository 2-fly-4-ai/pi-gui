# Thread Scroll and VS Code Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix chat timeline bouncing/autofollow behavior and make the VS Code side panel use one shared, display-mode-compatible width model across Thread and Display Mode.

**Architecture:** `App.tsx` owns the shared VS Code panel width and the thread timeline follow state. `DisplayModeView` becomes a consumer of the shared width and resize callback instead of owning a duplicate VS Code width. Timeline scrolling uses explicit follow mode: following latest auto-pins, user scroll-away pauses auto-follow and shows the jump button, clicking the jump button resumes follow.

**Tech Stack:** React 19, Electron renderer, Playwright Electron E2E core lane, localStorage for persisted panel width.

---

## Task 1: Share VS Code panel width across Thread and Display Mode

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/display-mode-view.tsx`
- Test: `apps/desktop/tests/core/display-mode.spec.ts`

- [ ] Replace fixed Thread VS Code max width (`900`) with helpers equivalent to Display Mode: min is `min(360, max(280, floor(containerWidth * 0.3)))`, max is `max(min, floor(containerWidth * 0.7))`.
- [ ] Keep `threadVsCodeWidth` in `App.tsx` as the single source of truth, rename if useful to `vsCodeSidePanelWidth`.
- [ ] Pass shared `vsCodeSidePanelWidth` and `onVsCodeSidePanelWidthChange` into `DisplayModeView`.
- [ ] Remove Display Mode's local `vsCodeWidth` state and make `startVsCodeResize` update the shared width.
- [ ] Clamp persisted/shared width when the active slot/container is narrower than the saved width.
- [ ] Update ARIA `aria-valuemax` for the Thread resize separator to match the dynamic max.
- [ ] Add/extend a Playwright assertion that resizing VS Code in Display Mode and switching back to Thread preserves the same panel width within a small tolerance.

## Task 2: Make thread timeline follow mode explicit

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/tests/core/timeline-pinning.spec.ts`

- [ ] Add an explicit `followingLatestRef` initialized to `true` per selected session.
- [ ] In `handleTimelineScroll`, when the pane is no longer near bottom and the scroll was user-visible, set `followingLatestRef.current = false`, update the per-session pinned map, and allow new transcript activity to show `timeline-jump` instead of auto-scrolling.
- [ ] In `scrollTimelineToBottom` / `jumpToLatest`, set `followingLatestRef.current = true` only for intentional bottom jumps.
- [ ] Update transcript-change effect: if following latest, coalesced auto-align to bottom; otherwise do not mutate scrollTop and show `New activity below`.
- [ ] Update composer resize effect so typing only preserves bottom when following latest, and does not force virtualization/restoration while the user is away from bottom.
- [ ] Reduce repeated bottom realignment loops so normal typing/output does not cause visible bounce. Keep only enough retrying for actual content growth while following latest.
- [ ] Add/extend Playwright assertions: scrolling up while assistant output streams keeps scrollTop stable and shows the jump button; clicking the button returns to bottom and resumes following for subsequent output; typing into the composer while idle does not move an off-bottom thread.

## Task 3: Verify and clean up

**Files:**
- Modify: implementation files from Tasks 1-2 only, plus tests.

- [ ] Run `pnpm --filter @pi-gui/desktop typecheck`.
- [ ] Run targeted core specs:
  - `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts apps/desktop/tests/core/display-mode.spec.ts`
- [ ] If targeted specs pass, run the owning core lane if time permits: `pnpm --filter @pi-gui/desktop run test:e2e:core`.
- [ ] Run code-simplify review on touched code and remove unnecessary complexity without broad refactors.
- [ ] Report exact verification results and remaining risks.
