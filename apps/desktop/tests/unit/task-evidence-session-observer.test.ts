import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { afterEach, describe, expect, it } from "vitest";
import { TaskEvidenceLedger } from "../../electron/task-evidence-ledger";
import {
  classifyObservedCommand,
  TaskEvidenceSessionObserver,
} from "../../electron/task-evidence-session-observer";

const tempDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observer-"));
  tempDirectories.push(userDataDir);
  const ledger = new TaskEvidenceLedger(userDataDir, {
    now: () => new Date("2026-07-24T12:02:00.000Z"),
    workspacePath: () => "/workspace",
  });
  let id = 0;
  const observer = new TaskEvidenceSessionObserver(ledger, () => `evidence-${++id}`);
  return { ledger, observer };
}

const sessionRef = { workspaceId: "workspace-1", sessionId: "session-1" };

describe("classifyObservedCommand", () => {
  it("conservatively recognizes test harnesses and leaves other commands as commands", () => {
    expect(classifyObservedCommand("pnpm exec vitest run src/foo.test.ts")).toEqual({
      kind: "test",
      scope: "package",
    });
    expect(classifyObservedCommand("pnpm run test:e2e:live")).toEqual({
      kind: "test",
      scope: "electron-live",
    });
    expect(classifyObservedCommand("pnpm build")).toEqual({ kind: "command" });
  });
});

describe("TaskEvidenceSessionObserver", () => {
  it("correlates a tool command and completion without storing raw output", async () => {
    const { ledger, observer } = await setup();
    observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:00.000Z",
      toolName: "exec_command",
      callId: "call-1",
      input: { cmd: "pnpm exec vitest run src/foo.test.ts", cwd: "/workspace" },
    });
    observer.observe({
      type: "toolFinished",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:04.000Z",
      callId: "call-1",
      success: true,
      output: { exitCode: 0, stdout: "private raw test output" },
    });
    await observer.flush();

    const page = await ledger.query({ workspaceId: "workspace-1", kinds: ["test"] });
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({
      status: "passed",
      correlation: { toolCallId: "call-1", commandId: "call-1" },
      verification: {
        scope: "package",
        command: "pnpm exec vitest run src/foo.test.ts",
        cwd: ".",
        exitCode: 0,
        durationMs: 4_000,
        testIdentifiers: ["src/foo.test.ts"],
      },
    });
    expect(JSON.stringify(page.records)).not.toContain("private raw test output");
  });

  it("deduplicates terminal completion records for runtime reconnects", async () => {
    const { ledger, observer } = await setup();
    observer.observe({
      type: "sessionUpdated",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:00.000Z",
      snapshot: {
        ref: sessionRef,
        workspace: { workspaceId: "workspace-1", path: "/workspace", displayName: "Workspace" },
        title: "Thread",
        status: "running",
        updatedAt: "2026-07-24T12:00:00.000Z",
        runningRunId: "run-1",
      },
    });
    observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:00.000Z",
      toolName: "edit",
      callId: "write-1",
      input: { file_path: "/workspace/src/main.ts" },
    });
    observer.observe({
      type: "toolFinished",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:01.000Z",
      callId: "write-1",
      success: true,
    });
    const event = {
      type: "runCompleted",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:04.000Z",
      snapshot: {
        ref: sessionRef,
        workspace: { id: "workspace-1", displayName: "Workspace" },
        title: "Thread",
        status: "idle",
        updatedAt: "2026-07-24T12:00:04.000Z",
      },
    } satisfies Extract<SessionDriverEvent, { type: "runCompleted" }>;
    observer.observe(event);
    observer.observe(event);
    await observer.flush();

    const page = await ledger.query({ workspaceId: "workspace-1", kinds: ["completion"] });
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.completion).toMatchObject({
      outcome: "completed",
      elapsedMs: 4_000,
      checkoutPath: ".",
      changedPaths: ["src/main.ts"],
    });
  });

  it("records one running transition instead of one evidence row per session update", async () => {
    const { observer, ledger } = await setup();
    const event = {
      type: "sessionUpdated",
      sessionRef,
      runId: "run-stream",
      timestamp: "2026-07-30T01:00:00.000Z",
      snapshot: {
        ref: sessionRef,
        workspace: { workspaceId: "workspace-1", path: "/workspace", displayName: "Workspace" },
        title: "Thread",
        status: "running",
        updatedAt: "2026-07-30T01:00:00.000Z",
        runningRunId: "run-stream",
      },
    } satisfies Extract<SessionDriverEvent, { type: "sessionUpdated" }>;

    observer.observe(event);
    observer.observe({
      ...event,
      timestamp: "2026-07-30T01:00:00.100Z",
    });
    observer.observe({
      ...event,
      timestamp: "2026-07-30T01:00:00.200Z",
    });
    observer.observe({
      type: "assistantThinkingStarted",
      sessionRef,
      runId: "run-stream",
      timestamp: "2026-07-30T01:00:00.300Z",
    });
    observer.observe({
      type: "assistantDelta",
      sessionRef,
      runId: "run-stream",
      timestamp: "2026-07-30T01:00:00.400Z",
      text: "visible response",
    });
    await observer.flush();

    const records = await ledger.query({
      workspaceId: event.sessionRef.workspaceId,
      sessionId: event.sessionRef.sessionId,
      runId: "run-stream",
      limit: 100,
    });
    expect(records.records.filter((record) => record.kind === "activity")).toHaveLength(1);
    expect(records.records.find((record) => record.kind === "activity")).toMatchObject({
      summary: "Responding",
      activity: { type: "working" },
    });
  });

  it("rate-limits tool progress and upserts the latest stable progress row", async () => {
    const { observer, ledger } = await setup();
    observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "run-progress",
      timestamp: "2026-07-30T01:00:00.000Z",
      toolName: "exec_command",
      callId: "call-progress",
      input: { cmd: "pnpm test" },
    });
    for (let index = 0; index < 100; index += 1) {
      observer.observe({
        type: "toolUpdated",
        sessionRef,
        runId: "run-progress",
        timestamp: new Date(Date.parse("2026-07-30T01:00:00.100Z") + index * 10).toISOString(),
        callId: "call-progress",
        text: `progress ${index}`,
        progress: index / 100,
      });
    }
    await observer.flush();

    const page = await ledger.query({
      workspaceId: "workspace-1",
      runId: "run-progress",
      limit: 100,
    });
    const progress = page.records.filter((record) => record.id.includes("progress:tool"));
    expect(progress).toHaveLength(1);
    expect(progress[0]?.summary).toBe("progress 50");
  });

  it("records generic work, retry activity, and correlated failure attempts", async () => {
    const { ledger, observer } = await setup();
    const runningSnapshot = {
      ref: sessionRef,
      workspace: { workspaceId: "workspace-1", path: "/workspace", displayName: "Workspace" },
      title: "Thread",
      status: "running" as const,
      updatedAt: "2026-07-24T12:00:00.000Z",
      runningRunId: "run-1",
    };
    observer.observe({
      type: "sessionUpdated",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:00.000Z",
      snapshot: runningSnapshot,
    });
    observer.observe({
      type: "runFailed",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:02.000Z",
      error: { message: "Provider rate limit reached", code: "429" },
    });
    observer.observe({
      type: "sessionUpdated",
      sessionRef,
      runId: "run-2",
      timestamp: "2026-07-24T12:00:03.000Z",
      snapshot: { ...runningSnapshot, runningRunId: "run-2" },
    });
    observer.observe({
      type: "runFailed",
      sessionRef,
      runId: "run-2",
      timestamp: "2026-07-24T12:00:04.000Z",
      error: { message: "Provider rate limit reached", code: "429" },
    });
    await observer.flush();

    const activity = await ledger.query({ workspaceId: "workspace-1", kinds: ["activity"] });
    expect(activity.records.map((record) => record.activity?.type)).toEqual([
      "retrying",
      "working",
    ]);
    const errors = await ledger.query({ workspaceId: "workspace-1", kinds: ["error"] });
    expect(errors.records[0]?.error).toMatchObject({
      attemptCount: 2,
      originalEvidenceId: "workspace-1:session-1:error:run-1",
    });
    expect(errors.records[1]?.error).toMatchObject({ attemptCount: 1 });
  });

  it("distinguishes blocked, interrupted, and partially completed terminal outcomes", async () => {
    const { ledger, observer } = await setup();
    observer.observe({
      type: "runFailed",
      sessionRef,
      runId: "blocked-run",
      timestamp: "2026-07-24T12:00:01.000Z",
      error: { message: "Provider rate limit reached", code: "429" },
    });
    observer.observe({
      type: "runFailed",
      sessionRef,
      runId: "interrupted-run",
      timestamp: "2026-07-24T12:00:02.000Z",
      error: { message: "Runtime stopped", code: "INTERRUPTED" },
    });
    observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "partial-run",
      timestamp: "2026-07-24T12:00:03.000Z",
      toolName: "edit",
      callId: "partial-write",
      input: { file_path: "/workspace/src/partial.ts" },
    });
    observer.observe({
      type: "toolFinished",
      sessionRef,
      runId: "partial-run",
      timestamp: "2026-07-24T12:00:04.000Z",
      callId: "partial-write",
      success: true,
    });
    observer.observe({
      type: "runFailed",
      sessionRef,
      runId: "partial-run",
      timestamp: "2026-07-24T12:00:05.000Z",
      error: { message: "A later command failed", code: "COMMAND_FAILED" },
    });
    await observer.flush();

    const completions = await ledger.query({ workspaceId: "workspace-1", kinds: ["completion"] });
    expect(completions.records.map((record) => record.completion?.outcome)).toEqual([
      "partial",
      "interrupted",
      "blocked",
    ]);
    expect(completions.records[0]?.completion?.changedPaths).toEqual(["src/partial.ts"]);
  });
});

describe("TaskEvidenceLedger residency", () => {
  it("evicts persisted idle workspaces by access order", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-ledger-lru-"));
    tempDirectories.push(userDataDir);
    const ledger = new TaskEvidenceLedger(userDataDir, {
      maxResidentWorkspaces: 2,
      now: () => new Date("2026-07-30T01:00:00.000Z"),
    });
    for (let index = 0; index < 3; index += 1) {
      await ledger.appendMany([{
        schemaVersion: 1,
        id: `evidence-${index}`,
        workspaceId: `workspace-${index}`,
        sessionId: `session-${index}`,
        timestamp: "2026-07-30T01:00:00.000Z",
        kind: "completion",
        source: "runtime",
        authority: "runtime-observed",
        status: "passed",
        summary: "Done",
      }]);
    }
    await ledger.flush();
    expect(ledger.getResidentWorkspaceCount()).toBe(2);
    const restored = await ledger.query({ workspaceId: "workspace-0" });
    expect(restored.records).toHaveLength(1);
    expect(ledger.getResidentWorkspaceCount()).toBe(2);
  });
});
