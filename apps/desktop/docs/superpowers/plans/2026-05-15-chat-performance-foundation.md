# Chat Performance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pi-gui chat feel responsive while assistant text streams and while the user types in the composer.

**Architecture:** Borrow t3code's useful patterns without copying its whole server architecture: coalesce streaming deltas before renderer publication, keep composer/timeline components memo-stable, structurally share unchanged transcript rows, avoid expensive `JSON.stringify` marker work, and keep virtualization active for long conversations. Keep Electron IPC boundaries unchanged except for test-only diagnostics.

**Tech Stack:** Electron main/preload/renderer, React 19, Playwright Electron E2E, existing `@pi-gui/session-driver` event model, existing timeline/composer components.

---

## Scope Check

This plan is intentionally limited to chat/composer/timeline performance. The t3code audit also found excellent UX features such as terminal selection → add to chat, command palette, plan sidebar, source-control workflows, and keybindings. Those are independent product features and should each get their own plan after this performance foundation lands.

## Success Criteria

- Typing in the composer remains responsive while selected-session transcript events stream.
- Assistant delta bursts are coalesced before selected-transcript publication, with pending text flushed before run completion/failure/session close.
- Old timeline rows keep object identity across full transcript snapshots so old markdown/tool rows do not rerender on every assistant delta.
- Long assistant messages no longer disable virtualization just because their text is long.
- Timeline bottom pinning and thread search behavior remain correct.
- Verification uses the desktop `core` lane because these changes affect renderer/composer/timeline behavior.

## File Structure

- Modify `electron/app-store.ts`
  - Add assistant-delta batching, test diagnostics, and flush boundaries.
- Create `electron/assistant-delta-batcher.ts`
  - Small focused batching primitive for selected-session assistant deltas.
- Modify `electron/main.ts`
  - Expose test-only diagnostics through existing `__PI_APP_TEST_HOOKS`.
- Modify `tests/helpers/electron-app.ts`
  - Add `getAppDiagnostics()` helper and optional `emitTestSessionEventNoWait()` helper for burst tests.
- Create `tests/core/chat-performance.spec.ts`
  - Regression coverage for composer rerender isolation, assistant-delta coalescing, cheap scrolling, and long-row virtualization.
- Modify `src/composer-panel.tsx`
  - Make composer panel memo-friendly and pass only primitive session status instead of the whole session object.
- Modify `src/composer-surface.tsx`
  - Wrap in `memo`, add render-count diagnostic attribute, and keep textarea work local.
- Modify `src/App.tsx`
  - Use cheap transcript signatures, stable composer props, and stable timeline callbacks.
- Create `src/conversation-timeline-rows.ts`
  - Structural sharing for unchanged transcript rows.
- Modify `src/conversation-timeline.tsx`
  - Use stable transcript rows and keep virtualization enabled for long text.
- Modify `src/timeline-item.tsx`
  - Memoize row-level timeline item rendering.
- Modify `src/message-markdown.tsx`
  - Memoize markdown rendering and avoid recreating work for unchanged text.
- Modify `src/styles/main.css`
  - Style the optional code-copy control without changing markdown layout.

---

## Task 1: Add performance regression coverage and diagnostics hooks

**Files:**
- Create: `tests/core/chat-performance.spec.ts`
- Modify: `tests/helpers/electron-app.ts`
- Modify: `electron/app-store.ts`
- Modify: `electron/main.ts`
- Modify: `src/composer-surface.tsx`

- [ ] **Step 1: Write the failing Playwright regression spec**

Create `tests/core/chat-performance.spec.ts` with this content:

```ts
import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  emitTestSessionEventNoWait,
  getAppDiagnostics,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedTranscriptMessages,
} from "../helpers/electron-app";

async function selectedSessionContext(window: Page) {
  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
  if (!workspace) throw new Error("Expected selected workspace");
  const session = workspace.sessions.find((entry) => entry.id === state.selectedSessionId);
  if (!session) throw new Error("Expected selected session");
  return {
    sessionRef: { workspaceId: workspace.id, sessionId: session.id },
    workspace: { workspaceId: workspace.id, path: workspace.path, displayName: workspace.name },
    title: session.title,
  };
}

function assistantDeltaEvent(
  context: Awaited<ReturnType<typeof selectedSessionContext>>,
  runId: string,
  text: string,
): Extract<SessionDriverEvent, { type: "assistantDelta" }> {
  return {
    type: "assistantDelta",
    sessionRef: context.sessionRef,
    timestamp: new Date().toISOString(),
    runId,
    text,
  };
}

test("coalesces streaming transcript updates without rerendering the idle composer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("chat-performance-streaming-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Streaming performance session");
    const context = await selectedSessionContext(window);
    const runId = `perf-run-${Date.now()}`;

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef: context.sessionRef,
      timestamp: new Date().toISOString(),
      runId,
      snapshot: {
        ref: context.sessionRef,
        workspace: context.workspace,
        title: context.title,
        status: "running",
        updatedAt: new Date().toISOString(),
        preview: "streaming performance",
        runningRunId: runId,
      },
    });

    const composer = window.getByTestId("composer");
    await composer.fill("local draft before stream");
    const surface = window.getByTestId("composer-surface");
    const renderCountBefore = await surface.evaluate((node) =>
      Number((node as HTMLElement).dataset.renderCount ?? "0"),
    );
    const diagnosticsBefore = await getAppDiagnostics(harness);

    await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        emitTestSessionEventNoWait(harness, assistantDeltaEvent(context, runId, `chunk-${index} `)),
      ),
    );

    await expect(window.getByTestId("transcript")).toContainText("chunk-79", { timeout: 15_000 });

    const renderCountAfterStream = await surface.evaluate((node) =>
      Number((node as HTMLElement).dataset.renderCount ?? "0"),
    );
    const diagnosticsAfter = await getAppDiagnostics(harness);
    const selectedTranscriptPublishes =
      diagnosticsAfter.selectedTranscriptPublishCount - diagnosticsBefore.selectedTranscriptPublishCount;

    expect(renderCountAfterStream - renderCountBefore).toBeLessThanOrEqual(6);
    expect(selectedTranscriptPublishes).toBeLessThan(20);

    await composer.press("End");
    await composer.type(" plus typing", { delay: 1 });
    await expect(composer).toHaveValue("local draft before stream plus typing");
  } finally {
    await harness.close();
  }
});

test("keeps virtualization enabled for long assistant messages", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("chat-performance-long-message-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Long message virtualization session");
    await seedTranscriptMessages(harness, window, {
      count: 140,
      textFactory: (index) =>
        index === 139
          ? `long assistant block ${"x".repeat(12_000)}`
          : `short assistant row ${index}`,
    });

    await expect(window.getByTestId("transcript")).toContainText("long assistant block");
    await expect
      .poll(async () =>
        window.evaluate(() => ({
          virtualized: Boolean(document.querySelector(".timeline--virtualized")),
          renderedRows: document.querySelectorAll("[data-timeline-row-id]").length,
          transcriptLength: document.querySelectorAll("[data-timeline-row-id]").length,
        })),
      )
      .toMatchObject({ virtualized: true });
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run the targeted spec and verify it fails for missing diagnostics**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts
```

Expected: FAIL with at least one of these messages:

```text
Module '../helpers/electron-app' has no exported member 'getAppDiagnostics'
Module '../helpers/electron-app' has no exported member 'emitTestSessionEventNoWait'
```

- [ ] **Step 3: Add diagnostics types and helpers to `tests/helpers/electron-app.ts`**

In `tests/helpers/electron-app.ts`, add this interface near `DesktopHarness`:

```ts
export interface AppDiagnosticsSnapshot {
  readonly selectedTranscriptPublishCount: number;
  readonly statePublishCount: number;
  readonly assistantDeltaFlushCount: number;
}
```

Replace the existing `emitTestSessionEvent` helper with this exact pair:

```ts
export async function emitTestSessionEvent(
  harness: DesktopHarness,
  event: SessionDriverEvent,
): Promise<void> {
  await harness.electronApp.evaluate(async (_, payload) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { emitSessionEvent?: (event: SessionDriverEvent) => Promise<void> };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.emitSessionEvent) {
      throw new Error("Test session-event hook is unavailable");
    }
    await hooks.emitSessionEvent(payload);
  }, event);
}

export async function emitTestSessionEventNoWait(
  harness: DesktopHarness,
  event: SessionDriverEvent,
): Promise<void> {
  await harness.electronApp.evaluate((_, payload) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { emitSessionEvent?: (event: SessionDriverEvent) => Promise<void> };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.emitSessionEvent) {
      throw new Error("Test session-event hook is unavailable");
    }
    void hooks.emitSessionEvent(payload);
  }, event);
}

export async function getAppDiagnostics(harness: DesktopHarness): Promise<AppDiagnosticsSnapshot> {
  return harness.electronApp.evaluate(() => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { getDiagnostics?: () => AppDiagnosticsSnapshot };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.getDiagnostics) {
      throw new Error("Test diagnostics hook is unavailable");
    }
    return hooks.getDiagnostics();
  });
}
```

- [ ] **Step 4: Add diagnostics counters to `electron/app-store.ts`**

Inside the `AppStore` class, add this private field near the listener sets:

```ts
private readonly diagnostics = {
  selectedTranscriptPublishCount: 0,
  statePublishCount: 0,
  assistantDeltaFlushCount: 0,
};
```

Add this public method near `emitTestSessionEvent`:

```ts
getDiagnostics(): {
  readonly selectedTranscriptPublishCount: number;
  readonly statePublishCount: number;
  readonly assistantDeltaFlushCount: number;
} {
  return { ...this.diagnostics };
}
```

In `emit()`, increment before notifying listeners:

```ts
emit(): DesktopAppState {
  const snapshot = structuredClone(this.state);
  this.diagnostics.statePublishCount += 1;
  for (const listener of this.listeners) {
    listener(snapshot);
  }
  return snapshot;
}
```

In `publishSelectedTranscript()`, increment before notifying listeners:

```ts
publishSelectedTranscript(): void {
  const sessionRef = this.selectedSessionRef();
  const payload = sessionRef ? this.buildSelectedTranscriptRecord(sessionRef) : null;
  this.diagnostics.selectedTranscriptPublishCount += 1;
  for (const listener of this.selectedTranscriptListeners) {
    listener(payload);
  }
}
```

- [ ] **Step 5: Expose diagnostics through `electron/main.ts` test hooks**

In `electron/main.ts`, update the `__PI_APP_TEST_HOOKS` object to include:

```ts
getDiagnostics: () => store.getDiagnostics(),
```

Keep the existing `emitSessionEvent`, deferred-title hooks, and other hook properties unchanged.

- [ ] **Step 6: Add a render count attribute to `src/composer-surface.tsx`**

Change the import line to include `useRef` only once and `memo`:

```ts
import { memo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
```

Change the exported function declaration from:

```ts
export function ComposerSurface({
```

to:

```ts
export const ComposerSurface = memo(function ComposerSurface({
```

Immediately after props destructuring, add:

```ts
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
```

Add the render count to the root element:

```tsx
<div
  className={`composer__surface ${isDragActive ? "composer__surface--drag-active" : ""}`}
  data-testid={`${textareaTestId}-surface`}
  data-render-count={renderCountRef.current}
  onPaste={onComposerPaste}
  onDragEnter={handleDragEnter}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
  onDragOver={handleDragOver}
>
```

Close the component with `});` instead of `}`.

- [ ] **Step 7: Run the targeted spec and verify the first test still fails for too many publishes/renders**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts
```

Expected: FAIL because `selectedTranscriptPublishes` is too high or `renderCountAfterStream - renderCountBefore` is too high. The virtualization test may also fail until Task 5.

- [ ] **Step 8: Commit diagnostics and regression coverage**

```bash
git add electron/app-store.ts electron/main.ts src/composer-surface.tsx tests/helpers/electron-app.ts tests/core/chat-performance.spec.ts
git commit -m "test: cover chat streaming performance regressions"
```

---

## Task 2: Coalesce assistant deltas before selected transcript publication

**Files:**
- Create: `electron/assistant-delta-batcher.ts`
- Modify: `electron/app-store.ts`
- Test: `tests/core/chat-performance.spec.ts`

- [ ] **Step 1: Create the assistant delta batcher**

Create `electron/assistant-delta-batcher.ts`:

```ts
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";

type AssistantDeltaEvent = Extract<SessionDriverEvent, { type: "assistantDelta" }>;

interface PendingAssistantDelta {
  event: AssistantDeltaEvent;
  text: string;
}

export class AssistantDeltaBatcher {
  private readonly pendingBySession = new Map<string, PendingAssistantDelta>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly flushDelayMs: number,
    private readonly requestFlush: () => void,
  ) {}

  enqueue(event: AssistantDeltaEvent): void {
    const key = sessionKey(event.sessionRef);
    const pending = this.pendingBySession.get(key);
    if (pending) {
      pending.text += event.text;
      pending.event = {
        ...event,
        text: pending.text,
      };
    } else {
      this.pendingBySession.set(key, {
        event,
        text: event.text,
      });
    }
    this.scheduleFlush();
  }

  takeFor(sessionRef: SessionRef): AssistantDeltaEvent[] {
    const key = sessionKey(sessionRef);
    const pending = this.pendingBySession.get(key);
    if (!pending) {
      return [];
    }
    this.pendingBySession.delete(key);
    this.clearTimerIfIdle();
    return [pending.event];
  }

  takeAll(): AssistantDeltaEvent[] {
    if (this.pendingBySession.size === 0) {
      return [];
    }
    const events = Array.from(this.pendingBySession.values(), (pending) => pending.event);
    this.pendingBySession.clear();
    this.clearTimerIfIdle();
    return events;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pendingBySession.clear();
  }

  private scheduleFlush(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.requestFlush();
    }, this.flushDelayMs);
  }

  private clearTimerIfIdle(): void {
    if (this.pendingBySession.size > 0 || !this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
```
- [ ] **Step 2: Refactor `electron/app-store.ts` to split immediate event application**

Add this import:

```ts
import { AssistantDeltaBatcher } from "./assistant-delta-batcher";
```

Inside `AppStore`, add these fields near diagnostics:

```ts
private sessionEventChain: Promise<void> = Promise.resolve();
private readonly assistantDeltaBatcher = new AssistantDeltaBatcher(32, () => {
  void this.flushQueuedAssistantDeltas();
});
```

Add this private helper near `handleSessionEvent`:

```ts
private async flushQueuedAssistantDeltas(): Promise<void> {
  this.sessionEventChain = this.sessionEventChain.then(async () => {
    await this.applyAssistantDeltaEvents(this.assistantDeltaBatcher.takeAll());
  });
  await this.sessionEventChain;
}

private async applyAssistantDeltaEvents(events: readonly Extract<SessionDriverEvent, { type: "assistantDelta" }>[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  this.diagnostics.assistantDeltaFlushCount += 1;
  for (const event of events) {
    await this.applySessionEventImmediately(event);
  }
}
```

Replace `async emitTestSessionEvent(event: SessionDriverEvent): Promise<void>` with:

```ts
async emitTestSessionEvent(event: SessionDriverEvent): Promise<void> {
  await this.initialize();
  await this.handleSessionEvent(event);
}
```

Keep that method behavior unchanged; the batching happens in `handleSessionEvent`.

Mechanically rename the current method:

```ts
private async handleSessionEvent(event: SessionDriverEvent, subscriptionKey = sessionKey(event.sessionRef)): Promise<void>
```

to:

```ts
private async applySessionEventImmediately(event: SessionDriverEvent, subscriptionKey = sessionKey(event.sessionRef)): Promise<void>
```

Do not change that method body during the rename. Then add this new `handleSessionEvent` method directly above `applySessionEventImmediately`:

```ts
private async handleSessionEvent(event: SessionDriverEvent, subscriptionKey = sessionKey(event.sessionRef)): Promise<void> {
  const key = sessionKey(event.sessionRef);
  if (subscriptionKey !== key) {
    this.migrateSessionSubscriptionKey(subscriptionKey, key);
  }

  this.sessionEventChain = this.sessionEventChain.then(async () => {
    if (event.type === "assistantDelta") {
      this.assistantDeltaBatcher.enqueue(event);
      return;
    }

    await this.applyAssistantDeltaEvents(this.assistantDeltaBatcher.takeFor(event.sessionRef));
    await this.applySessionEventImmediately(event, subscriptionKey);
  });
  await this.sessionEventChain;
}
```

After the rename, delete the duplicate migration block from the top of `applySessionEventImmediately` so the first lines are:

```ts
private async applySessionEventImmediately(event: SessionDriverEvent, subscriptionKey = sessionKey(event.sessionRef)): Promise<void> {
  const key = sessionKey(event.sessionRef);
  const knownSession = this.sessionFromState(event.sessionRef);
  const shouldFollowSessionMutation = subscriptionKey !== key && this.currentSelectedSessionKey() === subscriptionKey;
  let refreshedFollowedSession = false;
```

The rest of `applySessionEventImmediately` remains the old event-application logic: known-session refresh, `switch (event.type)`, timeline application, derived session state sync, persistence scheduling, `emit()`, `publishSelectedTranscriptFor()`, and `emitSessionEvent()`.

- [ ] **Step 3: Flush pending assistant deltas on shutdown/close**

In `electron/app-store.ts`, update `async flushPersistence()` so pending assistant deltas are applied before transcript files are written. The start of the method should be:

```ts
async flushPersistence(): Promise<void> {
  await this.initialize();
  await this.flushQueuedAssistantDeltas();
  if (this.persistUiStateTimer) {
    clearTimeout(this.persistUiStateTimer);
    this.persistUiStateTimer = undefined;
  }

  const pendingTranscriptWrites = [...this.transcriptPersistTimers.entries()];
  this.transcriptPersistTimers.clear();
  await Promise.all(
    pendingTranscriptWrites.map(async ([key, timer]) => {
      clearTimeout(timer);
      const transcript = (this.sessionState.transcriptCache.get(key) ?? []).map(cloneTranscriptMessage);
      await this.writePersistedTranscript(key, transcript);
    }),
  );

  await this.persistUiState();
}
```

- [ ] **Step 4: Run the streaming performance spec**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts -g "coalesces streaming"
```

Expected: PASS. The diagnostic delta should show fewer than 20 selected transcript publishes for 80 assistant chunks.

- [ ] **Step 5: Run existing live/tool-call regression spec because assistant event ordering changed**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:live:tool-calls
```

Expected: PASS.

- [ ] **Step 6: Commit assistant delta batching**

```bash
git add electron/assistant-delta-batcher.ts electron/app-store.ts tests/core/chat-performance.spec.ts
git commit -m "perf: coalesce assistant transcript deltas"
```

---

## Task 3: Isolate composer renders from transcript updates

**Files:**
- Modify: `src/composer-panel.tsx`
- Modify: `src/composer-surface.tsx`
- Modify: `src/App.tsx`
- Test: `tests/core/chat-performance.spec.ts`

- [ ] **Step 1: Change `ComposerPanelProps` to pass primitive status**

In `src/composer-panel.tsx`, replace this prop:

```ts
readonly selectedSession: SessionRecord;
```

with:

```ts
readonly sessionStatus: SessionRecord["status"];
```

Change the function export from:

```ts
export function ComposerPanel({
```

to:

```ts
export const ComposerPanel = memo(function ComposerPanel({
```

Add `memo` to the import line:

```ts
import { memo, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
```

Make these exact replacements in `src/composer-panel.tsx`:

```ts
const hasComposerInput = composerDraft.trim().length > 0 || attachments.length > 0;
const primaryActionIsStop = sessionStatus === "running" && !hasComposerInput;
```

```tsx
{sessionStatus === "running"
  ? `${runningLabel} · Enter to queue · Cmd+Enter to steer`
  : "Enter to send · Shift+Enter for newline"}
```

```tsx
disabled={sessionStatus === "running"}
```

No `selectedSession.status` references should remain in `src/composer-panel.tsx`.

Close the component with:

```ts
});
```

- [ ] **Step 2: Update `App.tsx` to pass only `selectedSession.status`**

In the `<ComposerPanel />` call, replace:

```tsx
selectedSession={selectedSession}
```

with:

```tsx
sessionStatus={selectedSession.status}
```

- [ ] **Step 3: Keep composer footer and textarea props stable**

In `src/composer-surface.tsx`, change the `handleDragEnter`, `handleDragLeave`, `handleDragOver`, `handleDrop`, and textarea `onChange` handlers to `useCallback` so `ComposerSurface` can skip parent transcript renders.

Update the import:

```ts
import { memo, useCallback, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
```

Replace the handler declarations with:

```ts
const clearDragState = useCallback(() => {
  dragDepthRef.current = 0;
  setIsDragActive(false);
}, []);

const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
  if (!hasFilesInDataTransfer(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  dragDepthRef.current += 1;
  setIsDragActive(true);
}, []);

const handleDragLeave = useCallback((_event: DragEvent<HTMLDivElement>) => {
  if (!isDragActive) {
    return;
  }
  dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
  if (dragDepthRef.current === 0) {
    setIsDragActive(false);
  }
}, [isDragActive]);

const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
  if (!hasFilesInDataTransfer(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setIsDragActive(true);
}, []);

const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
  clearDragState();
  onComposerDrop(event);
}, [clearDragState, onComposerDrop]);

const handleComposerChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
  setComposerDraft(event.target.value);
}, [setComposerDraft]);
```

Then replace the textarea inline `onChange` with:

```tsx
onChange={handleComposerChange}
```

- [ ] **Step 4: Run the composer performance spec**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts -g "coalesces streaming"
```

Expected: PASS with composer render-count delta during streaming less than or equal to 6; local typing after the assertion may still render the composer once per keystroke.

- [ ] **Step 5: Run composer controls lane**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:core:composer-controls
```

Expected: PASS.

- [ ] **Step 6: Commit composer render isolation**

```bash
git add src/composer-panel.tsx src/composer-surface.tsx src/App.tsx tests/core/chat-performance.spec.ts
git commit -m "perf: isolate composer renders from transcript updates"
```

---

## Task 4: Replace expensive transcript marker stringification

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/core/chat-performance.spec.ts`

- [ ] **Step 1: Replace `buildTranscriptChangeMarker` with a cheap signature**

In `src/App.tsx`, replace the existing function:

```ts
function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"]): string {
  const lastItem = transcript.at(-1);
  return `${sessionKey}:${transcript.length}:${lastItem ? JSON.stringify(lastItem) : ""}`;
}
```

with:

```ts
function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"]): string {
  const lastItem = transcript.at(-1);
  if (!lastItem) {
    return `${sessionKey}:0:empty`;
  }

  switch (lastItem.kind) {
    case "message": {
      const tail = lastItem.text.slice(-48);
      const attachmentCount = lastItem.attachments?.length ?? 0;
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.role,
        lastItem.text.length,
        tail,
        attachmentCount,
      ].join(":");
    }
    case "tool": {
      const inputSize = estimateUnknownSize(lastItem.input);
      const outputSize = estimateUnknownSize(lastItem.output);
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.callId,
        lastItem.status,
        lastItem.label,
        lastItem.detail ?? "",
        inputSize,
        outputSize,
      ].join(":");
    }
    case "activity":
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.label,
        lastItem.detail ?? "",
        lastItem.metadata ?? "",
        lastItem.tone ?? "",
      ].join(":");
    case "summary":
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.presentation,
        lastItem.label.length,
        lastItem.label.slice(-48),
        lastItem.metadata ?? "",
      ].join(":");
  }
}

function estimateUnknownSize(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 1;
}
```

- [ ] **Step 2: Add a marker cost assertion to the performance spec**

In `tests/core/chat-performance.spec.ts`, inside the first test after `await expect(composer).toHaveValue(...)`, add:

```ts
const markerCost = await window.evaluate(() => {
  const pane = document.querySelector<HTMLElement>("[data-testid='timeline-pane']");
  const before = performance.now();
  for (let index = 0; index < 20; index += 1) {
    pane?.dispatchEvent(new Event("scroll"));
  }
  return performance.now() - before;
});
expect(markerCost).toBeLessThan(50);
```

- [ ] **Step 3: Run chat performance spec**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts
```

Expected: The coalescing test passes. The long-message virtualization test may still fail until Task 6.

- [ ] **Step 4: Commit marker optimization**

```bash
git add src/App.tsx tests/core/chat-performance.spec.ts
git commit -m "perf: avoid stringifying transcripts during scroll sync"
```

---

## Task 5: Structurally share unchanged timeline rows

**Files:**
- Create: `src/conversation-timeline-rows.ts`
- Modify: `src/conversation-timeline.tsx`
- Modify: `src/timeline-item.tsx`
- Test: `tests/core/chat-performance.spec.ts`

- [ ] **Step 1: Create stable-row helper**

Create `src/conversation-timeline-rows.ts`:

```ts
import { useRef } from "react";
import type { TranscriptMessage } from "./desktop-state";

interface StableTranscriptState {
  readonly byId: Map<string, TranscriptMessage>;
  readonly result: readonly TranscriptMessage[];
}

export function useStableTranscriptRows(transcript: readonly TranscriptMessage[]): readonly TranscriptMessage[] {
  const stateRef = useRef<StableTranscriptState>({ byId: new Map(), result: [] });
  const previous = stateRef.current;
  const nextById = new Map<string, TranscriptMessage>();
  let changed = transcript.length !== previous.result.length;

  const result = transcript.map((item, index) => {
    const previousItem = previous.byId.get(item.id);
    const nextItem = previousItem && transcriptItemsEqual(previousItem, item) ? previousItem : item;
    nextById.set(item.id, nextItem);
    if (!changed && previous.result[index] !== nextItem) {
      changed = true;
    }
    return nextItem;
  });

  if (!changed) {
    return previous.result;
  }

  stateRef.current = { byId: nextById, result };
  return result;
}

function transcriptItemsEqual(left: TranscriptMessage, right: TranscriptMessage): boolean {
  if (left.kind !== right.kind || left.id !== right.id) {
    return false;
  }

  switch (left.kind) {
    case "message": {
      const message = right as typeof left;
      return (
        left.role === message.role &&
        left.text === message.text &&
        left.createdAt === message.createdAt &&
        attachmentsEqual(left.attachments, message.attachments)
      );
    }
    case "tool": {
      const tool = right as typeof left;
      return (
        left.callId === tool.callId &&
        left.toolName === tool.toolName &&
        left.status === tool.status &&
        left.label === tool.label &&
        left.detail === tool.detail &&
        left.metadata === tool.metadata &&
        shallowJsonEqual(left.input, tool.input) &&
        shallowJsonEqual(left.output, tool.output)
      );
    }
    case "activity": {
      const activity = right as typeof left;
      return (
        left.label === activity.label &&
        left.detail === activity.detail &&
        left.metadata === activity.metadata &&
        left.tone === activity.tone &&
        left.createdAt === activity.createdAt
      );
    }
    case "summary": {
      const summary = right as typeof left;
      return (
        left.label === summary.label &&
        left.presentation === summary.presentation &&
        left.metadata === summary.metadata &&
        left.createdAt === summary.createdAt
      );
    }
  }
}

function attachmentsEqual(
  left: Extract<TranscriptMessage, { kind: "message" }>["attachments"],
  right: Extract<TranscriptMessage, { kind: "message" }>["attachments"],
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other !== undefined && shallowJsonEqual(item, other);
  });
}

function shallowJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Use stable rows in `ConversationTimeline`**

In `src/conversation-timeline.tsx`, add:

```ts
import { useStableTranscriptRows } from "./conversation-timeline-rows";
```

Update the React import to include `memo`:

```ts
import { memo, useCallback, useLayoutEffect, useRef, useState, type MutableRefObject, type RefCallback, type RefObject } from "react";
```

At the top of `ConversationTimeline`, after props destructuring and before `hasUnreliableVirtualizedHeights`, add:

```ts
const stableTranscript = useStableTranscriptRows(transcript);
```

Make these exact replacements inside `ConversationTimeline`:

```ts
const hasUnreliableVirtualizedHeights = stableTranscript.some(
  (item) => item.kind === "message" && (item.text.length > 2000 || Boolean(item.attachments?.length)),
);
```

```ts
const availableToolCallIds = new Set(
  stableTranscript
    .filter((item): item is Extract<TranscriptMessage, { kind: "tool" }> => item.kind === "tool")
    .map((item) => item.callId),
);
```

```ts
const knownIds = new Set(stableTranscript.map((item) => item.id));
```

```ts
const allRowsMeasured = stableTranscript.every((item) => measuredHeightsRef.current.has(item.id));
```

```tsx
<VirtualizedTranscriptList
  transcript={stableTranscript}
  timelinePaneRef={timelinePaneRef}
  onContentHeightChange={onContentHeightChange}
  measuredHeightsRef={measuredHeightsRef}
  measurementVersion={measurementVersion}
  expandedToolCallIds={expandedToolCallIds}
  onHeightChange={updateMeasuredHeight}
  onToggleToolCall={toggleToolCall}
  onViewFileInDiff={onViewFileInDiff}
/>
```

```tsx
{stableTranscript.map((item) => (
  <MeasuredTimelineItem
    item={item}
    key={item.id}
    onHeightChange={updateMeasuredHeight}
    expandedToolCallIds={expandedToolCallIds}
    onToggleToolCall={toggleToolCall}
    onViewFileInDiff={onViewFileInDiff}
  />
))}
```

Use `stableTranscript` instead of `transcript` in the dependency arrays for these three effects: available tool IDs cleanup, measured height cleanup, and disable-virtualization readiness.

- [ ] **Step 3: Add data attributes for row diagnostics**

In `MeasuredTimelineItem`, add `data-timeline-row-id={item.id}` to the wrapping `div`:

```tsx
<div
  className={className}
  data-timeline-row-id={item.id}
  ref={rowRef}
  style={top == null ? undefined : { transform: `translateY(${top}px)` }}
>
```

Wrap `MeasuredTimelineItem` in `memo` with a comparator that only treats a changed `expandedToolCallIds` set as relevant for the row's own tool ID:

```tsx
const MeasuredTimelineItem = memo(function MeasuredTimelineItem({
  item,
  className,
  top,
  onHeightChange,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
}: {
  readonly item: TranscriptMessage;
  readonly className?: string;
  readonly top?: number;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      onHeightChange(item.id, element.getBoundingClientRect().height);
    };

    measure();
    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [item.id, onHeightChange]);

  return (
    <div
      className={className}
      data-timeline-row-id={item.id}
      ref={rowRef}
      style={top == null ? undefined : { transform: `translateY(${top}px)` }}
    >
      <TimelineItem
        item={item}
        expandedToolCallIds={expandedToolCallIds}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
      />
    </div>
  );
}, areMeasuredTimelineItemPropsEqual);

function areMeasuredTimelineItemPropsEqual(
  previous: Readonly<{
    item: TranscriptMessage;
    className?: string;
    top?: number;
    onHeightChange: (id: string, height: number) => void;
    expandedToolCallIds: ReadonlySet<string>;
    onToggleToolCall: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
  next: Readonly<{
    item: TranscriptMessage;
    className?: string;
    top?: number;
    onHeightChange: (id: string, height: number) => void;
    expandedToolCallIds: ReadonlySet<string>;
    onToggleToolCall: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
): boolean {
  if (
    previous.item !== next.item ||
    previous.className !== next.className ||
    previous.top !== next.top ||
    previous.onHeightChange !== next.onHeightChange ||
    previous.onToggleToolCall !== next.onToggleToolCall ||
    previous.onViewFileInDiff !== next.onViewFileInDiff
  ) {
    return false;
  }

  if (previous.item.kind !== "tool") {
    return true;
  }

  return (
    previous.expandedToolCallIds.has(previous.item.callId) ===
    next.expandedToolCallIds.has(previous.item.callId)
  );
}
```

- [ ] **Step 4: Memoize `TimelineItem`**

In `src/timeline-item.tsx`, add `memo`:

```ts
import { memo } from "react";
```

Change:

```ts
export function TimelineItem({
```

to:

```ts
export const TimelineItem = memo(function TimelineItem({
```

Close the component with this comparator so a new `expandedToolCallIds` set does not rerender unrelated rows:

```ts
}, areTimelineItemPropsEqual);

function areTimelineItemPropsEqual(
  previous: Readonly<{
    item: TranscriptMessage;
    expandedToolCallIds?: ReadonlySet<string>;
    onToggleToolCall?: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
  next: Readonly<{
    item: TranscriptMessage;
    expandedToolCallIds?: ReadonlySet<string>;
    onToggleToolCall?: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
): boolean {
  if (
    previous.item !== next.item ||
    previous.onToggleToolCall !== next.onToggleToolCall ||
    previous.onViewFileInDiff !== next.onViewFileInDiff
  ) {
    return false;
  }

  if (previous.item.kind !== "tool") {
    return true;
  }

  return (
    (previous.expandedToolCallIds?.has(previous.item.callId) ?? false) ===
    (next.expandedToolCallIds?.has(previous.item.callId) ?? false)
  );
}
```

- [ ] **Step 5: Run timeline pinning spec**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-pinning.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit stable timeline rows**

```bash
git add src/conversation-timeline-rows.ts src/conversation-timeline.tsx src/timeline-item.tsx tests/core/chat-performance.spec.ts
git commit -m "perf: preserve stable timeline row identities"
```

---

## Task 6: Keep virtualization active for long assistant text

**Files:**
- Modify: `src/conversation-timeline.tsx`
- Test: `tests/core/chat-performance.spec.ts`
- Test: `tests/core/timeline-pinning.spec.ts`

- [ ] **Step 1: Narrow the virtualization-disable heuristic**

In `src/conversation-timeline.tsx`, replace the long-text heuristic left by Task 5:

```ts
const hasUnreliableVirtualizedHeights = stableTranscript.some(
  (item) => item.kind === "message" && (item.text.length > 2000 || Boolean(item.attachments?.length)),
);
```

with:

```ts
const hasUnreliableVirtualizedHeights = stableTranscript.some(
  (item) => item.kind === "message" && Boolean(item.attachments?.length),
);
```

Keep attachments on the exact DOM path for now because images can resize after load. Long text should stay virtualized because `ResizeObserver` already corrects measured heights.

- [ ] **Step 2: Run long-message virtualization regression**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts -g "keeps virtualization enabled"
```

Expected: PASS with `.timeline--virtualized` present.

- [ ] **Step 3: Run existing timeline specs**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-layout.spec.ts apps/desktop/tests/core/timeline-pinning.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit long-text virtualization**

```bash
git add src/conversation-timeline.tsx tests/core/chat-performance.spec.ts
git commit -m "perf: keep long assistant messages virtualized"
```

---

## Task 7: Memoize markdown rendering for unchanged text

**Files:**
- Modify: `src/message-markdown.tsx`
- Modify: `src/styles/main.css`
- Test: `tests/core/timeline-layout.spec.ts`

- [ ] **Step 1: Memoize the markdown component**

In `src/message-markdown.tsx`, update the import:

```ts
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
```

Change the export from:

```ts
export function MessageMarkdown({ text }: { readonly text: string }) {
```

to:

```ts
export const MessageMarkdown = memo(function MessageMarkdown({ text }: { readonly text: string }) {
```

Close with:

```ts
});
```

- [ ] **Step 2: Add code block copy affordance without adding new syntax-highlighting work**

Still in `src/message-markdown.tsx`, replace `MARKDOWN_COMPONENTS` with:

```tsx
const MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const language = className?.replace(/^language-/, "");
    const code = String(children).replace(/\n$/, "");
    if (!className) {
      return <code>{code}</code>;
    }
    return (
      <pre data-language={language}>
        <button
          aria-label="Copy code block"
          className="message__code-copy"
          type="button"
          onClick={() => void navigator.clipboard.writeText(code)}
        >
          Copy
        </button>
        <code className={className}>{code}</code>
      </pre>
    );
  },
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
} as const;
```

This borrows t3code's code-block UX direction without introducing Shiki or worker complexity in this performance plan.

- [ ] **Step 3: Style the code-copy control**

In `src/styles/main.css`, add this block after the existing `.message__content pre { ... }` rule:

```css
.message__content pre {
  position: relative;
}

.message__code-copy {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 1px solid rgba(116, 129, 150, 0.28);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  color: #526071;
  font: 600 11px Inter, system-ui, sans-serif;
  padding: 3px 7px;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
}

.message__content pre:hover .message__code-copy,
.message__code-copy:focus-visible {
  opacity: 1;
}

.message__code-copy:hover {
  background: #fff;
  color: #1f2937;
}

:root.dark .message__code-copy {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(17, 24, 39, 0.82);
  color: rgba(237, 241, 247, 0.72);
}

:root.dark .message__code-copy:hover {
  background: rgba(17, 24, 39, 0.96);
  color: #f7f9fc;
}
```

- [ ] **Step 4: Run markdown layout regression**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/timeline-layout.spec.ts
```

Expected: PASS. Long code blocks still do not widen the chat surface.

- [ ] **Step 5: Commit markdown memoization**

```bash
git add src/message-markdown.tsx src/styles/main.css tests/core/timeline-layout.spec.ts
git commit -m "perf: memoize markdown timeline rendering"
```

---

## Task 8: Final verification and simplify pass

**Files:**
- Review only unless earlier tasks reveal small cleanup opportunities.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run targeted performance and timeline specs**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/chat-performance.spec.ts apps/desktop/tests/core/timeline-layout.spec.ts apps/desktop/tests/core/timeline-pinning.spec.ts apps/desktop/tests/core/composer-controls.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Rerun the owning core lane before closing**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected: PASS.

- [ ] **Step 4: Run a manual Electron smoke for typing during streaming**

Run the app:

```bash
pnpm --filter @pi-gui/desktop dev
```

Manual check on the real Electron surface:

1. Open a workspace.
2. Start or select a thread.
3. Trigger a run that streams a long response.
4. While response text streams, type a multi-line draft in the composer.
5. Confirm typed characters do not visibly lag, skip, or reorder.
6. Confirm the timeline stays pinned to bottom only when already at bottom.
7. Scroll upward during streaming and confirm “New activity below” appears instead of yanking scroll.

Expected: Composer typing feels responsive and timeline behavior matches existing product behavior.

- [ ] **Step 5: Simplify pass**

Review the changed code and remove unnecessary abstraction:

- `AssistantDeltaBatcher` should only know about batching deltas, not app state.
- `conversation-timeline-rows.ts` should only know row equality and stable identity.
- Test diagnostics should stay behind `PI_APP_TEST_MODE` hooks only.
- No t3code dependency should be added in this plan.

Run:

```bash
git diff --stat
```

Expected: Changes are limited to the files listed in this plan.

- [ ] **Step 6: Commit final cleanup**

If cleanup changed files:

```bash
git add electron src tests
git commit -m "chore: simplify chat performance changes"
```

If no cleanup changed files, do not create an empty commit.

---

## Deferred Follow-Up Plans

These were intentionally not included because they are independent product features:

1. Terminal selection → composer context chips.
2. Command palette MVP.
3. Plan/proposed-plan sidebar and cards.
4. Git quick-action button and source-control provider discovery.
5. Keybindings settings.
6. Context window meter, if pi runtime exposes context usage.

## Self-Review

- Spec coverage: The plan covers chatbox typing lag, streaming response jank, t3code-inspired batching, memoized rows/components, long-message virtualization, and verification on Electron core lanes.
- Placeholder scan: No TODO/TBD placeholders remain. Deferred features are explicitly listed as separate future plans, not incomplete steps.
- Type consistency: The plan consistently uses `SessionDriverEvent`, `SessionRef`, `TranscriptMessage`, `SessionRecord["status"]`, and existing Playwright helpers.
