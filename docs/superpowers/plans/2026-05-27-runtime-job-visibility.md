# Runtime Job Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi GUI show agent/tool/background process state as structured runtime objects, with timeline job cards as the primary truth surface.

**Architecture:** Add runtime job types to the session-driver contract, instrument the desktop PTY bash tool to report shell PID/process-group lifecycle, track jobs in `SessionSupervisor`, and project them into desktop state/timeline UI. Process discovery is conservative: Pi-owned process groups are `tracked`, child survivors are `survived`, PID lines parsed from output are `claimed`, and unverifiable work is `unknown`.

**Tech Stack:** TypeScript, Electron main/renderer, `node-pty`, macOS/POSIX `ps`, Playwright Electron core/live tests, existing `SessionDriverEvent` and transcript timeline rendering.

---

## File structure

### Contract and driver

- Modify `packages/session-driver/src/types.ts`
  - Add runtime job types and `runtimeJobUpdated` event.
  - Add `runtimeSummary` to `SessionSnapshot`.
- Modify `packages/pi-sdk-driver/src/vendor/session-driver.d.ts`
  - Mirror the session-driver public types for the vendored declaration file.
- Create `packages/pi-sdk-driver/src/runtime-process-inspector.ts`
  - Small POSIX process helpers: `isProcessAlive`, `snapshotProcessTree`, `signalProcessGroup`.
- Create `packages/pi-sdk-driver/src/runtime-job-registry.ts`
  - Pure per-session runtime job reducer and serializer.
- Modify `packages/pi-sdk-driver/src/pty-bash-tool.ts`
  - Add lifecycle callbacks from PTY shell start, output chunk, exit, abort.
  - Keep existing bash behavior unchanged.
- Modify `packages/pi-sdk-driver/src/session-supervisor.ts`
  - Create a per-runtime bridge before runtime creation.
  - Associate PTY lifecycle callbacks with `tool_execution_start` events.
  - Emit/persist `runtimeJobUpdated` events and include `runtimeSummary` in snapshots.
- Modify `packages/pi-sdk-driver/src/session-supervisor-utils.ts`
  - Copy runtime summary into `SessionSnapshot`.

### Desktop model and UI

- Modify `apps/desktop/src/timeline-types.ts`
  - Add `TimelineRuntimeJob` transcript item.
- Modify `apps/desktop/src/desktop-state.ts`
  - Add runtime summary fields to `SessionRecord` and per-session runtime job map to `DesktopAppState`.
- Modify `apps/desktop/electron/session-state-map.ts`
  - Add `runtimeJobsBySession` map and prune/delete behavior.
- Modify `apps/desktop/electron/app-store-session-state.ts`
  - Merge runtime summaries into session records.
- Modify `apps/desktop/electron/app-store-utils.ts`
  - Build session records with runtime summary from catalog/snapshot state.
- Modify `apps/desktop/electron/app-store-timeline.ts`
  - Upsert timeline runtime job cards from `runtimeJobUpdated`.
- Modify `apps/desktop/electron/app-store.ts`
  - Apply runtime job events into state, publish transcripts, persist UI where needed.
- Modify `apps/desktop/src/timeline-item.tsx`
  - Render runtime job cards.
- Modify `apps/desktop/src/topbar.tsx`, `apps/desktop/src/sidebar` surfaces in `App.tsx`/thread row code, and composer footer code in `composer-panel.tsx` or owner component.
  - Show compact runtime status badges.
- Modify `apps/desktop/src/logs-panel.tsx`
  - Rename current panel labels to make app logs explicit.
  - Add Runtime tab stub that reads current runtime job state.

### Tests

- Create `apps/desktop/tests/core/runtime-jobs.spec.ts`
  - Synthetic runtime events prove timeline cards/status badges.
- Add live targeted coverage to `apps/desktop/tests/live/tool-calls.spec.ts` or create `apps/desktop/tests/live/runtime-jobs.spec.ts`
  - Real bash background survivor detection.
- Add helper functions in `apps/desktop/tests/helpers/electron-app.ts` only if existing helpers cannot read runtime state cleanly.

---

## Task 1: Extend the session-driver runtime job contract

**Files:**
- Modify: `packages/session-driver/src/types.ts`
- Modify: `packages/pi-sdk-driver/src/vendor/session-driver.d.ts`
- Test: `packages/session-driver` TypeScript build

- [ ] **Step 1: Add runtime job types to `packages/session-driver/src/types.ts`**

Add these exports near the existing `SessionStatus` / `SessionSnapshot` declarations:

```ts
export type RuntimeJobKind = "tool" | "process" | "background";
export type RuntimeJobStatus = "running" | "exited" | "failed" | "background" | "unknown" | "killed";
export type RuntimeJobConfidence = "tracked" | "survived" | "claimed" | "unknown";

export interface RuntimeProcessSnapshot {
  readonly pid: number;
  readonly parentPid?: number;
  readonly processGroupId?: number;
  readonly command?: string;
  readonly cwd?: string;
  readonly status: RuntimeJobStatus;
  readonly confidence: RuntimeJobConfidence;
  readonly startedAt?: Timestamp;
  readonly updatedAt: Timestamp;
  readonly exitedAt?: Timestamp;
  readonly exitCode?: number | null;
  readonly signal?: string;
}

export interface RuntimeJobSnapshot {
  readonly id: string;
  readonly sessionRef: SessionRef;
  readonly runId?: RunId;
  readonly toolCallId?: string;
  readonly kind: RuntimeJobKind;
  readonly status: RuntimeJobStatus;
  readonly confidence: RuntimeJobConfidence;
  readonly title: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly startedAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly endedAt?: Timestamp;
  readonly exitCode?: number | null;
  readonly signal?: string;
  readonly process?: RuntimeProcessSnapshot;
  readonly children?: readonly RuntimeProcessSnapshot[];
  readonly logPaths?: readonly string[];
  readonly artifactPaths?: readonly string[];
  readonly message?: string;
}

export interface RuntimeSummarySnapshot {
  readonly agentStatus: SessionStatus;
  readonly activeToolCount: number;
  readonly backgroundJobCount: number;
  readonly unknownJobCount: number;
  readonly jobs: readonly RuntimeJobSnapshot[];
}
```

- [ ] **Step 2: Add runtime summary to `SessionSnapshot`**

Update the `SessionSnapshot` interface:

```ts
export interface SessionSnapshot {
  readonly ref: SessionRef;
  readonly workspace: WorkspaceRef;
  readonly title: string;
  readonly status: SessionStatus;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
  readonly preview?: string;
  readonly config?: SessionConfig;
  readonly runningRunId?: RunId;
  readonly queuedMessages?: readonly SessionQueuedMessage[];
  readonly runtimeSummary?: RuntimeSummarySnapshot;
}
```

- [ ] **Step 3: Add a runtime job event**

Add this interface near `ToolFinishedEvent`:

```ts
export interface RuntimeJobUpdatedEvent extends SessionEventBase {
  readonly type: "runtimeJobUpdated";
  readonly job: RuntimeJobSnapshot;
  readonly summary: RuntimeSummarySnapshot;
}
```

Then add `RuntimeJobUpdatedEvent` to the `SessionDriverEvent` union.

- [ ] **Step 4: Mirror the same declarations in `packages/pi-sdk-driver/src/vendor/session-driver.d.ts`**

Copy the exact type/interface declarations from Steps 1-3 into the vendored declaration file in the matching positions. Keep property names identical.

- [ ] **Step 5: Run type build**

Run:

```bash
pnpm --filter @pi-gui/session-driver run build
```

Expected: build passes.

- [ ] **Step 6: Commit**

```bash
git add packages/session-driver/src/types.ts packages/pi-sdk-driver/src/vendor/session-driver.d.ts
git commit -m "feat(session-driver): add runtime job contract"
```

---

## Task 2: Add process inspection utilities

**Files:**
- Create: `packages/pi-sdk-driver/src/runtime-process-inspector.ts`
- Test: `packages/pi-sdk-driver` TypeScript build

- [ ] **Step 1: Create `runtime-process-inspector.ts`**

Create this file:

```ts
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessInfo {
  readonly pid: number;
  readonly parentPid: number;
  readonly processGroupId?: number;
  readonly command: string;
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (platform() === "win32" || pid === undefined || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function snapshotProcessTree(rootPid: number | undefined): Promise<readonly ProcessInfo[]> {
  if (rootPid === undefined || rootPid <= 0 || platform() === "win32") return [];
  const processes = await listProcesses();
  const byParent = new Map<number, ProcessInfo[]>();
  for (const item of processes) {
    const current = byParent.get(item.parentPid) ?? [];
    current.push(item);
    byParent.set(item.parentPid, current);
  }

  const result: ProcessInfo[] = [];
  const queue = [rootPid];
  const seen = new Set<number>(queue);
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined) continue;
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      result.push(child);
      queue.push(child.pid);
    }
  }
  return result;
}

async function listProcesses(): Promise<readonly ProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid=,command="], {
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map(parsePsLine)
      .filter((item): item is ProcessInfo => item !== undefined);
  } catch {
    return [];
  }
}

function parsePsLine(line: string): ProcessInfo | undefined {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return undefined;
  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    processGroupId: Number(match[3]),
    command: match[4] ?? "",
  };
}
```

- [ ] **Step 2: Run type build**

Run:

```bash
pnpm --filter @pi-gui/pi-sdk-driver run build
```

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add packages/pi-sdk-driver/src/runtime-process-inspector.ts
git commit -m "feat(driver): add runtime process inspection"
```

---

## Task 3: Add pure runtime job registry

**Files:**
- Create: `packages/pi-sdk-driver/src/runtime-job-registry.ts`
- Modify: `packages/pi-sdk-driver/src/session-supervisor-utils.ts`
- Test: `packages/pi-sdk-driver` TypeScript build

- [ ] **Step 1: Create `runtime-job-registry.ts`**

Create this file:

```ts
import type {
  RuntimeJobConfidence,
  RuntimeJobSnapshot,
  RuntimeJobStatus,
  RuntimeProcessSnapshot,
  RuntimeSummarySnapshot,
  RunId,
  SessionRef,
  SessionStatus,
} from "@pi-gui/session-driver";

export interface RuntimeJobRegistryState {
  readonly jobs: Map<string, RuntimeJobSnapshot>;
}

export function createRuntimeJobRegistryState(): RuntimeJobRegistryState {
  return { jobs: new Map() };
}

export function upsertRuntimeJob(
  state: RuntimeJobRegistryState,
  job: RuntimeJobSnapshot,
): RuntimeJobSnapshot {
  const existing = state.jobs.get(job.id);
  const next = existing ? mergeJob(existing, job) : cloneJob(job);
  state.jobs.set(next.id, next);
  return next;
}

export function buildRuntimeSummary(
  state: RuntimeJobRegistryState,
  agentStatus: SessionStatus,
): RuntimeSummarySnapshot {
  const jobs = [...state.jobs.values()].map(cloneJob).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {
    agentStatus,
    activeToolCount: jobs.filter((job) => job.kind === "tool" && job.status === "running").length,
    backgroundJobCount: jobs.filter((job) => job.status === "background" || (job.kind === "background" && job.status === "running")).length,
    unknownJobCount: jobs.filter((job) => job.status === "unknown" || job.confidence === "unknown" || job.confidence === "claimed").length,
    jobs,
  };
}

export function createToolRuntimeJob(input: {
  readonly sessionRef: SessionRef;
  readonly runId?: RunId;
  readonly toolCallId: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly timestamp: string;
}): RuntimeJobSnapshot {
  return {
    id: `tool:${input.toolCallId}`,
    sessionRef: { ...input.sessionRef },
    ...(input.runId ? { runId: input.runId } : {}),
    toolCallId: input.toolCallId,
    kind: "tool",
    status: "running",
    confidence: "tracked",
    title: input.command ? "Bash" : "Tool",
    ...(input.command ? { command: input.command } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    startedAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function createBackgroundRuntimeJob(input: {
  readonly sessionRef: SessionRef;
  readonly parentToolCallId?: string;
  readonly process: RuntimeProcessSnapshot;
  readonly command?: string;
  readonly cwd?: string;
  readonly timestamp: string;
  readonly confidence: RuntimeJobConfidence;
}): RuntimeJobSnapshot {
  return {
    id: `process:${input.process.pid}`,
    sessionRef: { ...input.sessionRef },
    ...(input.parentToolCallId ? { toolCallId: input.parentToolCallId } : {}),
    kind: "background",
    status: input.process.status === "running" ? "background" : input.process.status,
    confidence: input.confidence,
    title: processTitle(input.process.command ?? input.command),
    command: input.process.command ?? input.command,
    cwd: input.process.cwd ?? input.cwd,
    startedAt: input.process.startedAt ?? input.timestamp,
    updatedAt: input.timestamp,
    process: { ...input.process },
  };
}

export function markRuntimeJobFinished(
  state: RuntimeJobRegistryState,
  id: string,
  input: {
    readonly status: RuntimeJobStatus;
    readonly timestamp: string;
    readonly exitCode?: number | null;
    readonly signal?: string;
    readonly message?: string;
  },
): RuntimeJobSnapshot | undefined {
  const existing = state.jobs.get(id);
  if (!existing) return undefined;
  const next: RuntimeJobSnapshot = {
    ...existing,
    status: input.status,
    updatedAt: input.timestamp,
    endedAt: input.timestamp,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
  state.jobs.set(next.id, next);
  return cloneJob(next);
}

function mergeJob(existing: RuntimeJobSnapshot, incoming: RuntimeJobSnapshot): RuntimeJobSnapshot {
  return cloneJob({
    ...existing,
    ...incoming,
    children: incoming.children ?? existing.children,
    logPaths: unique([...(existing.logPaths ?? []), ...(incoming.logPaths ?? [])]),
    artifactPaths: unique([...(existing.artifactPaths ?? []), ...(incoming.artifactPaths ?? [])]),
  });
}

function cloneJob(job: RuntimeJobSnapshot): RuntimeJobSnapshot {
  return {
    ...job,
    sessionRef: { ...job.sessionRef },
    process: job.process ? { ...job.process } : undefined,
    children: job.children?.map((child) => ({ ...child })),
    logPaths: job.logPaths ? [...job.logPaths] : undefined,
    artifactPaths: job.artifactPaths ? [...job.artifactPaths] : undefined,
  };
}

function unique(values: readonly string[]): readonly string[] | undefined {
  const next = [...new Set(values.filter((value) => value.trim()))];
  return next.length > 0 ? next : undefined;
}

function processTitle(command: string | undefined): string {
  if (!command) return "Background process";
  return command.replace(/\s+/g, " ").trim().slice(0, 80) || "Background process";
}
```

- [ ] **Step 2: Extend `SnapshotSource` in `session-supervisor-utils.ts`**

Add `RuntimeSummarySnapshot` to imports and add the property:

```ts
readonly runtimeSummary: RuntimeSummarySnapshot | undefined;
```

Update `buildSnapshot` to include:

```ts
...(source.runtimeSummary ? { runtimeSummary: source.runtimeSummary } : {}),
```

- [ ] **Step 3: Run type build**

Run:

```bash
pnpm --filter @pi-gui/pi-sdk-driver run build
```

Expected: build fails only if `ManagedSessionRecord` callers do not yet provide `runtimeSummary`. Add `runtimeSummary: undefined` at call sites temporarily if needed, then rerun until pass.

- [ ] **Step 4: Commit**

```bash
git add packages/pi-sdk-driver/src/runtime-job-registry.ts packages/pi-sdk-driver/src/session-supervisor-utils.ts
git commit -m "feat(driver): add runtime job registry"
```

---

## Task 4: Instrument the PTY bash tool with lifecycle callbacks

**Files:**
- Modify: `packages/pi-sdk-driver/src/pty-bash-tool.ts`
- Test: `packages/pi-sdk-driver` TypeScript build

- [ ] **Step 1: Extend `PtyBashOptions`**

Add this interface and fields above `PtyBashOptions`:

```ts
export interface PtyBashLifecycleEvent {
  readonly token: string;
  readonly command: string;
  readonly cwd: string;
  readonly pid?: number;
  readonly timestamp: string;
  readonly event: "spawned" | "output" | "exited" | "aborted";
  readonly exitCode?: number | null;
  readonly outputText?: string;
}

type PtyBashLifecycleListener = (event: PtyBashLifecycleEvent) => void;
```

Extend `PtyBashOptions`:

```ts
readonly onLifecycle?: PtyBashLifecycleListener;
```

- [ ] **Step 2: Add token creation inside `exec`**

Inside `exec(command, cwd, ...)`, before spawning the PTY, add:

```ts
const token = crypto.randomUUID();
const emitLifecycle = (event: Omit<PtyBashLifecycleEvent, "token" | "command" | "cwd" | "timestamp">) => {
  options.onLifecycle?.({
    token,
    command,
    cwd,
    timestamp: new Date().toISOString(),
    ...event,
  });
};
```

Add `import crypto from "node:crypto";` at the top.

- [ ] **Step 3: Emit lifecycle events**

After successful `spawnPty`, add:

```ts
emitLifecycle({ event: "spawned", pid: pty.pid });
```

Inside `pty.onData`, after `onData(Buffer.from(chunk));`, add:

```ts
emitLifecycle({ event: "output", pid: pty?.pid, outputText: chunk });
```

Inside `abort`, after `trySignalPty(pty, "SIGTERM");`, add:

```ts
emitLifecycle({ event: "aborted", pid: pty?.pid });
```

Inside `pty.onExit`, before resolving/rejecting in `finish`, add:

```ts
emitLifecycle({ event: "exited", pid: pty?.pid, exitCode });
```

- [ ] **Step 4: Preserve existing abort/timeout behavior**

Run:

```bash
pnpm --filter @pi-gui/pi-sdk-driver run build
```

Expected: build passes.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-sdk-driver/src/pty-bash-tool.ts
git commit -m "feat(driver): emit bash process lifecycle"
```

---

## Task 5: Wire runtime jobs into `SessionSupervisor`

**Files:**
- Modify: `packages/pi-sdk-driver/src/session-supervisor.ts`
- Modify: `packages/pi-sdk-driver/src/session-supervisor-utils.ts` if Task 3 left temporary values
- Test: `packages/pi-sdk-driver` TypeScript build

- [ ] **Step 1: Add registry fields to `ManagedSessionRecord`**

Import registry helpers and process helpers:

```ts
import {
  buildRuntimeSummary,
  createBackgroundRuntimeJob,
  createRuntimeJobRegistryState,
  createToolRuntimeJob,
  markRuntimeJobFinished,
  upsertRuntimeJob,
  type RuntimeJobRegistryState,
} from "./runtime-job-registry.js";
import { isProcessAlive, snapshotProcessTree } from "./runtime-process-inspector.js";
import type { PtyBashLifecycleEvent } from "./pty-bash-tool.js";
```

Add to `ManagedSessionRecord`:

```ts
runtimeJobs: RuntimeJobRegistryState;
pendingBashToolCalls: Map<string, { readonly callId: string; readonly command: string; readonly cwd: string; readonly startedAt: string }>;
bashTokenToToolCallId: Map<string, string>;
```

- [ ] **Step 2: Initialize record fields in `createRecord`**

Inside the record literal, add:

```ts
runtimeJobs: createRuntimeJobRegistryState(),
pendingBashToolCalls: new Map(),
bashTokenToToolCallId: new Map(),
```

- [ ] **Step 3: Add helper for runtime summary**

Add a private method:

```ts
private runtimeSummaryFor(record: ManagedSessionRecord) {
  return buildRuntimeSummary(record.runtimeJobs, record.status);
}
```

Update every `buildSnapshot(record)` source path by ensuring `ManagedSessionRecord` satisfies `SnapshotSource` with `runtimeSummary`. The clean path is to add `runtimeSummary` as a getter-like field when building snapshots:

```ts
private snapshotSource(record: ManagedSessionRecord) {
  return {
    ...record,
    runtimeSummary: this.runtimeSummaryFor(record),
  };
}
```

Then replace `buildSnapshot(record)` calls with `buildSnapshot(this.snapshotSource(record))`.

- [ ] **Step 4: Create a PTY lifecycle bridge**

Before `createAgentSessionRuntimeImpl` calls in both `createSession` and `ensureRecord`, create a closure that will later resolve the active record:

```ts
let boundRecord: ManagedSessionRecord | undefined;
const onBashLifecycle = (event: PtyBashLifecycleEvent) => {
  if (!boundRecord) return;
  void this.handleBashLifecycle(boundRecord, event);
};
```

Pass the callback:

```ts
customTools: [createPtyBashToolDefinition(workspace.path, { onLifecycle: onBashLifecycle })],
```

After the record is created/reused and assigned, set:

```ts
boundRecord = record;
```

For reopen in `ensureRecord`, use the same custom tool override so reopened sessions also emit lifecycle events.

- [ ] **Step 5: Track bash tool starts**

In `handleAgentEvent` where `tool_execution_start` is handled, after `record.status = "running"`, add:

```ts
if (event.toolName === "bash" || event.toolName.endsWith(".bash")) {
  const args = event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : {};
  const command = typeof args.command === "string" ? args.command : "";
  record.pendingBashToolCalls.set(event.toolCallId, {
    callId: event.toolCallId,
    command,
    cwd: record.workspace.path,
    startedAt: timestamp,
  });
  const job = upsertRuntimeJob(record.runtimeJobs, createToolRuntimeJob({
    sessionRef: record.ref,
    runId: record.runningRunId,
    toolCallId: event.toolCallId,
    command,
    cwd: record.workspace.path,
    timestamp,
  }));
  void this.emitRuntimeJobUpdate(record, job, timestamp);
}
```

- [ ] **Step 6: Implement `handleBashLifecycle`**

Add this private method:

```ts
private async handleBashLifecycle(record: ManagedSessionRecord, event: PtyBashLifecycleEvent): Promise<void> {
  const callId = this.resolveBashToolCallId(record, event);
  if (!callId) return;
  record.bashTokenToToolCallId.set(event.token, callId);
  const toolJobId = `tool:${callId}`;
  const timestamp = event.timestamp;

  if (event.event === "spawned") {
    const existing = record.runtimeJobs.jobs.get(toolJobId);
    if (existing) {
      const job = upsertRuntimeJob(record.runtimeJobs, {
        ...existing,
        updatedAt: timestamp,
        process: event.pid ? {
          pid: event.pid,
          processGroupId: event.pid,
          command: event.command,
          cwd: event.cwd,
          status: "running",
          confidence: "tracked",
          startedAt: existing.startedAt,
          updatedAt: timestamp,
        } : existing.process,
      });
      await this.emitRuntimeJobUpdate(record, job, timestamp);
    }
    return;
  }

  if (event.event === "output" && event.outputText) {
    await this.recordClaimedPidJobs(record, callId, event.outputText, timestamp, event.cwd);
    return;
  }

  if (event.event === "exited" || event.event === "aborted") {
    const finished = markRuntimeJobFinished(record.runtimeJobs, toolJobId, {
      status: event.event === "aborted" ? "killed" : event.exitCode === 0 ? "exited" : "failed",
      timestamp,
      exitCode: event.exitCode,
    });
    if (finished) await this.emitRuntimeJobUpdate(record, finished, timestamp);
    await this.recordSurvivingChildren(record, callId, event, timestamp);
  }
}
```

- [ ] **Step 7: Implement call-id resolution and PID parsing**

Add these helpers:

```ts
private resolveBashToolCallId(record: ManagedSessionRecord, event: PtyBashLifecycleEvent): string | undefined {
  const mapped = record.bashTokenToToolCallId.get(event.token);
  if (mapped) return mapped;
  for (const [callId, pending] of record.pendingBashToolCalls) {
    if (pending.command === event.command) return callId;
  }
  return [...record.pendingBashToolCalls.keys()][0];
}

private async recordClaimedPidJobs(
  record: ManagedSessionRecord,
  callId: string,
  outputText: string,
  timestamp: string,
  cwd: string,
): Promise<void> {
  const matches = [...outputText.matchAll(/([\w.-]+)?\s*pid\s+(\d{2,})/gi)];
  for (const match of matches) {
    const pid = Number(match[2]);
    if (!Number.isFinite(pid) || pid <= 1) continue;
    const alive = isProcessAlive(pid);
    const job = upsertRuntimeJob(record.runtimeJobs, createBackgroundRuntimeJob({
      sessionRef: record.ref,
      parentToolCallId: callId,
      command: match[1] || `pid ${pid}`,
      cwd,
      timestamp,
      confidence: alive ? "claimed" : "unknown",
      process: {
        pid,
        status: alive ? "running" : "unknown",
        confidence: alive ? "claimed" : "unknown",
        command: match[1] || `pid ${pid}`,
        cwd,
        updatedAt: timestamp,
      },
    }));
    await this.emitRuntimeJobUpdate(record, job, timestamp);
  }
}

private async recordSurvivingChildren(
  record: ManagedSessionRecord,
  callId: string,
  event: PtyBashLifecycleEvent,
  timestamp: string,
): Promise<void> {
  const children = await snapshotProcessTree(event.pid);
  for (const child of children) {
    const alive = isProcessAlive(child.pid);
    if (!alive) continue;
    const job = upsertRuntimeJob(record.runtimeJobs, createBackgroundRuntimeJob({
      sessionRef: record.ref,
      parentToolCallId: callId,
      timestamp,
      confidence: "survived",
      process: {
        pid: child.pid,
        parentPid: child.parentPid,
        processGroupId: child.processGroupId,
        command: child.command,
        status: "running",
        confidence: "survived",
        updatedAt: timestamp,
      },
    }));
    await this.emitRuntimeJobUpdate(record, job, timestamp);
  }
}
```

- [ ] **Step 8: Emit runtime job updates**

Add this helper:

```ts
private async emitRuntimeJobUpdate(record: ManagedSessionRecord, job: RuntimeJobSnapshot, timestamp: string): Promise<void> {
  await this.persistSnapshot(record);
  await this.emit(record, {
    type: "runtimeJobUpdated",
    sessionRef: record.ref,
    timestamp,
    job,
    summary: this.runtimeSummaryFor(record),
  });
}
```

Import `RuntimeJobSnapshot` from `@pi-gui/session-driver`.

- [ ] **Step 9: Clean pending bash mappings on tool finish**

In `tool_execution_end`, before returning driver events, add:

```ts
record.pendingBashToolCalls.delete(event.toolCallId);
```

Keep `bashTokenToToolCallId` entries until session prune so late PTY lifecycle events can still resolve.

- [ ] **Step 10: Run type build**

Run:

```bash
pnpm --filter @pi-gui/pi-sdk-driver run build
```

Expected: build passes.

- [ ] **Step 11: Commit**

```bash
git add packages/pi-sdk-driver/src/session-supervisor.ts packages/pi-sdk-driver/src/session-supervisor-utils.ts
git commit -m "feat(driver): track runtime jobs for bash tools"
```

---

## Task 6: Project runtime jobs into desktop state and transcript cache

**Files:**
- Modify: `apps/desktop/src/desktop-state.ts`
- Modify: `apps/desktop/src/timeline-types.ts`
- Modify: `apps/desktop/electron/session-state-map.ts`
- Modify: `apps/desktop/electron/app-store-session-state.ts`
- Modify: `apps/desktop/electron/app-store-utils.ts`
- Modify: `apps/desktop/electron/app-store-timeline.ts`
- Modify: `apps/desktop/electron/app-store.ts`
- Test: desktop typecheck

- [ ] **Step 1: Add renderer state types**

In `desktop-state.ts`, import runtime types:

```ts
import type { RuntimeJobSnapshot, RuntimeSummarySnapshot } from "@pi-gui/session-driver";
```

Add to `SessionRecord`:

```ts
readonly runtimeSummary?: RuntimeSummarySnapshot;
```

Add to `DesktopAppState`:

```ts
readonly runtimeJobsBySession: Readonly<Record<string, readonly RuntimeJobSnapshot[]>>;
```

Initialize in `createEmptyDesktopAppState`:

```ts
runtimeJobsBySession: {},
```

- [ ] **Step 2: Add timeline runtime item type**

In `timeline-types.ts`, import `RuntimeJobSnapshot` and add:

```ts
export interface TimelineRuntimeJob {
  readonly kind: "runtime-job";
  readonly id: string;
  readonly createdAt: string;
  readonly job: RuntimeJobSnapshot;
}
```

Extend `TranscriptMessage`:

```ts
export type TranscriptMessage = SessionTranscriptMessage | TimelineThinking | TimelineActivity | TimelineToolCall | TimelineRuntimeJob | TimelineSummary;
```

- [ ] **Step 3: Add session state map storage**

In `session-state-map.ts`, import `RuntimeJobSnapshot` and add:

```ts
readonly runtimeJobsBySession = new Map<string, RuntimeJobSnapshot[]>();
```

Delete it in `deleteSession`:

```ts
this.runtimeJobsBySession.delete(key);
```

- [ ] **Step 4: Apply snapshot runtime summary to session records**

In `app-store-session-state.ts`, extend `updateSessionRecord` snapshot pick with `runtimeSummary` and set:

```ts
runtimeSummary: options.snapshot?.runtimeSummary ?? session.runtimeSummary,
```

- [ ] **Step 5: Build session records with runtime summary**

In `app-store-utils.ts`, when creating a `SessionRecord`, set:

```ts
runtimeSummary: undefined,
```

Then when a catalog session was hydrated through a snapshot, let `applySessionEventState` fill the summary.

- [ ] **Step 6: Upsert runtime job timeline cards**

In `app-store-timeline.ts`, add a case:

```ts
case "runtimeJobUpdated": {
  upsertRuntimeJobRow(transcript, event.job);
  break;
}
```

Add helper:

```ts
function upsertRuntimeJobRow(transcript: TranscriptMessage[], job: RuntimeJobSnapshot): void {
  const id = `runtime-job:${job.id}`;
  const index = transcript.findIndex((item) => item.kind === "runtime-job" && item.id === id);
  const next = {
    kind: "runtime-job" as const,
    id,
    createdAt: job.startedAt,
    job,
  };
  if (index >= 0) {
    transcript[index] = next;
    return;
  }
  transcript.push(next);
}
```

Import `RuntimeJobSnapshot`.

- [ ] **Step 7: Apply runtime job events in `app-store.ts`**

In `applySessionEventImmediately`, add a switch branch:

```ts
case "runtimeJobUpdated": {
  const jobs = this.sessionState.runtimeJobsBySession.get(key) ?? [];
  this.sessionState.runtimeJobsBySession.set(key, [
    event.job,
    ...jobs.filter((job) => job.id !== event.job.id),
  ]);
  break;
}
```

When constructing `this.state` after `applySessionEventState`, include a helper call that writes `runtimeJobsBySession` object and updates the selected session runtime summary from `event.summary`:

```ts
this.state = this.withRuntimeJobState(this.state, event);
```

Add helper:

```ts
private withRuntimeJobState(state: DesktopAppState, event: SessionDriverEvent): DesktopAppState {
  if (event.type !== "runtimeJobUpdated") return state;
  const key = sessionKey(event.sessionRef);
  const jobs = this.sessionState.runtimeJobsBySession.get(key) ?? [];
  return {
    ...state,
    runtimeJobsBySession: {
      ...state.runtimeJobsBySession,
      [key]: jobs.map((job) => ({ ...job })),
    },
    workspaces: state.workspaces.map((workspace) => workspace.id === event.sessionRef.workspaceId ? {
      ...workspace,
      sessions: workspace.sessions.map((session) => session.id === event.sessionRef.sessionId ? {
        ...session,
        runtimeSummary: event.summary,
      } : session),
    } : workspace),
  };
}
```

- [ ] **Step 8: Run desktop typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: typecheck passes.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/desktop-state.ts apps/desktop/src/timeline-types.ts apps/desktop/electron/session-state-map.ts apps/desktop/electron/app-store-session-state.ts apps/desktop/electron/app-store-utils.ts apps/desktop/electron/app-store-timeline.ts apps/desktop/electron/app-store.ts
git commit -m "feat(desktop): store runtime job state"
```

---

## Task 7: Render timeline runtime job cards

**Files:**
- Modify: `apps/desktop/src/timeline-item.tsx`
- Modify: `apps/desktop/src/conversation-timeline.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: new core test in Task 9 will cover UI

- [ ] **Step 1: Add runtime-job case to `TimelineItem`**

In `TimelineItem`, add:

```tsx
case "runtime-job":
  return <TimelineRuntimeJobItem item={item} />;
```

- [ ] **Step 2: Add renderer component**

Add this component near `TimelineToolCallItem`:

```tsx
function TimelineRuntimeJobItem({ item }: { readonly item: Extract<TranscriptMessage, { kind: "runtime-job" }> }) {
  const job = item.job;
  const isActive = job.status === "running" || job.status === "background";
  const process = job.process;
  const children = job.children ?? [];
  const title = job.status === "background"
    ? `${children.length > 0 ? children.length : 1} background job${(children.length > 1) ? "s" : ""} still running`
    : job.title;

  const copyText = [
    job.command ? `$ ${job.command}` : undefined,
    job.cwd ? `cwd: ${job.cwd}` : undefined,
    process?.pid ? `pid: ${process.pid}` : undefined,
    job.logPaths?.length ? `logs: ${job.logPaths.join(", ")}` : undefined,
  ].filter(Boolean).join("\n");

  return (
    <article className={`runtime-job-card runtime-job-card--${job.status}`} data-testid="runtime-job-card">
      <header className="runtime-job-card__header">
        {isActive ? <span className="timeline-tool__spinner" aria-hidden="true" /> : null}
        <div>
          <div className="runtime-job-card__eyebrow">Runtime</div>
          <h3>{title}</h3>
        </div>
        <span className="runtime-job-card__status">{job.status} · {job.confidence}</span>
      </header>
      {job.command ? <pre className="runtime-job-card__command">$ {job.command}</pre> : null}
      <dl className="runtime-job-card__meta">
        {job.cwd ? <><dt>cwd</dt><dd>{job.cwd}</dd></> : null}
        {process?.pid ? <><dt>pid</dt><dd>{process.pid}</dd></> : null}
        {process?.processGroupId ? <><dt>pgid</dt><dd>{process.processGroupId}</dd></> : null}
        <dt>elapsed</dt><dd><RunningElapsedText startedAt={job.startedAt} /></dd>
      </dl>
      {children.length > 0 ? (
        <ul className="runtime-job-card__children">
          {children.map((child) => (
            <li key={child.pid}>
              <span>pid {child.pid}</span>
              <span>{child.status}</span>
              <span>{child.confidence}</span>
              {child.command ? <code>{shortenCommand(child.command)}</code> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {job.logPaths?.length ? <div className="runtime-job-card__paths">logs: {job.logPaths.join(", ")}</div> : null}
      <div className="runtime-job-card__actions">
        <button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(copyText)}>Copy details</button>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Keep command search behavior**

In `conversation-timeline.tsx`, update the command tool predicate so runtime job cards with commands are searchable by thread search:

```ts
if (item.kind === "runtime-job") {
  return Boolean(item.job.command);
}
```

- [ ] **Step 4: Add CSS**

Add to `apps/desktop/src/styles/main.css`:

```css
.runtime-job-card {
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-elevated) 88%, transparent);
  padding: 14px;
  margin: 10px 0;
}

.runtime-job-card--running,
.runtime-job-card--background {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border-subtle));
}

.runtime-job-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.runtime-job-card__eyebrow {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.runtime-job-card__header h3 {
  margin: 2px 0 0;
  font-size: 14px;
}

.runtime-job-card__status {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 12px;
}

.runtime-job-card__command {
  margin: 12px 0;
  white-space: pre-wrap;
}

.runtime-job-card__meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 10px;
  font-size: 12px;
}

.runtime-job-card__meta dt {
  color: var(--text-muted);
}

.runtime-job-card__children {
  display: grid;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.runtime-job-card__children li {
  display: grid;
  grid-template-columns: max-content max-content max-content 1fr;
  gap: 8px;
  align-items: center;
}

.runtime-job-card__paths {
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 10px;
}

.runtime-job-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
```

- [ ] **Step 5: Run desktop typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/timeline-item.tsx apps/desktop/src/conversation-timeline.tsx apps/desktop/src/styles/main.css
git commit -m "feat(desktop): render runtime job timeline cards"
```

---

## Task 8: Add compact status indicators and Runtime/App logs panel split

**Files:**
- Modify: `apps/desktop/src/topbar.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/logs-panel.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: core test in Task 9

- [ ] **Step 1: Add a runtime status label helper**

Create `apps/desktop/src/runtime-status.ts`:

```ts
import type { RuntimeSummarySnapshot } from "@pi-gui/session-driver";
import type { SessionRecord } from "./desktop-state";

export function runtimeStatusLabel(session: SessionRecord | undefined): string {
  if (!session) return "No session";
  const summary = session.runtimeSummary;
  if (!summary) {
    if (session.status === "running") return "Agent running";
    if (session.status === "failed") return "Failed";
    return "Idle";
  }
  if (summary.activeToolCount > 0) return `Tool running · ${summary.activeToolCount}`;
  if (summary.backgroundJobCount > 0) return `Agent idle · ${summary.backgroundJobCount} background job${summary.backgroundJobCount === 1 ? "" : "s"}`;
  if (summary.unknownJobCount > 0) return "Unknown background activity";
  if (summary.agentStatus === "running") return "Agent running";
  if (summary.agentStatus === "failed") return "Failed";
  return "Agent idle · no tools running";
}

export function runtimeBadgeCount(session: SessionRecord | undefined): number {
  const summary = session?.runtimeSummary;
  return (summary?.activeToolCount ?? 0) + (summary?.backgroundJobCount ?? 0) + (summary?.unknownJobCount ?? 0);
}
```

- [ ] **Step 2: Show topbar status pill**

In `topbar.tsx`, import `runtimeStatusLabel` and render near the session title:

```tsx
{selectedSession ? (
  <span className="topbar__runtime-status" data-testid="topbar-runtime-status">
    {runtimeStatusLabel(selectedSession)}
  </span>
) : null}
```

Use the existing selected session prop; if the prop is not present, thread it from `App.tsx` where `Topbar` is rendered.

- [ ] **Step 3: Show thread row badge**

Where session rows are rendered in `App.tsx`, import `runtimeBadgeCount` and add:

```tsx
{runtimeBadgeCount(session) > 0 ? (
  <span className="session-row__runtime-badge" data-testid="session-runtime-badge">
    {runtimeBadgeCount(session)}
  </span>
) : null}
```

Keep the existing running spinner behavior; this badge complements it.

- [ ] **Step 4: Show composer footer truth line**

Near the composer metadata footer, render:

```tsx
<span className="composer-runtime-status" data-testid="composer-runtime-status">
  {runtimeStatusLabel(selectedSession)}
</span>
```

Pass `selectedSession` into the composer component if needed.

- [ ] **Step 5: Split logs panel labels**

In `logs-panel.tsx`, add a local tab state:

```tsx
const [tab, setTab] = useState<"runtime" | "task" | "app">("runtime");
```

Change header labels:

```tsx
<div className="logs-panel__eyebrow">Runtime</div>
<h2>Inspector</h2>
```

Render tabs:

```tsx
<div className="logs-panel__tabs" role="tablist">
  {(["runtime", "task", "app"] as const).map((value) => (
    <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
      {value === "runtime" ? "Runtime" : value === "task" ? "Task logs" : "App logs"}
    </button>
  ))}
</div>
```

For `tab === "runtime"`, render selected session runtime jobs from props:

```tsx
{tab === "runtime" ? (
  <div className="logs-panel__runtime" data-testid="runtime-panel">
    <h3>{selectedSession ? runtimeStatusLabel(selectedSession) : "No selected session"}</h3>
    {(selectedSession?.runtimeSummary?.jobs ?? []).length === 0 ? (
      <p>No runtime jobs are tracked for this thread.</p>
    ) : (
      <ul>
        {(selectedSession?.runtimeSummary?.jobs ?? []).map((job) => (
          <li key={job.id}>{job.title} · {job.status} · {job.confidence}</li>
        ))}
      </ul>
    )}
  </div>
) : null}
```

For `tab === "app"`, keep the existing current logs list. For `tab === "task"`, show session-jsonl/tool events by setting filters to current thread and category `tool`; this can use the same `page.events` list with a label saying `Task logs from session transcript and tool events`.

- [ ] **Step 6: Add CSS for compact indicators**

Add to `main.css`:

```css
.topbar__runtime-status,
.composer-runtime-status,
.session-row__runtime-badge {
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 12px;
  padding: 2px 8px;
}

.session-row__runtime-badge {
  margin-left: auto;
  min-width: 20px;
  text-align: center;
}

.logs-panel__tabs {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.logs-panel__tabs button[aria-selected="true"] {
  background: var(--surface-elevated);
  color: var(--text-primary);
}

.logs-panel__runtime {
  padding: 12px;
}
```

- [ ] **Step 7: Run desktop typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: typecheck passes.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/runtime-status.ts apps/desktop/src/topbar.tsx apps/desktop/src/App.tsx apps/desktop/src/logs-panel.tsx apps/desktop/src/styles/main.css
git commit -m "feat(desktop): surface runtime status indicators"
```

---

## Task 9: Add deterministic core coverage for runtime job UI

**Files:**
- Create: `apps/desktop/tests/core/runtime-jobs.spec.ts`
- Modify: `apps/desktop/package.json` if a targeted script is desired
- Test: targeted core spec

- [ ] **Step 1: Create `runtime-jobs.spec.ts`**

Create this file:

```ts
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const timestamp = () => new Date().toISOString();

test("renders runtime job cards and status indicators for background work", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("runtime-jobs-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Runtime job visibility");
    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    const sessionRef = { workspaceId, sessionId };

    await emitTestSessionEvent(harness, {
      type: "runtimeJobUpdated",
      sessionRef,
      timestamp: timestamp(),
      job: {
        id: "tool:call-runtime-bash",
        sessionRef,
        toolCallId: "call-runtime-bash",
        kind: "tool",
        status: "running",
        confidence: "tracked",
        title: "Bash",
        command: "node scripts/rest-lanes.mjs",
        cwd: workspacePath,
        startedAt: timestamp(),
        updatedAt: timestamp(),
        process: {
          pid: 37035,
          processGroupId: 37035,
          command: "node scripts/rest-lanes.mjs",
          cwd: workspacePath,
          status: "running",
          confidence: "tracked",
          updatedAt: timestamp(),
        },
      },
      summary: {
        agentStatus: "running",
        activeToolCount: 1,
        backgroundJobCount: 0,
        unknownJobCount: 0,
        jobs: [],
      },
    });

    await expect(window.getByTestId("runtime-job-card")).toContainText("Bash");
    await expect(window.getByTestId("runtime-job-card")).toContainText("pid");
    await expect(window.getByTestId("topbar-runtime-status")).toContainText("Tool running");

    await emitTestSessionEvent(harness, {
      type: "runtimeJobUpdated",
      sessionRef,
      timestamp: timestamp(),
      job: {
        id: "process:37845",
        sessionRef,
        toolCallId: "call-runtime-bash",
        kind: "background",
        status: "background",
        confidence: "survived",
        title: "rest-lane-2",
        command: "rest-lane-2",
        cwd: workspacePath,
        startedAt: timestamp(),
        updatedAt: timestamp(),
        process: {
          pid: 37845,
          parentPid: 37035,
          processGroupId: 37035,
          command: "rest-lane-2",
          cwd: workspacePath,
          status: "running",
          confidence: "survived",
          updatedAt: timestamp(),
        },
      },
      summary: {
        agentStatus: "idle",
        activeToolCount: 0,
        backgroundJobCount: 1,
        unknownJobCount: 0,
        jobs: [],
      },
    });

    await expect(window.getByTestId("runtime-job-card").filter({ hasText: "rest-lane-2" })).toHaveCount(1);
    await expect(window.getByTestId("topbar-runtime-status")).toContainText("1 background job");
    await expect(window.getByTestId("composer-runtime-status")).toContainText("1 background job");
    await expect(window.getByTestId("session-runtime-badge")).toContainText("1");
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run the new spec and expect initial failures if earlier tasks are incomplete**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/runtime-jobs.spec.ts
```

Expected after Tasks 1-8: passes.

- [ ] **Step 3: Add targeted script**

In `apps/desktop/package.json`, add:

```json
"test:core:runtime-jobs": "pnpm build && cross-env PI_APP_TEST_MODE=background pnpm --dir ../.. exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/runtime-jobs.spec.ts"
```

- [ ] **Step 4: Run targeted script**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:core:runtime-jobs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/tests/core/runtime-jobs.spec.ts apps/desktop/package.json
git commit -m "test(desktop): cover runtime job visibility"
```

---

## Task 10: Add real bash survivor coverage

**Files:**
- Create: `apps/desktop/tests/live/runtime-jobs.spec.ts`
- Modify: `apps/desktop/package.json`
- Test: targeted live spec

- [ ] **Step 1: Create live spec**

Create `apps/desktop/tests/live/runtime-jobs.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("detects a real bash background survivor", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("runtime-live-jobs-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Runtime live background survivor");
    const composer = window.getByTestId("composer");
    await composer.fill("Run this exact command with bash and do not wait for the child: `sh -c 'sleep 20 & echo rest-lane-1 pid $!'`");
    await composer.press("Enter");

    await expect.poll(async () => {
      const state = await getDesktopState(window);
      const session = state.workspaces
        .find((workspace) => workspace.id === state.selectedWorkspaceId)
        ?.sessions.find((entry) => entry.id === state.selectedSessionId);
      return session?.runtimeSummary?.backgroundJobCount ?? 0;
    }, { timeout: 45_000 }).toBeGreaterThan(0);

    await expect(window.getByTestId("runtime-job-card")).toContainText(/background|claimed|survived/i);
  } finally {
    await harness.close();
  }
});
```

If model/provider auth makes this too slow or nondeterministic locally, replace the user prompt with an existing test hook that sends a bash tool call through the driver. Keep the test in `live` because it requires real runtime/tool execution.

- [ ] **Step 2: Add package script**

In `apps/desktop/package.json`, add:

```json
"test:live:runtime-jobs": "pnpm build && cross-env PI_APP_TEST_MODE=background pnpm --dir ../.. exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/live/runtime-jobs.spec.ts"
```

- [ ] **Step 3: Run targeted live test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:live:runtime-jobs
```

Expected: pass on a machine with working local Pi provider auth. If auth is missing, document the skip/failure reason in the final verification report and rely on core coverage plus driver typecheck.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/tests/live/runtime-jobs.spec.ts apps/desktop/package.json
git commit -m "test(desktop): cover live runtime survivors"
```

---

## Task 11: Add stop/refresh actions for tracked jobs

**Files:**
- Modify: `packages/session-driver/src/types.ts`
- Modify: `packages/pi-sdk-driver/src/pi-sdk-driver.ts`
- Modify: `packages/pi-sdk-driver/src/session-supervisor.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/timeline-item.tsx`
- Modify: `apps/desktop/src/logs-panel.tsx`
- Test: core runtime job action coverage

- [ ] **Step 1: Extend driver interface**

In `packages/session-driver/src/types.ts`, add to `SessionDriver`:

```ts
stopRuntimeJob(sessionRef: SessionRef, jobId: string): Promise<void>;
refreshRuntimeJobs(sessionRef: SessionRef): Promise<RuntimeSummarySnapshot>;
```

Mirror this in `packages/pi-sdk-driver/src/vendor/session-driver.d.ts`.

- [ ] **Step 2: Implement driver methods**

In `pi-sdk-driver.ts`, forward methods:

```ts
stopRuntimeJob(sessionRef: SessionRef, jobId: string): Promise<void> {
  return this.supervisor.stopRuntimeJob(sessionRef, jobId);
}

refreshRuntimeJobs(sessionRef: SessionRef): Promise<RuntimeSummarySnapshot> {
  return this.supervisor.refreshRuntimeJobs(sessionRef);
}
```

In `session-supervisor.ts`, implement:

```ts
async stopRuntimeJob(sessionRef: SessionRef, jobId: string): Promise<void> {
  const record = await this.ensureRecord(sessionRef);
  const job = record.runtimeJobs.jobs.get(jobId);
  if (!job?.process?.pid || job.confidence === "claimed" || job.confidence === "unknown") {
    throw new Error("Only tracked runtime jobs can be stopped from Pi GUI.");
  }
  signalProcessGroup(job.process.processGroupId ?? job.process.pid, "SIGTERM");
  const timestamp = nowIso();
  const updated = markRuntimeJobFinished(record.runtimeJobs, jobId, {
    status: "killed",
    timestamp,
    signal: "SIGTERM",
  });
  if (updated) await this.emitRuntimeJobUpdate(record, updated, timestamp);
}

async refreshRuntimeJobs(sessionRef: SessionRef): Promise<RuntimeSummarySnapshot> {
  const record = await this.ensureRecord(sessionRef);
  const timestamp = nowIso();
  for (const job of record.runtimeJobs.jobs.values()) {
    const pid = job.process?.pid;
    if (!pid || job.status === "exited" || job.status === "failed" || job.status === "killed") continue;
    if (!isProcessAlive(pid)) {
      const updated = markRuntimeJobFinished(record.runtimeJobs, job.id, {
        status: "exited",
        timestamp,
      });
      if (updated) await this.emitRuntimeJobUpdate(record, updated, timestamp);
    }
  }
  return this.runtimeSummaryFor(record);
}
```

Import `signalProcessGroup`.

- [ ] **Step 3: Add IPC methods**

In `apps/desktop/src/ipc.ts`, add channels and API methods:

```ts
stopRuntimeJob: "pi-gui:stop-runtime-job",
refreshRuntimeJobs: "pi-gui:refresh-runtime-jobs",
```

Add to `PiDesktopApi`:

```ts
stopRuntimeJob(sessionRef: WorkspaceSessionTarget, jobId: string): Promise<void>;
refreshRuntimeJobs(sessionRef: WorkspaceSessionTarget): Promise<void>;
```

In `preload.ts`, expose invoke wrappers. In `main.ts`, handle by calling store methods. Add store methods in `app-store.ts` that call driver then refresh state.

- [ ] **Step 4: Wire UI actions**

Pass `api` or action callbacks into `TimelineItem` and `LogsPanel`. Add buttons:

```tsx
{job.process?.pid && job.confidence !== "claimed" && job.confidence !== "unknown" && (job.status === "running" || job.status === "background") ? (
  <button type="button" className="secondary-button secondary-button--danger" onClick={() => onStopRuntimeJob?.(job.id)}>Stop</button>
) : null}
<button type="button" className="secondary-button" onClick={() => onRefreshRuntimeJobs?.()}>Refresh status</button>
```

- [ ] **Step 5: Add core action test**

Extend `runtime-jobs.spec.ts` with a synthetic tracked job and click `Refresh status`. For `Stop`, use a test hook or mock driver path if available; do not kill real arbitrary PIDs in core tests.

- [ ] **Step 6: Run checks**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
pnpm --filter @pi-gui/desktop run test:core:runtime-jobs
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add packages/session-driver/src/types.ts packages/pi-sdk-driver/src/vendor/session-driver.d.ts packages/pi-sdk-driver/src/pi-sdk-driver.ts packages/pi-sdk-driver/src/session-supervisor.ts apps/desktop/src/ipc.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts apps/desktop/electron/app-store.ts apps/desktop/src/timeline-item.tsx apps/desktop/src/logs-panel.tsx apps/desktop/tests/core/runtime-jobs.spec.ts
git commit -m "feat(desktop): add runtime job controls"
```

---

## Task 12: Final verification and cleanup

**Files:**
- Modify only files changed by previous tasks if verification exposes defects.
- Test: desktop target lanes

- [ ] **Step 1: Run package typechecks**

Run:

```bash
pnpm --filter @pi-gui/session-driver run build
pnpm --filter @pi-gui/pi-sdk-driver run build
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: all pass.

- [ ] **Step 2: Run targeted core proof**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:core:runtime-jobs
pnpm --filter @pi-gui/desktop run test:core:reopen-state
```

Expected: both pass. `reopen-state` proves stale running reconciliation still works.

- [ ] **Step 3: Run targeted live proof**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:live:runtime-jobs
```

Expected: pass when local Pi runtime/provider auth is configured. If auth blocks execution, record exact error output.

- [ ] **Step 4: Run strongest practical desktop lane**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected: core lane passes or only known unrelated flakes fail. If unrelated failures occur, rerun the failing specs once and record before/after output.

- [ ] **Step 5: Manual Electron surface smoke**

Run:

```bash
pnpm --filter @pi-gui/desktop dev
```

In the real app:

1. Open a thread.
2. Run a bash command that starts background work: `sh -c 'sleep 60 & echo rest-lane-1 pid $!'`.
3. Confirm a timeline runtime card appears.
4. Confirm topbar and composer footer say background job is running.
5. Open the right panel and confirm the default tab is Runtime.
6. Click Refresh status and confirm status remains visible.
7. Stop the tracked job if it is tracked; if it is claimed, confirm the UI refuses unsafe stop.

- [ ] **Step 6: Final commit if fixes were needed**

```bash
git status --short
git add <fixed-files>
git commit -m "fix(desktop): polish runtime job visibility"
```

Skip the commit if there are no changes after verification.

---

## Self-review

- Spec coverage: Tasks 1-5 implement runtime process/job model; Tasks 6-8 implement timeline cards, status pills, and Runtime/App logs split; Tasks 9-10 cover deterministic and real bash cases; Task 11 adds safe actions; Task 12 verifies desktop surface.
- Completeness scan: every task defines concrete names, paths, snippets, commands, and expected outcomes.
- Type consistency: `RuntimeJobSnapshot`, `RuntimeSummarySnapshot`, `runtimeJobUpdated`, `runtimeSummary`, and `runtimeJobsBySession` are used consistently across contract, driver, store, and renderer.
