# Chat Layout Performance Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and fix the chat timeline jiggle and the scrollbar/scroll-thumb behavior that prevents users from scrolling up during active chat.

**Architecture:** Add opt-in renderer diagnostics that measure layout shifts, timeline row resizes, scroll state, composer height, and long tasks without changing normal app behavior. Use the diagnostics to drive one focused scroll fix: native scrollbar movement must count as user intent, so auto-follow cannot yank the timeline back down while the user is trying to read older messages. Keep diagnostics behind env flags and retain only reusable, low-noise infrastructure.

**Tech Stack:** Electron + React + Playwright, existing desktop renderer diagnostics IPC, `PerformanceObserver`, `ResizeObserver`, targeted core e2e tests.

---

## Worktree and Launch Rules

- Worktree path: `.worktrees/layout-perf-diagnostics`
- Branch: `feature/layout-perf-diagnostics`
- Base: current local `main` at `f5bafc8 feat(desktop): choose thinking shuriken`
- Do not run this worktree with empty temp data for manual testing.
- When launching the diagnostic app for real-surface testing, stop the root `main` dev app first because both use the same Electron single-instance profile lock.
- Launch command for real data:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/.worktrees/layout-perf-diagnostics
PI_APP_DEV_PORT=5175 \
PI_APP_USER_DATA_DIR="$HOME/Library/Application Support/pi" \
PI_CODING_AGENT_DIR="$HOME/.pi/agent" \
PI_APP_LAYOUT_MONITOR=1 \
PI_APP_PERF_MONITOR=1 \
PI_APP_OPEN_DEVTOOLS=0 \
PI_APP_MEMORY_MONITOR=1 \
pnpm --filter @pi-gui/desktop dev
```

Expected manual-test surface: existing real conversations, real sidebar state, real skills/agent config, not a blank temp profile.

---

## Files

- Create: `apps/desktop/src/timeline-diagnostics.ts`
  - Owns env-gated layout/perf probes and structured diagnostic reporting.
- Modify: `apps/desktop/src/ipc.ts`
  - Allow renderer diagnostic payloads to carry structured `details`.
- Modify: `apps/desktop/src/App.tsx`
  - Installs diagnostics for the selected timeline/composer.
  - Fixes native scrollbar-up scroll intent detection.
- Modify: `apps/desktop/src/conversation-timeline.tsx`
  - Adds stable row metadata useful for diagnostics, if needed.
- Test: `apps/desktop/tests/core/timeline-pinning.spec.ts`
  - Add a regression for native scrollbar/manual scroll without wheel/pointer intent.
- Optional test: `apps/desktop/tests/core/timeline-diagnostics.spec.ts`
  - Verifies diagnostics stay opt-in and emit useful records when enabled.

---

### Task 1: Add the scrollbar-up regression first

**Files:**
- Modify: `apps/desktop/tests/core/timeline-pinning.spec.ts`

- [ ] **Step 1: Add a failing test for native scrollbar-style upward scroll**

Append this test near the existing streaming/pinning tests. It intentionally changes `scrollTop` and dispatches `scroll` without wheel/pointer events. That simulates scrollbar thumb movement or other native scrolls that do not trip the current `userTimelineScrollIntentRef` path.

```ts
test("native timeline scroll away from bottom disables follow-latest during streaming", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-scroll-away-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Native scroll away session");
    await seedTranscriptMessages(harness, window, {
      count: 32,
      textFactory: (index) => `Native scroll seed row ${index} ${"wrapped text ".repeat(12)}`,
    });

    await jumpTimelineToBottom(window);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    await window.evaluate(() => {
      const pane = document.querySelector<HTMLDivElement>("[data-testid='timeline-pane']");
      if (!pane) throw new Error("timeline pane missing");
      pane.scrollTop = Math.max(0, pane.scrollTop - 360);
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const awayMetrics = await getTimelineScrollMetrics(window);
    expect(awayMetrics.remainingFromBottom).toBeGreaterThan(120);
    const beforeStreamScrollTop = awayMetrics.scrollTop;

    await streamAssistantDeltas(harness, window, [
      "NATIVE_SCROLL_STREAM_A ",
      "NATIVE_SCROLL_STREAM_B ",
      "NATIVE_SCROLL_STREAM_C ",
    ]);

    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return Math.abs(metrics.scrollTop - beforeStreamScrollTop);
    }).toBeLessThanOrEqual(16);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(1);
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run the test and verify it fails on current behavior**

Run:

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts -g "native timeline scroll away"
```

Expected: FAIL because the app treats a native scroll with no wheel/pointer intent as non-user movement and can keep `followingLatestRef` true or restore the old position.

- [ ] **Step 3: Commit the failing regression**

```bash
git add apps/desktop/tests/core/timeline-pinning.spec.ts
git commit -m "test(desktop): cover native timeline scroll intent"
```

---

### Task 2: Fix native scrollbar/manual scroll intent

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add a previous-scroll-top ref near the other timeline refs**

Add near `lastTimelineScrollTopBySessionRef`:

```ts
const previousTimelineScrollTopRef = useRef<number | null>(null);
```

- [ ] **Step 2: Reset the ref on session changes and pane mount**

Inside the `useLayoutEffect(() => { ... }, [selectedSessionKey])` block, add:

```ts
previousTimelineScrollTopRef.current = null;
```

Inside `setTimelinePaneElement`, after `timelinePaneRef.current = node`, add:

```ts
previousTimelineScrollTopRef.current = node?.scrollTop ?? null;
```

- [ ] **Step 3: Treat upward scroll deltas as user intent even without wheel/pointer events**

In `handleTimelineScroll`, replace the current `userScrollIntent` calculation with this shape:

```ts
const previousScrollTop = previousTimelineScrollTopRef.current;
const nextScrollTop = pane.scrollTop;
const movedUp = previousScrollTop !== null && nextScrollTop < previousScrollTop - 2;
const movedDown = previousScrollTop !== null && nextScrollTop > previousScrollTop + 2;
const programmaticScroll = manualTimelineScrollRestoreRef.current || autoAligningTimelineRef.current;
const explicitUserScrollIntent = userTimelineScrollIntentRef.current && performance.now() - lastUserTimelineScrollIntentAtRef.current < 300;
const nativeUserScrollIntent = !programmaticScroll && movedUp;
const userScrollIntent = explicitUserScrollIntent || nativeUserScrollIntent;
previousTimelineScrollTopRef.current = nextScrollTop;
userTimelineScrollIntentRef.current = false;
```

Keep the existing pinned/following branches, but make sure the upward native scroll path reaches:

```ts
pinnedToBottomRef.current = false;
followingLatestRef.current = false;
manualTimelineScrollTopRef.current = pane.scrollTop;
captureManualTimelineAnchor();
preserveBottomOnNextPaneResizeRef.current = false;
resetExactBottomRestoreState();
lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, false);
return;
```

`movedDown` is computed for diagnostics and future tuning; do not make downward scroll automatically follow latest unless `isNearBottom(pane)` is true.

- [ ] **Step 4: Run the focused regression**

Run:

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts -g "native timeline scroll away"
```

Expected: PASS.

- [ ] **Step 5: Commit the fix**

```bash
git add apps/desktop/src/App.tsx apps/desktop/tests/core/timeline-pinning.spec.ts
git commit -m "fix(desktop): respect native timeline scroll intent"
```

---

### Task 3: Add opt-in timeline diagnostics

**Files:**
- Create: `apps/desktop/src/timeline-diagnostics.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Extend renderer diagnostic payloads**

In `apps/desktop/src/ipc.ts`, change `RendererDiagnosticPayload` to include details:

```ts
export interface RendererDiagnosticPayload {
  readonly kind: string;
  readonly message?: string;
  readonly stack?: string;
  readonly componentStack?: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly href?: string;
  readonly userAgent?: string;
  readonly timestamp?: string;
  readonly details?: unknown;
}
```

- [ ] **Step 2: Create `timeline-diagnostics.ts`**

Implement the module with env-gated probes. The renderer cannot directly read `process.env`, so use Vite env injection through `import.meta.env`; Electron-vite exposes mode envs prefixed in the bundled process replacement. If that is not reliable, fall back to URL/localStorage toggles during dev.

```ts
import { useEffect, type MutableRefObject, type RefObject } from "react";
import type { TranscriptMessage } from "./desktop-state";
import { reportRendererDiagnostic } from "./renderer-diagnostics";

interface TimelineDiagnosticsOptions {
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly transcript: readonly TranscriptMessage[];
  readonly selectedSessionKey: string;
  readonly followingLatest: boolean;
  readonly pinnedToBottom: boolean;
}

function diagnosticsEnabled(name: "PI_APP_LAYOUT_MONITOR" | "PI_APP_PERF_MONITOR"): boolean {
  const globalValue = typeof window !== "undefined" ? window.localStorage.getItem(name) : null;
  const viteValue = typeof import.meta !== "undefined" ? (import.meta.env?.[name] as string | undefined) : undefined;
  return globalValue === "1" || viteValue === "1";
}

function emitTimelineDiagnostic(kind: string, details: Record<string, unknown>): void {
  reportRendererDiagnostic({
    kind,
    message: `[DEBUG-timeline] ${kind}`,
    timestamp: new Date().toISOString(),
    details,
  });
}

export function useTimelineDiagnostics(options: TimelineDiagnosticsOptions): void {
  useLayoutShiftDiagnostics(options);
  useRowResizeDiagnostics(options);
  useScrollFrameDiagnostics(options);
  useComposerResizeDiagnostics(options);
  useLongTaskDiagnostics(options);
}
```

Then fill in the five hooks:

- `useLayoutShiftDiagnostics`: `PerformanceObserver` for `layout-shift`, ignore entries with `hadRecentInput`, report value and source node labels.
- `useRowResizeDiagnostics`: `ResizeObserver` for `[data-timeline-row-id]`, report row id/kind/status and height deltas >= 2px.
- `useScrollFrameDiagnostics`: while layout monitor is enabled and session is running/streaming, sample `scrollTop`, `scrollHeight`, `clientHeight`, `remainingFromBottom`, visible first/last row ids once per animation frame for 30 seconds after transcript length changes.
- `useComposerResizeDiagnostics`: `ResizeObserver` on composer textarea, report height deltas.
- `useLongTaskDiagnostics`: `PerformanceObserver` for `longtask` when perf monitor is enabled.

- [ ] **Step 3: Install diagnostics from `App.tsx`**

Import:

```ts
import { useTimelineDiagnostics } from "./timeline-diagnostics";
```

Call near other timeline effects:

```ts
useTimelineDiagnostics({
  timelinePaneRef,
  composerRef,
  transcript: activeTranscript,
  selectedSessionKey,
  followingLatest: followingLatestRef.current,
  pinnedToBottom: pinnedToBottomRef.current,
});
```

- [ ] **Step 4: Run typecheck**

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit diagnostics infrastructure**

```bash
git add apps/desktop/src/timeline-diagnostics.ts apps/desktop/src/ipc.ts apps/desktop/src/App.tsx
git commit -m "feat(desktop): add timeline layout diagnostics"
```

---

### Task 4: Add smoothness regression coverage

**Files:**
- Modify: `apps/desktop/tests/core/timeline-pinning.spec.ts`

- [ ] **Step 1: Add a pinned-stream stability test**

Add a test that streams chunks while pinned to bottom and samples the last visible row/composer position before and after. Use a tolerance instead of pixel-perfect equality.

```ts
test("pinned streaming keeps the visible bottom stable", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("pinned-stream-stability-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Pinned stream stability session");
    await seedTranscriptMessages(harness, window, {
      count: 28,
      textFactory: (index) => `Pinned stability row ${index} ${"content ".repeat(10)}`,
    });
    await jumpTimelineToBottom(window);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const composerShell = window.locator(".composer-shell");
    const beforeComposerBox = await composerShell.boundingBox();
    const beforeMetrics = await getTimelineScrollMetrics(window);

    await streamAssistantDeltas(harness, window, [
      "STABILITY_STREAM_A ",
      "STABILITY_STREAM_B ",
      "STABILITY_STREAM_C ",
      "STABILITY_STREAM_D ",
    ]);

    const afterComposerBox = await composerShell.boundingBox();
    const afterMetrics = await getTimelineScrollMetrics(window);
    expect(afterMetrics.remainingFromBottom).toBeLessThanOrEqual(16);
    expect(Math.abs((afterComposerBox?.y ?? 0) - (beforeComposerBox?.y ?? 0))).toBeLessThanOrEqual(2);
    expect(afterMetrics.scrollTop).toBeGreaterThanOrEqual(beforeMetrics.scrollTop);
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run focused tests**

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts -g "native timeline scroll away|pinned streaming keeps"
```

Expected: PASS.

- [ ] **Step 3: Commit tests**

```bash
git add apps/desktop/tests/core/timeline-pinning.spec.ts
git commit -m "test(desktop): cover timeline streaming stability"
```

---

### Task 5: Real-surface diagnostic capture

**Files:**
- No code changes unless diagnostics show a clear culprit.

- [ ] **Step 1: Stop root main dev app before launching worktree with real data**

Use the current PID file if present, then verify no real-data Electron app remains:

```bash
if [ -f /tmp/pi-gui-main-dev.pid ]; then kill "$(cat /tmp/pi-gui-main-dev.pid)" 2>/dev/null || true; fi
ps -axo pid,args | grep 'Electron' | grep '/Users/brianfarley/Library/Application Support/pi' | grep -v grep || true
```

- [ ] **Step 2: Launch diagnostic worktree with real data**

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/.worktrees/layout-perf-diagnostics
PI_APP_DEV_PORT=5175 \
PI_APP_USER_DATA_DIR="$HOME/Library/Application Support/pi" \
PI_CODING_AGENT_DIR="$HOME/.pi/agent" \
PI_APP_LAYOUT_MONITOR=1 \
PI_APP_PERF_MONITOR=1 \
PI_APP_OPEN_DEVTOOLS=0 \
PI_APP_MEMORY_MONITOR=1 \
nohup pnpm --filter @pi-gui/desktop dev > /tmp/pi-gui-layout-perf-dev.log 2>&1 & echo $! > /tmp/pi-gui-layout-perf-dev.pid
```

- [ ] **Step 3: Reproduce**

Manual scenario:
1. Open an existing real conversation with enough history to scroll.
2. Start a representative chat/run.
3. While it streams, drag the scrollbar thumb upward and use the trackpad/wheel upward.
4. Watch whether the timeline yanks back to bottom.
5. Let 30–60 seconds of diagnostics accumulate.

- [ ] **Step 4: Inspect logs**

```bash
grep 'renderer-diagnostic' "$HOME/Library/Application Support/pi/logs/desktop.log" | grep 'DEBUG-timeline' | tail -n 200
```

Expected evidence shape:

```json
{"kind":"timeline-row-resize","details":{"rowId":"...","delta":18,"kind":"tool","status":"running"}}
{"kind":"timeline-scroll-frame","details":{"scrollTop":1234,"remainingFromBottom":0,"followingLatest":true}}
{"kind":"timeline-layout-shift","details":{"value":0.012,"sources":[".timeline-tool__body"]}}
```

- [ ] **Step 5: Write the finding in the commit or final report**

Required finding format:

```txt
Cause: <specific element or scroll state transition>
Evidence: <diagnostic event names and deltas>
Fix: <code path changed>
Verification: <commands and manual real-data scenario>
```

---

### Task 6: Verification before merge

**Files:**
- All changed files.

- [ ] **Step 1: Run typecheck**

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 2: Run build**

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop build
```

Expected: PASS.

- [ ] **Step 3: Run focused e2e**

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts -g "native timeline scroll away|pinned streaming keeps"
```

Expected: PASS.

- [ ] **Step 4: Run broader relevant core specs if focused tests pass**

```bash
cd .worktrees/layout-perf-diagnostics
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts apps/desktop/tests/core/composer-controls.spec.ts
```

Expected: PASS or document known unrelated `timeline-pinning.spec.ts` failures if they still reproduce on clean `main`.

- [ ] **Step 5: Commit final cleanup**

```bash
git status --short
git diff --check
git add apps/desktop/src apps/desktop/tests/core/timeline-pinning.spec.ts
git commit -m "fix(desktop): stabilize chat timeline scrolling"
```

---

## Self-Review

- Spec coverage: The plan covers diagnostics, scrollbar/native scroll intent, streaming jiggle, real-data launch, regression tests, and verification.
- Placeholder scan: No `TBD`, `TODO`, or open-ended test commands remain.
- Type consistency: Planned names match existing files and concepts: `timelinePaneRef`, `composerRef`, `activeTranscript`, `RendererDiagnosticPayload`, `reportRendererDiagnostic`, `timeline-pinning.spec.ts`.
- Scope: Focused on chat timeline smoothness and diagnostics only. Broader app optimization comes after this trace identifies concrete hotspots.
