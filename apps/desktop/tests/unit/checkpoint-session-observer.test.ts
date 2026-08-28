import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckpointSessionObserver } from "../../electron/checkpoint-session-observer";
import { CheckpointStore } from "../../electron/checkpoint-store";
import { TaskEvidenceLedger } from "../../electron/task-evidence-ledger";
import type { CheckpointWorkspaceIdentity } from "../../src/product-experience/checkpoint-contract";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-checkpoint-observer-"));
  const checkout = join(root, "workspace");
  const userData = join(root, "user-data");
  await mkdir(join(checkout, "src"), { recursive: true });
  temporaryDirectories.push(root);
  const workspace: CheckpointWorkspaceIdentity = {
    workspaceId: "workspace-1",
    rootPath: checkout,
    checkoutPath: checkout,
  };
  let checkpointId = 0;
  let evidenceId = 0;
  const checkpoints = new CheckpointStore(userData, {
    createId: () => `checkpoint-${++checkpointId}`,
  });
  const evidence = new TaskEvidenceLedger(userData, {
    now: () => new Date("2026-07-24T12:05:00.000Z"),
    workspacePath: () => checkout,
  });
  const observer = new CheckpointSessionObserver(
    checkpoints,
    evidence,
    () => workspace,
    () => `evidence-${++evidenceId}`,
  );
  return { checkpoints, checkout, evidence, observer, workspace };
}

const sessionRef = { workspaceId: "workspace-1", sessionId: "session-1" };

describe("CheckpointSessionObserver", () => {
  it("captures before the first write, finalizes the post-write hash, and avoids duplicate snapshots", async () => {
    const { checkpoints, checkout, evidence, observer, workspace } = await setup();
    await writeFile(join(checkout, "src/app.ts"), "before\n");
    await observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:00.000Z",
      toolName: "edit",
      callId: "write-1",
      input: { file_path: join(checkout, "src/app.ts") },
    });
    await writeFile(join(checkout, "src/app.ts"), "after\n");
    await observer.observe({
      type: "toolFinished",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:01.000Z",
      callId: "write-1",
      success: true,
    });
    await observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:02.000Z",
      toolName: "edit",
      callId: "write-2",
      input: { file_path: "src/app.ts" },
    });

    const manifests = await checkpoints.list("workspace-1");
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.entries[0]).toMatchObject({
      path: "src/app.ts",
      before: { exists: true },
    });
    expect(manifests[0]?.entries[0]?.expectedAfterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifests[0]?.entries[0]?.expectedAfterBlobId).toMatch(/^[a-f0-9]{64}$/);
    expect((await checkpoints.preview(manifests[0]?.id ?? "", workspace)).entries[0]).toMatchObject({
      status: "safe",
      defaultSelected: true,
    });
    const records = await evidence.query({ workspaceId: "workspace-1", kinds: ["checkpoint"] });
    expect(records.records).toHaveLength(2);
    expect(records.records.map((record) => record.status)).toEqual(["passed", "passed"]);
    expect(records.records[0]?.correlation).toMatchObject({
      checkpointId: "checkpoint-1",
      toolCallId: "write-1",
    });
  });

  it("records honest degradation when a mutating tool omits or escapes its path", async () => {
    const { checkpoints, checkout, evidence, observer } = await setup();
    await observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:00.000Z",
      toolName: "apply_patch",
      callId: "write-1",
      input: {},
    });
    await observer.observe({
      type: "toolStarted",
      sessionRef,
      runId: "run-1",
      timestamp: "2026-07-24T12:00:01.000Z",
      toolName: "write",
      callId: "write-2",
      input: { path: join(checkout, "..", "outside.ts") },
    });

    expect(await checkpoints.list()).toEqual([]);
    const records = await evidence.query({ workspaceId: "workspace-1", kinds: ["checkpoint"] });
    expect(records.records.map((record) => record.status)).toEqual(["failed", "unknown"]);
    expect(records.records[0]?.summary).toContain("outside the active checkout");
    expect(records.records[1]?.summary).toContain("did not expose a path");
  });
});
