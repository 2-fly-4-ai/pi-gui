# Live Tool Output and Thinking UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop runs visibly alive while commands and thinking are in progress, with real live stdout/stderr when available and a real brain icon for the thinking toggle.

**Architecture:** The session driver will override Pi's built-in `bash` tool with a PTY-backed `bash` definition so TTY-aware tools like `pnpm`/`wrangler` flush output during execution instead of waiting for completion. The desktop timeline will treat running tools and thinking as live UI surfaces with elapsed timers, explicit no-output-yet states, and stable user-controlled expansion. The renderer remains presentation-only; command execution stays in the driver/main side.

**Tech Stack:** Electron, React 19, Playwright, TypeScript, `@earendil-works/pi-coding-agent`, `node-pty`, `lucide-react`.

---

## File Structure

- Modify: `apps/desktop/package.json`
  - Add `lucide-react` as the real icon source for the composer thinking toggle.
- Modify: root `pnpm-lock.yaml`
  - Updated by `pnpm --filter @pi-gui/desktop add lucide-react`.
- Modify: `apps/desktop/src/thinking-trace-toggle.tsx`
  - Render Lucide's `Brain` icon instead of a hand-drawn local brain or ninja star.
- Modify: `apps/desktop/src/icons.tsx`
  - Remove the handmade `BrainIcon` export added previously.
- Create: `packages/pi-sdk-driver/src/pty-bash-tool.ts`
  - Provides a PTY-backed `bash` tool definition by wrapping Pi's `createBashToolDefinition` with custom `BashOperations`.
- Modify: `packages/pi-sdk-driver/src/session-supervisor.ts`
  - Register the PTY-backed `bash` tool as a `customTools` override when sessions are created.
  - Keep existing `tool_execution_update` mapping and add optional trace logging for tool/thinking event diagnosis.
- Modify: `packages/session-driver/src/types.ts`
  - Add optional `text` to `ToolFinishedEvent` only if final tool text extraction is needed by consumers. Prefer not to add this unless TypeScript forces it; timeline can extract final output from `output`.
- Modify: `apps/desktop/src/timeline-types.ts`
  - Add `updatedAt?: string` and `outputText?: string` to `TimelineToolCall`.
- Modify: `apps/desktop/electron/app-store-utils.ts`
  - Allow `makeToolItem` to carry `updatedAt` and `outputText`.
- Modify: `apps/desktop/electron/app-store-timeline.ts`
  - Store live tool output in `outputText` instead of only `detail`.
  - Preserve `createdAt` as start time and update `updatedAt` whenever a tool update/finish arrives.
- Modify: `apps/desktop/src/conversation-timeline-rows.ts`
  - Include `updatedAt` and `outputText` in stable-row equality so live updates re-render.
- Modify: `apps/desktop/src/conversation-timeline.tsx`
  - Auto-expand only newly running command tools, while preserving user collapse/expand control.
- Modify: `apps/desktop/src/timeline-item.tsx`
  - Add elapsed timers for running tools and thinking.
  - Show command output/no-output state as an explicit live surface.
  - Keep raw JSON behind `<details>` only.
- Modify: `apps/desktop/src/styles/main.css`
  - Style Lucide brain icon, live tool status, elapsed pills, PTY output panel, and thinking elapsed text.
- Modify: `apps/desktop/tests/core/timeline-thinking.spec.ts`
  - Extend coverage for real brain icon, thinking-start placeholder, streaming thinking deltas, and running command live output.
- Create: `apps/desktop/tests/live/live-command-output.spec.ts`
  - Real Electron/live-ish verification that a command emitting delayed lines displays output before completion. This test should run in background mode and use a local session only if the test harness can run a real driver without external model calls; otherwise keep as a manual verification script documented in the task.

---

### Task 1: Replace handmade brain with a real icon

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src/thinking-trace-toggle.tsx`
- Modify: `apps/desktop/src/icons.tsx`
- Modify: `apps/desktop/tests/core/timeline-thinking.spec.ts`

- [ ] **Step 1: Add Lucide React**

Run:

```bash
pnpm --filter @pi-gui/desktop add lucide-react
```

Expected:

```text
apps/desktop/package.json updated with "lucide-react"
pnpm-lock.yaml updated
```

- [ ] **Step 2: Replace the toggle icon implementation**

Edit `apps/desktop/src/thinking-trace-toggle.tsx` to exactly this shape:

```tsx
import { Brain } from "lucide-react";

interface ThinkingTraceToggleProps {
  readonly showThinking: boolean;
  readonly active?: boolean;
  readonly onToggle: () => void;
}

export function ThinkingTraceToggle({ showThinking, active = false, onToggle }: ThinkingTraceToggleProps) {
  return (
    <button
      aria-label={showThinking ? "Hide thinking" : "Show thinking"}
      aria-pressed={showThinking}
      className={`icon-button thinking-trace-toggle${showThinking ? " icon-button--active thinking-trace-toggle--active" : ""}${active ? " thinking-trace-toggle--active-thinking" : ""}`}
      data-testid="thinking-trace-toggle"
      title={showThinking ? "Hide thinking" : "Show thinking"}
      type="button"
      onClick={onToggle}
    >
      <Brain aria-hidden="true" strokeWidth={1.8} />
    </button>
  );
}
```

- [ ] **Step 3: Remove the handmade icon**

Delete the `BrainIcon` export from `apps/desktop/src/icons.tsx`. Remove only this block:

```tsx
export function BrainIcon() {
  return (
    <Icon>
      <path
        d="M7.3 15.6c-1.85 0-3.25-1.28-3.25-3.04 0-.7.22-1.34.62-1.86a3.1 3.1 0 0 1-.2-1.1c0-1.42.95-2.62 2.25-3.01.32-1.47 1.56-2.54 3.05-2.54.88 0 1.66.37 2.22.97.38-.16.78-.24 1.2-.24 1.72 0 3.11 1.45 3.11 3.24 0 .5-.11.98-.31 1.4.54.55.86 1.31.86 2.14 0 1.67-1.3 3.02-2.98 3.02-.48 0-.94-.11-1.34-.31-.55.82-1.44 1.34-2.45 1.34-.78 0-1.5-.31-2.04-.82-.22.05-.47.08-.74.08Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path
        d="M8 7.05c.9.2 1.54.9 1.54 1.75M12.3 7.1c-.68.24-1.14.83-1.14 1.55M7.6 11.65c.72-.16 1.38.06 1.82.6M12.65 11.55c-.66-.11-1.28.09-1.75.58"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.15"
      />
    </Icon>
  );
}
```

- [ ] **Step 4: Strengthen the icon test**

In `apps/desktop/tests/core/timeline-thinking.spec.ts`, keep the existing test assertion that the toggle has an SVG and no IMG, and add this assertion after `await expect(toggle.locator("svg")).toBeVisible();`:

```ts
await expect(toggle.locator("svg.lucide-brain")).toBeVisible();
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
PI_APP_TEST_MODE=background pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/timeline-thinking.spec.ts
```

Expected:

```text
typecheck exits 0
timeline-thinking.spec.ts passes
```

Commit:

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/thinking-trace-toggle.tsx apps/desktop/src/icons.tsx apps/desktop/tests/core/timeline-thinking.spec.ts
git commit -m "fix(desktop): use real brain icon for thinking toggle"
```

---

### Task 2: Add PTY-backed bash so TTY-aware commands stream live

**Files:**
- Create: `packages/pi-sdk-driver/src/pty-bash-tool.ts`
- Modify: `packages/pi-sdk-driver/src/session-supervisor.ts`

- [ ] **Step 1: Create the PTY bash override**

Create `packages/pi-sdk-driver/src/pty-bash-tool.ts`:

```ts
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { spawn as spawnPty, type IPty } from "node-pty";
import { createBashToolDefinition, type BashOperations } from "@earendil-works/pi-coding-agent";

interface PtyBashOptions {
  readonly shellPath?: string;
  readonly cols?: number;
  readonly rows?: number;
}

export function createPtyBashToolDefinition(cwd: string, options: PtyBashOptions = {}) {
  return createBashToolDefinition(cwd, {
    operations: createPtyBashOperations(options),
    shellPath: options.shellPath,
  });
}

export function createPtyBashOperations(options: PtyBashOptions = {}): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout, env }) {
      return new Promise((resolve, reject) => {
        if (!existsSync(cwd)) {
          reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
          return;
        }

        const shell = options.shellPath ?? process.env.SHELL ?? (platform() === "win32" ? "powershell.exe" : "/bin/bash");
        const args = shell.endsWith("powershell.exe") ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-lc", command];
        let pty: IPty | undefined;
        let settled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        const finish = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          signal?.removeEventListener("abort", abort);
          callback();
        };

        const abort = () => {
          try {
            pty?.kill();
          } catch {
            // node-pty kill can throw if process already exited; ignore because exit handles settlement.
          }
        };

        try {
          pty = spawnPty(shell, args, {
            name: "xterm-256color",
            cols: options.cols ?? 120,
            rows: options.rows ?? 40,
            cwd,
            env: env ?? process.env,
          });
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
          return;
        }

        pty.onData((chunk) => {
          onData(Buffer.from(chunk));
        });

        pty.onExit(({ exitCode }) => {
          finish(() => {
            if (signal?.aborted) {
              reject(new Error("aborted"));
              return;
            }
            if (timedOut) {
              reject(new Error(`timeout:${timeout}`));
              return;
            }
            resolve({ exitCode });
          });
        });

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            abort();
          }, timeout * 1000);
        }

        if (signal?.aborted) {
          abort();
        } else {
          signal?.addEventListener("abort", abort, { once: true });
        }
      });
    },
  };
}
```

- [ ] **Step 2: Register the override for new sessions**

In `packages/pi-sdk-driver/src/session-supervisor.ts`, add this import near the other local imports:

```ts
import { createPtyBashToolDefinition } from "./pty-bash-tool.js";
```

Then update the `createOptions` object in `createSession(...)` so it includes the PTY bash custom tool:

```ts
const createOptions: CreateAgentSessionOptions = {
  cwd: workspace.path,
  sessionManager: SessionManager.create(workspace.path),
  customTools: [createPtyBashToolDefinition(workspace.path)],
  ...(this.modelRegistry ? { modelRegistry: this.modelRegistry } : {}),
};
```

This intentionally uses a custom tool named `bash`; Pi's `AgentSession` registry lets custom tools override built-ins by name.

- [ ] **Step 3: Verify TypeScript**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected:

```text
tsc exits 0 for renderer and Electron configs
```

- [ ] **Step 4: Manual runtime check on real Electron surface**

Run the desktop app, create a new thread, and ask it to run:

```bash
node -e "let i=0; const t=setInterval(()=>{ i++; console.log('live-line-' + i); if (i === 5) clearInterval(t); }, 1000)"
```

Expected on real Electron surface:

```text
live-line-1 appears before live-line-5
The command card updates while the command is still running
The final result does not wait to display all lines at once
```

- [ ] **Step 5: Commit**

```bash
git add packages/pi-sdk-driver/src/pty-bash-tool.ts packages/pi-sdk-driver/src/session-supervisor.ts
git commit -m "feat(driver): stream bash through a pty"
```

---

### Task 3: Preserve live tool output as first-class timeline state

**Files:**
- Modify: `apps/desktop/src/timeline-types.ts`
- Modify: `apps/desktop/electron/app-store-utils.ts`
- Modify: `apps/desktop/electron/app-store-timeline.ts`
- Modify: `apps/desktop/src/conversation-timeline-rows.ts`

- [ ] **Step 1: Extend the tool timeline type**

In `apps/desktop/src/timeline-types.ts`, change `TimelineToolCall` to include `updatedAt` and `outputText`:

```ts
export interface TimelineToolCall {
  readonly kind: "tool";
  readonly id: string;
  readonly callId: string;
  readonly toolName: string;
  readonly status: TimelineToolStatus;
  readonly label: string;
  readonly detail?: string;
  readonly metadata?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly outputText?: string;
}
```

- [ ] **Step 2: Allow tool items to carry live output**

In `apps/desktop/electron/app-store-utils.ts`, update `makeToolItem` options type:

```ts
export function makeToolItem(
  callId: string,
  toolName: string,
  status: "running" | "success" | "error",
  label: string,
  options: Pick<Extract<TranscriptMessage, { kind: "tool" }>, "detail" | "metadata" | "input" | "output" | "updatedAt" | "outputText"> = {},
): TranscriptMessage {
  return {
    kind: "tool",
    id: callId,
    callId,
    toolName,
    status,
    label,
    createdAt: new Date().toISOString(),
    ...options,
  };
}
```

- [ ] **Step 3: Update tool row upsert to preserve live text**

In `apps/desktop/electron/app-store-timeline.ts`, replace `upsertToolRow(...)` with this version:

```ts
function upsertToolRow(
  transcript: TranscriptMessage[],
  callId: string,
  toolName?: string,
  status?: "running" | "success" | "error",
  label?: string,
  detail?: string,
  input?: unknown,
  output?: unknown,
  outputText?: string,
  updatedAt = new Date().toISOString(),
) {
  const index = transcript.findIndex((item) => item.kind === "tool" && item.callId === callId);
  const existing = index >= 0 ? transcript[index] : undefined;
  const existingTool = existing?.kind === "tool" ? existing : undefined;
  const next = makeToolItem(
    callId,
    toolName ?? (existingTool?.toolName ?? "tool"),
    status ?? (existingTool?.status ?? "running"),
    label ?? (existingTool?.label ?? "Working"),
    {
      detail: detail ?? existingTool?.detail,
      metadata: existingTool?.metadata,
      input: input ?? existingTool?.input,
      output: output ?? existingTool?.output,
      outputText: outputText ?? existingTool?.outputText,
      updatedAt,
    },
  );

  if (index >= 0) {
    transcript[index] = {
      ...next,
      createdAt: existing?.createdAt ?? next.createdAt,
    };
    return;
  }

  transcript.push(next);
}
```

- [ ] **Step 4: Pass live output through updates and final output**

In `apps/desktop/electron/app-store-timeline.ts`, replace the `toolUpdated` case:

```ts
case "toolUpdated": {
  const text = event.text ?? progressLabel(event.progress);
  upsertToolRow(transcript, event.callId, undefined, "running", undefined, text, undefined, undefined, text, event.timestamp);
  break;
}
```

Replace the `toolFinished` case with:

```ts
case "toolFinished": {
  const text = detailFromOutput(event.output);
  upsertToolRow(
    transcript,
    event.callId,
    undefined,
    event.success ? "success" : "error",
    undefined,
    text,
    undefined,
    event.output,
    text,
    event.timestamp,
  );
  break;
}
```

- [ ] **Step 5: Make stable row equality aware of live output**

In `apps/desktop/src/conversation-timeline-rows.ts`, update the `case "tool"` equality block:

```ts
case "tool": {
  const tool = right as typeof left;
  return (
    left.callId === tool.callId &&
    left.toolName === tool.toolName &&
    left.status === tool.status &&
    left.label === tool.label &&
    left.detail === tool.detail &&
    left.metadata === tool.metadata &&
    left.updatedAt === tool.updatedAt &&
    left.outputText === tool.outputText &&
    shallowJsonEqual(left.input, tool.input) &&
    shallowJsonEqual(left.output, tool.output)
  );
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected:

```text
typecheck exits 0
```

Commit:

```bash
git add apps/desktop/src/timeline-types.ts apps/desktop/electron/app-store-utils.ts apps/desktop/electron/app-store-timeline.ts apps/desktop/src/conversation-timeline-rows.ts
git commit -m "feat(desktop): preserve live tool output state"
```

---

### Task 4: Render running commands as trustworthy live surfaces

**Files:**
- Modify: `apps/desktop/src/timeline-item.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Modify: `apps/desktop/tests/core/timeline-thinking.spec.ts`

- [ ] **Step 1: Add elapsed-time helpers to timeline items**

In `apps/desktop/src/timeline-item.tsx`, update the React import to include hooks:

```tsx
import { memo, useEffect, useState } from "react";
```

Add these helpers above `TimelineToolCallItem`:

```tsx
function useElapsedLabel(startedAt: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  return formatElapsed(startedAt, now);
}

function formatElapsed(startedAt: string, now = Date.now()): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) {
    return "0s";
  }
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}
```

- [ ] **Step 2: Use `outputText` and elapsed status in `TimelineToolCallItem`**

Inside `TimelineToolCallItem`, replace the output derivation lines with:

```tsx
const command = extractCommand(item.input);
const outputText = item.outputText ?? extractToolText(item.output) ?? item.detail;
const hasVisibleOutput = Boolean(outputText?.trim());
const hasDetails = item.input !== undefined || item.output !== undefined;
const running = item.status === "running";
const elapsed = useElapsedLabel(item.createdAt, running);
```

Replace the metadata span in the header with:

```tsx
<span className="timeline-tool__meta-inline">
  {running ? `${item.toolName} · running for ${elapsed}` : `${item.toolName} · ${statusLabel(item.status)}`}
</span>
```

Replace the waiting message with:

```tsx
<div className="timeline-tool__waiting">
  <strong>Still running.</strong>
  <span>No stdout/stderr emitted yet.</span>
</div>
```

- [ ] **Step 3: Keep raw JSON out of the main command view**

In the non-diff body branch, keep command input visible as shell text, output visible as text, and raw details behind `<details>`. The body should look like this:

```tsx
<div className="timeline-tool__body-actions">
  <span className="timeline-tool__body-title">
    {command ? `Command output · ${running ? `running for ${elapsed}` : statusLabel(item.status)}` : item.status === "running" ? "Live output" : "Tool output"}
  </span>
  <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
    <CopyIcon />
  </button>
</div>
{command ? <pre className="timeline-tool__command">$ {command}</pre> : null}
{hasVisibleOutput ? (
  <pre className="timeline-tool__pre">{outputText}</pre>
) : item.status === "running" ? (
  <div className="timeline-tool__waiting">
    <strong>Still running.</strong>
    <span>No stdout/stderr emitted yet.</span>
  </div>
) : (
  <pre className="timeline-tool__pre">{formatToolContent(undefined, item.output)}</pre>
)}
{item.input !== undefined && !command ? (
  <details className="timeline-tool__details">
    <summary>Details</summary>
    <pre>{formatToolContent(item.input, undefined)}</pre>
  </details>
) : null}
```

- [ ] **Step 4: Style the live waiting state**

In `apps/desktop/src/styles/main.css`, replace `.timeline-tool__waiting` with:

```css
.timeline-tool__waiting {
  display: grid;
  gap: 3px;
  padding: 12px;
  color: var(--muted-soft);
  font-size: 13px;
}

.timeline-tool__waiting strong {
  color: var(--muted-strong);
  font-style: normal;
  font-weight: 650;
}

.timeline-tool__waiting span {
  font-style: italic;
}
```

- [ ] **Step 5: Update the running command test**

In `apps/desktop/tests/core/timeline-thinking.spec.ts`, update the running command test to expect the stronger no-output state:

```ts
await expect(transcript).toContainText("Still running.");
await expect(transcript).toContainText("No stdout/stderr emitted yet.");
await expect(transcript).toContainText(/bash · running for \d+s/);
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
PI_APP_TEST_MODE=background pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/timeline-thinking.spec.ts
```

Expected:

```text
typecheck exits 0
timeline-thinking.spec.ts passes
```

Commit:

```bash
git add apps/desktop/src/timeline-item.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/timeline-thinking.spec.ts
git commit -m "feat(desktop): show live running command status"
```

---

### Task 5: Auto-expand only newly running command tools, without fighting the user

**Files:**
- Modify: `apps/desktop/src/conversation-timeline.tsx`
- Modify: `apps/desktop/tests/core/timeline-thinking.spec.ts`

- [ ] **Step 1: Add a command-tool detector**

In `apps/desktop/src/conversation-timeline.tsx`, add this helper near the top-level constants:

```ts
function isCommandTool(item: TranscriptMessage): item is Extract<TranscriptMessage, { kind: "tool" }> {
  if (item.kind !== "tool") {
    return false;
  }
  if (item.toolName.toLowerCase() !== "bash") {
    return false;
  }
  return typeof item.input === "object" && item.input !== null && typeof (item.input as Record<string, unknown>).command === "string";
}
```

- [ ] **Step 2: Track user-collapsed live tools**

Inside `ConversationTimeline`, after `expandedToolCallIds` state, add:

```tsx
const userCollapsedRunningToolIdsRef = useRef(new Set<string>());
```

- [ ] **Step 3: Update toggle behavior so manual collapse wins**

Replace `toggleToolCall` with:

```tsx
const toggleToolCall = useCallback((callId: string) => {
  setExpandedToolCallIds((current) => {
    const next = new Set(current);
    if (next.has(callId)) {
      next.delete(callId);
      userCollapsedRunningToolIdsRef.current.add(callId);
    } else {
      next.add(callId);
      userCollapsedRunningToolIdsRef.current.delete(callId);
    }
    return next;
  });
}, []);
```

- [ ] **Step 4: Auto-expand only active command tools**

Add this `useLayoutEffect` after the stale-tool cleanup effect:

```tsx
useLayoutEffect(() => {
  const runningCommandToolIds = stableTranscript
    .filter((item) => isCommandTool(item) && item.status === "running")
    .map((item) => item.callId);

  if (runningCommandToolIds.length === 0) {
    return;
  }

  setExpandedToolCallIds((current) => {
    let changed = false;
    const next = new Set(current);
    for (const callId of runningCommandToolIds) {
      if (userCollapsedRunningToolIdsRef.current.has(callId) || next.has(callId)) {
        continue;
      }
      next.add(callId);
      changed = true;
    }
    return changed ? next : current;
  });
}, [stableTranscript]);
```

- [ ] **Step 5: Prune collapsed IDs for removed tool rows**

Inside the existing available-tool cleanup effect, after computing `availableToolCallIds`, add:

```tsx
for (const callId of [...userCollapsedRunningToolIdsRef.current]) {
  if (!availableToolCallIds.has(callId)) {
    userCollapsedRunningToolIdsRef.current.delete(callId);
  }
}
```

- [ ] **Step 6: Add test coverage**

In `apps/desktop/tests/core/timeline-thinking.spec.ts`, after the `toolStarted` event in the running command test, remove the manual click line:

```ts
await transcript.getByRole("button", { name: /Running printf/ }).click();
```

The following assertions should still pass because the row auto-expanded:

```ts
await expect(transcript).toContainText("Still running.");
await expect(transcript).toContainText(`$ ${command}`);
```

Then add a manual-collapse check:

```ts
await transcript.getByRole("button", { name: /Running printf/ }).click();
await expect(transcript).not.toContainText(`$ ${command}`);
await emitTestSessionEvent(harness, {
  type: "toolUpdated",
  sessionRef,
  timestamp: new Date().toISOString(),
  callId: "bash-live-output-1",
  text: "first line\nsecond line",
} satisfies Extract<SessionDriverEvent, { type: "toolUpdated" }>);
await expect(transcript).not.toContainText("first line");
await transcript.getByRole("button", { name: /Running printf/ }).click();
await expect(transcript).toContainText("first line");
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
PI_APP_TEST_MODE=background pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/timeline-thinking.spec.ts
```

Expected:

```text
typecheck exits 0
timeline-thinking.spec.ts passes
```

Commit:

```bash
git add apps/desktop/src/conversation-timeline.tsx apps/desktop/tests/core/timeline-thinking.spec.ts
git commit -m "feat(desktop): auto-open active command output"
```

---

### Task 6: Make thinking visibly live even before text arrives

**Files:**
- Modify: `apps/desktop/src/timeline-item.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Modify: `apps/desktop/tests/core/timeline-thinking.spec.ts`

- [ ] **Step 1: Add elapsed time to thinking rows**

In `apps/desktop/src/timeline-item.tsx`, replace `TimelineThinkingItem` with:

```tsx
function TimelineThinkingItem({ item }: { readonly item: Extract<TranscriptMessage, { kind: "thinking" }> }) {
  const running = item.status === "running";
  const body = item.text.trim() || "Thinking…";
  const elapsed = useElapsedLabel(item.createdAt, running);
  return (
    <article className={`timeline-item timeline-item--thinking${running ? " timeline-item--thinking-running" : ""}`}>
      <div className="timeline-thinking__header">
        <img className="timeline-thinking__icon" src={ninjaStarUrl} alt="" aria-hidden="true" />
        <span>{running ? "Thinking…" : "Thinking"}</span>
        {running ? <span className="timeline-thinking__elapsed">{elapsed}</span> : null}
      </div>
      <div className="timeline-thinking__body">
        <MessageMarkdown text={body} />
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Style the thinking elapsed pill**

In `apps/desktop/src/styles/main.css`, add near the `.timeline-thinking__header` styles:

```css
.timeline-thinking__elapsed {
  color: var(--muted-soft);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Add test for thinking-start placeholder before final text**

In `apps/desktop/tests/core/timeline-thinking.spec.ts`, add this test:

```ts
test("shows thinking immediately before thinking text arrives", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-thinking-start-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Thinking starts immediately");

    const toggle = window.getByTestId("thinking-trace-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };

    await emitTestSessionEvent(harness, {
      type: "assistantThinkingStarted",
      sessionRef,
      timestamp: new Date().toISOString(),
    } satisfies Extract<SessionDriverEvent, { type: "assistantThinkingStarted" }>);

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("Thinking…");
    await expect(transcript).toContainText(/\b\d+s\b/);

    await emitTestSessionEvent(harness, {
      type: "assistantThinkingDelta",
      sessionRef,
      timestamp: new Date().toISOString(),
      text: "Checking deployment state before choosing a command.",
    } satisfies Extract<SessionDriverEvent, { type: "assistantThinkingDelta" }>);

    await expect(transcript).toContainText("Checking deployment state before choosing a command.");
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
PI_APP_TEST_MODE=background pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/timeline-thinking.spec.ts
```

Expected:

```text
typecheck exits 0
timeline-thinking.spec.ts passes
```

Commit:

```bash
git add apps/desktop/src/timeline-item.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/timeline-thinking.spec.ts
git commit -m "feat(desktop): show live thinking progress"
```

---

### Task 7: Add opt-in event tracing for diagnosing missing streams

**Files:**
- Modify: `packages/pi-sdk-driver/src/session-supervisor.ts`

- [ ] **Step 1: Add trace helper**

In `packages/pi-sdk-driver/src/session-supervisor.ts`, add this helper near `extractToolResultText`:

```ts
function traceSessionStreamEvent(label: string, payload: Record<string, unknown>): void {
  if (process.env.PI_GUI_SESSION_EVENT_TRACE !== "1") {
    return;
  }
  const printable = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value,
    ]),
  );
  console.debug(`[pi-gui session-stream] ${label}`, printable);
}
```

- [ ] **Step 2: Trace thinking and tool stream events**

In the `mapAgentEvent(...)` switch, add trace calls before returning these events:

```ts
if (event.assistantMessageEvent.type === "thinking_start") {
  traceSessionStreamEvent("thinking_start", { sessionId: record.ref.sessionId });
  return toDriverEvents({
    type: "assistantThinkingStarted" as const,
    sessionRef: record.ref,
    timestamp,
  }, record);
}
if (event.assistantMessageEvent.type === "thinking_delta") {
  traceSessionStreamEvent("thinking_delta", {
    sessionId: record.ref.sessionId,
    bytes: Buffer.byteLength(event.assistantMessageEvent.delta ?? ""),
  });
  return toDriverEvents({
    type: "assistantThinkingDelta" as const,
    sessionRef: record.ref,
    timestamp,
    text: event.assistantMessageEvent.delta ?? "",
  }, record);
}
```

In `tool_execution_update`, add:

```ts
traceSessionStreamEvent("tool_execution_update", {
  sessionId: record.ref.sessionId,
  callId: event.toolCallId,
  textBytes: text ? Buffer.byteLength(text) : 0,
  progress: typeof event.partialResult === "number" ? event.partialResult : undefined,
});
```

The final `tool_execution_update` case should be:

```ts
case "tool_execution_update": {
  const text = extractToolResultText(event.partialResult);
  traceSessionStreamEvent("tool_execution_update", {
    sessionId: record.ref.sessionId,
    callId: event.toolCallId,
    textBytes: text ? Buffer.byteLength(text) : 0,
    progress: typeof event.partialResult === "number" ? event.partialResult : undefined,
  });
  return toDriverEvents({
    type: "toolUpdated" as const,
    sessionRef: record.ref,
    timestamp,
    callId: event.toolCallId,
    ...(text ? { text } : {}),
    ...(typeof event.partialResult === "number" ? { progress: event.partialResult } : {}),
  }, record);
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected:

```text
typecheck exits 0
```

Manual diagnostic run:

```bash
PI_GUI_SESSION_EVENT_TRACE=1 pnpm --filter @pi-gui/desktop dev
```

Expected while running a command that prints once per second:

```text
[pi-gui session-stream] tool_execution_update { sessionId: ..., callId: ..., textBytes: ... }
```

Commit:

```bash
git add packages/pi-sdk-driver/src/session-supervisor.ts
git commit -m "chore(driver): trace live session stream events"
```

---

### Task 8: Full verification on tests and real Electron surface

**Files:**
- No source edits unless verification finds failures.

- [ ] **Step 1: Run typecheck**

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected:

```text
Exit status 0
```

- [ ] **Step 2: Run targeted Playwright coverage**

```bash
PI_APP_TEST_MODE=background pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/timeline-thinking.spec.ts
```

Expected:

```text
All tests in timeline-thinking.spec.ts pass
```

- [ ] **Step 3: Run full core lane**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected:

```text
All core Playwright tests pass
```

- [ ] **Step 4: Real Electron verification with delayed output**

Open the desktop app and ask a new thread to run this exact command:

```bash
node -e "let i=0; const t=setInterval(()=>{ i++; console.log('live-line-' + i); if (i === 5) clearInterval(t); }, 1000)"
```

Expected:

```text
A running bash tool card appears
The card shows running elapsed time
The card shows live-line-1 before the process exits
The card continues with live-line-2 through live-line-5
The no-output state is replaced by output as soon as output arrives
```

- [ ] **Step 5: Real Electron verification with deploy-like command**

From a repo with staging deploy scripts, ask the app to run the staging deploy command the user reported:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/store-new
NODE_ENV= pnpm --filter @apps/store deploy:staging
NODE_ENV= pnpm --filter @apps/store-adult deploy:staging
NODE_ENV= pnpm --filter @apps/store-safe deploy:staging
```

Expected:

```text
The running command card remains visibly alive immediately
If pnpm/wrangler emits output, it appears before command completion
If the command truly emits nothing for a period, the UI says "Still running. No stdout/stderr emitted yet." and elapsed time continues ticking
```

- [ ] **Step 6: Real Electron verification for thinking**

Use a thinking-capable model and set thinking level to `medium` or higher. Enable the thinking toggle, then ask for a multi-step plan.

Expected:

```text
Thinking bubble appears before final assistant text
Ninja star spins only inside the thinking bubble
Elapsed time increments while thinking is active
If provider emits thinking deltas, text streams into the bubble
If provider only emits final summary, the bubble stays alive until final text arrives
```

- [ ] **Step 7: Final commit if verification required fixes**

If verification required source edits, commit them:

```bash
git add <changed-files>
git commit -m "fix(desktop): polish live stream verification issues"
```

If no edits were required, do not create an empty commit.

---

## Self-Review

**Spec coverage:**
- Real brain icon: Task 1.
- Live command output while running: Tasks 2, 3, 4, 5, 8.
- Clear no-output but still-running state: Task 4.
- User-controlled expansion without expanding everything permanently: Task 5.
- Thinking appears immediately and streams if provider emits deltas: Task 6.
- Diagnose whether missing streams come from Pi/provider or GUI: Task 7.
- Real Electron verification: Task 8.

**Placeholder scan:**
- No `TBD`, `TODO`, `implement later`, or unspecified test instructions remain.
- The PTY implementation code is included in full.
- The test snippets include exact events and assertions.

**Type consistency:**
- `TimelineToolCall.outputText` and `updatedAt` are introduced before renderer usage.
- `makeToolItem` accepts the same new fields.
- `conversation-timeline-rows.ts` equality checks match the new fields.
- `useElapsedLabel` is defined before both tool and thinking rows use it.
