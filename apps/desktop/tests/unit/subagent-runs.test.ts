import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { DesktopAppStore } from "../../electron/app-store";
import { SubagentRunStore } from "../../electron/subagent-runs";
import { SubagentAuditAdapter } from "../../electron/subagent-audit-adapter";
import { BUILTIN_SUBAGENT_WORKFLOWS, buildSubagentWorkflowMessageMetadata } from "../../src/subagent-workflows";

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SubagentRunStore queued workflow correlation", () => {
  it("reports a queued workflow that finishes without invoking Agent", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-subagent-runs-"));
    temporaryDirs.push(userDataDir);
    const runStore = new SubagentRunStore(userDataDir);
    const target = { workspaceId: "workspace-1", sessionId: "session-1" };
    const workflow = BUILTIN_SUBAGENT_WORKFLOWS[0];
    if (!workflow) throw new Error("Expected a built-in workflow fixture.");

    const store = {
      sessionFromState: () => ({ status: "running" }),
      getWorkspacePath: () => "/tmp/workspace-1",
      submitComposerToSession: async () => ({ lastError: undefined }),
    } as unknown as DesktopAppStore;

    const [submitted] = await runStore.runWorkflow(store, { workflowId: workflow.id, target }, workflow);
    if (!submitted?.workflowRunId) throw new Error("Expected a correlated workflow run.");

    await runStore.applySessionEvent(runCompletedEvent(target, "current-parent-finished"));
    expect((await runStore.listRuns(target.workspaceId))[0]?.status).toBe("submitted");

    await runStore.applySessionEvent({
      type: "queuedMessageStarted",
      sessionRef: target,
      timestamp: "2026-07-20T00:00:01.000Z",
      message: {
        id: "queued-workflow-message",
        mode: "followUp",
        text: "Run workflow",
        metadata: buildSubagentWorkflowMessageMetadata(workflow, submitted.workflowRunId),
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:01.000Z",
      },
    });
    await runStore.applySessionEvent(runCompletedEvent(target, "queued-workflow-finished"));

    const [finished] = await runStore.listRuns(target.workspaceId);
    expect(finished?.status).toBe("failed");
    expect(finished?.executionStartedAt).toBe("2026-07-20T00:00:01.000Z");
    expect(finished?.error).toBe("Workflow finished without invoking the Agent tool.");
    runStore.dispose();
  });
});

describe("SubagentRunStore multi-child aggregation", () => {
  it("retains each Agent lifecycle and completes only after every workflow role finishes", async () => {
    const { runStore, target } = await createSubmittedWorkflow();

    await runStore.applySessionEvent(subagentEvent(target, "scout-call", "scout", "completed", 2));
    let [run] = await runStore.listRuns(target.workspaceId);
    expect(run?.status).toBe("running");
    expect(run?.childRuns).toMatchObject([
      { lifecycleRunId: "scout-call", role: "scout", status: "completed", toolUseCount: 2 },
    ]);

    await runStore.applySessionEvent(subagentEvent(target, "planner-call", "planner", "started"));
    await runStore.applySessionEvent(subagentEvent(target, "planner-call", "planner", "completed", 3));
    [run] = await runStore.listRuns(target.workspaceId);
    expect(run?.status).toBe("completed");
    expect(run?.toolUseCount).toBe(5);
    expect(run?.childRuns).toHaveLength(2);
    expect(run?.summary).toContain("scout-call complete");
    expect(run?.summary).toContain("planner-call complete");
    runStore.dispose();
  });

  it("fails honestly when the parent turn ends before all expected Agent runs occur", async () => {
    const { runStore, target } = await createSubmittedWorkflow();
    await runStore.applySessionEvent(subagentEvent(target, "scout-call", "scout", "completed", 1));
    await runStore.applySessionEvent(runCompletedEvent(target, "workflow-parent-finished"));

    const [run] = await runStore.listRuns(target.workspaceId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("Workflow finished after invoking 1 of 2 expected Agent runs.");
    expect(run?.childRuns).toHaveLength(1);
    runStore.dispose();
  });

  it("does not resurrect a cancelled workflow when a late child event arrives", async () => {
    const { runStore, store, target } = await createSubmittedWorkflow();
    await runStore.applySessionEvent(subagentEvent(target, "scout-call", "scout", "started"));
    const [active] = await runStore.listRuns(target.workspaceId);
    if (!active) throw new Error("Expected an active workflow run.");
    await runStore.cancelRun(store, target.workspaceId, active.id);
    await runStore.applySessionEvent(subagentEvent(target, "scout-call", "scout", "completed", 1));

    const [cancelled] = await runStore.listRuns(target.workspaceId);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.childRuns?.[0]?.status).toBe("running");
    runStore.dispose();
  });

  it("backfills late child completion details without hiding a parent turn failure", async () => {
    const { runStore, target } = await createSubmittedWorkflow();
    await runStore.applySessionEvent(subagentEvent(target, "scout-call", "scout", "started"));
    await runStore.applySessionEvent(subagentEvent(target, "planner-call", "planner", "started"));
    await runStore.applySessionEvent({
      type: "runFailed",
      sessionRef: target,
      timestamp: "2026-07-20T00:00:03.000Z",
      runId: "parent-run",
      error: { message: "Provider unavailable", code: "provider_unavailable" },
    });
    await runStore.applySessionEvent(subagentEvent(target, "scout-call", "scout", "completed", 2));
    await runStore.applySessionEvent(subagentEvent(target, "planner-call", "planner", "completed", 3));

    const [run] = await runStore.listRuns(target.workspaceId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Provider unavailable");
    expect(run?.toolUseCount).toBe(5);
    expect(run?.childRuns?.map((child) => child.status)).toEqual(["completed", "completed"]);
    runStore.dispose();
  });
});

describe("SubagentRunStore durable audit correlation", () => {
  it("correlates audit agent IDs to the exact workflow and backfills terminal detail", async () => {
    const { runStore, target } = await createSubmittedWorkflow();
    const auditDir = await mkdtemp(join(tmpdir(), "pi-gui-subagent-audit-"));
    temporaryDirs.push(auditDir);
    const auditPath = join(auditDir, "subagents-audit.jsonl");
    const adapter = new SubagentAuditAdapter({
      auditPath,
      onEvent: (event) => runStore.applyAuditEvent(event).then(() => undefined),
    });
    const [submitted] = await runStore.listRuns(target.workspaceId);
    if (!submitted?.workflowRunId) throw new Error("Expected a workflow run ID.");

    await appendAudit(auditPath, {
      ts: "2026-07-20T00:00:01.000Z",
      event: "subagent_spawn_requested",
      toolCallId: "agent-tool-call",
      type: "scout",
      description: "Map the repo",
      cwd: "/tmp/workspace-1",
      promptExcerpt: `workflow_run_id: ${submitted.workflowRunId}\nInspect the repo`,
    });
    await appendAudit(auditPath, {
      ts: "2026-07-20T00:00:02.000Z",
      event: "subagent_session_create",
      agentId: "durable-agent-id",
      type: "scout",
      cwd: "/tmp/workspace-1",
    });
    await appendAudit(auditPath, {
      ts: "2026-07-20T00:00:03.000Z",
      event: "subagent_completed",
      id: "durable-agent-id",
      type: "scout",
      status: "completed",
      toolUses: 4,
      durationMs: 1200,
      resultExcerpt: "Mapped the repository.",
    });
    await adapter.scan();

    const [run] = await runStore.listRuns(target.workspaceId);
    expect(run?.status).toBe("running");
    expect(run?.childRuns).toMatchObject([{
      toolCallId: "agent-tool-call",
      auditAgentId: "durable-agent-id",
      role: "scout",
      status: "completed",
      toolUseCount: 4,
      elapsedMs: 1200,
      summary: "Mapped the repository.",
    }]);
    adapter.dispose();
    runStore.dispose();
  });
});

async function createSubmittedWorkflow() {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-subagent-runs-"));
  temporaryDirs.push(userDataDir);
  const runStore = new SubagentRunStore(userDataDir);
  const target = { workspaceId: "workspace-1", sessionId: "session-1" };
  const workflow = BUILTIN_SUBAGENT_WORKFLOWS[0];
  if (!workflow) throw new Error("Expected a built-in workflow fixture.");
  const store = {
    sessionFromState: () => ({ status: "idle" }),
    getWorkspacePath: () => "/tmp/workspace-1",
    submitComposerToSession: async () => ({ lastError: undefined }),
    cancelSessionRun: async () => undefined,
  } as unknown as DesktopAppStore;
  await runStore.runWorkflow(store, { workflowId: workflow.id, target }, workflow);
  return { runStore, store, target, workflow };
}

function subagentEvent(
  sessionRef: { readonly workspaceId: string; readonly sessionId: string },
  callId: string,
  role: string,
  status: Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>["status"],
  toolUseCount?: number,
): Extract<SessionDriverEvent, { type: "subagentRunUpdated" }> {
  return {
    type: "subagentRunUpdated",
    sessionRef,
    parentSession: sessionRef,
    timestamp: `2026-07-20T00:00:0${callId === "scout-call" ? "1" : "2"}.000Z`,
    subagentRunId: callId,
    toolCallId: callId,
    role,
    status,
    ...(toolUseCount !== undefined ? { toolUseCount } : {}),
    ...(status === "completed" ? { summary: `${callId} complete` } : {}),
  };
}

function runCompletedEvent(
  sessionRef: { readonly workspaceId: string; readonly sessionId: string },
  runId: string,
): Extract<SessionDriverEvent, { type: "runCompleted" }> {
  return {
    type: "runCompleted",
    sessionRef,
    timestamp: "2026-07-20T00:00:02.000Z",
    runId,
    snapshot: {
      ref: sessionRef,
      workspace: {
        workspaceId: sessionRef.workspaceId,
        path: "/tmp/workspace-1",
        displayName: "Workspace 1",
      },
      title: "Workflow target",
      status: "idle",
      updatedAt: "2026-07-20T00:00:02.000Z",
      preview: "Finished",
    },
  };
}

async function appendAudit(path: string, record: Record<string, unknown>): Promise<void> {
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}
