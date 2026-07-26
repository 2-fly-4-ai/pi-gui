import { describe, expect, it } from "vitest";
import {
  TASK_EVIDENCE_SCHEMA_VERSION,
  type TaskEvidenceRecord,
} from "../../src/product-experience/task-evidence";
import { deriveTaskEvidencePresentation } from "../../src/features/evidence/task-evidence-presentation";

function evidence(id: string, overrides: Partial<TaskEvidenceRecord>): TaskEvidenceRecord {
  return {
    schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
    id,
    workspaceId: "workspace-1",
    sessionId: "session-1",
    runId: "run-1",
    timestamp: `2026-07-24T12:00:0${id.length}.000Z`,
    kind: "activity",
    source: "runtime",
    authority: "runtime-observed",
    summary: id,
    ...overrides,
  };
}

describe("deriveTaskEvidencePresentation", () => {
  it("uses the latest correlated state and never leaves completed tools looking active", () => {
    const presentation = deriveTaskEvidencePresentation([
      evidence("finished", {
        timestamp: "2026-07-24T12:00:02.000Z",
        kind: "test",
        source: "tool",
        authority: "tool-observed",
        status: "passed",
        correlation: { toolCallId: "tool-1" },
        verification: { scope: "package" },
      }),
      evidence("started", {
        timestamp: "2026-07-24T12:00:01.000Z",
        kind: "test",
        source: "tool",
        authority: "tool-observed",
        status: "running",
        correlation: { toolCallId: "tool-1" },
        verification: { scope: "package" },
      }),
    ], "running");

    expect(presentation.activity).toMatchObject({ label: "Working" });
    expect(presentation.confidence.passedScopes).toEqual(["package"]);
  });

  it("summarizes observed completion, health, changes, children, and failed verification", () => {
    const presentation = deriveTaskEvidencePresentation([
      evidence("completion", {
        kind: "completion",
        status: "failed",
        completion: {
          outcome: "partial",
          changedPaths: ["src/a.ts", "src/b.ts"],
          childRunIds: ["child-1"],
        },
      }),
      evidence("failure", {
        kind: "test",
        source: "tool",
        authority: "tool-observed",
        status: "failed",
        verification: { scope: "electron-core" },
        correlation: { subagentRunId: "child-1" },
      }),
    ], "failed");

    expect(presentation.completion?.completion?.outcome).toBe("partial");
    expect(presentation.changedPathCount).toBe(2);
    expect(presentation.childRunCount).toBe(1);
    expect(presentation.failedCount).toBe(1);
    expect(presentation.confidence.failedScopes).toEqual(["electron-core"]);
  });

  it.each([
    ["reading", "Reading files", "working"],
    ["editing", "Editing files", "working"],
    ["running-command", "Running command", "working"],
    ["running-tests", "Running tests", "working"],
    ["waiting-approval", "Waiting for approval", "waiting"],
    ["waiting-provider", "Waiting for provider", "waiting"],
    ["waiting-subagent", "Waiting for subagent", "waiting"],
    ["retrying", "Retrying", "working"],
    ["blocked", "Blocked", "blocked"],
  ] as const)("presents %s activity as %s", (type, label, tone) => {
    const presentation = deriveTaskEvidencePresentation([
      evidence("activity", {
        status: type === "blocked" ? "blocked" : "running",
        activity: { type },
        correlation: { toolCallId: "tool-1" },
      }),
    ], "running");

    expect(presentation.activity).toMatchObject({
      label,
      tone,
      toolCallId: "tool-1",
    });
  });
});
