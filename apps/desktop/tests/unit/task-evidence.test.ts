import { describe, expect, it } from "vitest";
import {
  TASK_EVIDENCE_SCHEMA_VERSION,
  canSupportTrustedVerification,
  compactTaskEvidence,
  deriveVerificationConfidence,
  taskEvidenceAuthorityRank,
  type TaskEvidenceRecord,
} from "../../src/product-experience/task-evidence";

function evidence(
  id: string,
  overrides: Partial<TaskEvidenceRecord> = {},
): TaskEvidenceRecord {
  return {
    schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
    id,
    sessionId: "session-1",
    workspaceId: "workspace-1",
    runId: "run-1",
    timestamp: `2026-07-24T00:00:0${id.length}.000Z`,
    kind: "activity",
    source: "runtime",
    authority: "runtime-observed",
    summary: id,
    ...overrides,
  };
}

describe("task evidence authority", () => {
  it("ranks observed sources above declarations and assistant narrative", () => {
    expect(taskEvidenceAuthorityRank("tool-observed")).toBeGreaterThan(
      taskEvidenceAuthorityRank("runtime-observed"),
    );
    expect(taskEvidenceAuthorityRank("desktop-observed")).toBeGreaterThan(
      taskEvidenceAuthorityRank("user-declared"),
    );
    expect(taskEvidenceAuthorityRank("user-declared")).toBeGreaterThan(
      taskEvidenceAuthorityRank("assistant-narrative"),
    );
  });

  it("never treats assistant or user claims as trusted verification", () => {
    const details = { scope: "electron-core" as const, command: "pnpm test" };
    expect(canSupportTrustedVerification(evidence("assistant", {
      kind: "verification",
      source: "assistant",
      authority: "assistant-narrative",
      status: "passed",
      verification: details,
    }))).toBe(false);
    expect(canSupportTrustedVerification(evidence("user", {
      kind: "verification",
      source: "user",
      authority: "user-declared",
      status: "passed",
      verification: details,
    }))).toBe(false);
    expect(canSupportTrustedVerification(evidence("desktop", {
      kind: "verification",
      source: "desktop",
      authority: "desktop-observed",
      status: "passed",
      verification: details,
    }))).toBe(true);
  });
});

describe("compactTaskEvidence", () => {
  it("groups repetitive low-value activity while retaining every evidence id", () => {
    const records = [
      evidence("a", { timestamp: "2026-07-24T00:00:00.000Z" }),
      evidence("b", { timestamp: "2026-07-24T00:00:01.000Z" }),
      evidence("c", {
        timestamp: "2026-07-24T00:00:02.000Z",
        kind: "approval",
        source: "user",
        authority: "user-declared",
      }),
      evidence("d", { timestamp: "2026-07-24T00:00:03.000Z" }),
    ];

    const groups = compactTaskEvidence(records);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ kind: "activity", count: 2, evidenceIds: ["a", "b"] });
    expect(groups[1]).toMatchObject({ kind: "approval", count: 1 });
    expect(groups[2]).toMatchObject({ kind: "activity", count: 1 });
  });

  it("does not merge activity across runs or subagents", () => {
    const groups = compactTaskEvidence([
      evidence("a", {
        timestamp: "2026-07-24T00:00:00.000Z",
        correlation: { subagentRunId: "child-1" },
      }),
      evidence("b", {
        timestamp: "2026-07-24T00:00:01.000Z",
        correlation: { subagentRunId: "child-2" },
      }),
      evidence("c", {
        runId: "run-2",
        timestamp: "2026-07-24T00:00:02.000Z",
        correlation: { subagentRunId: "child-2" },
      }),
    ]);

    expect(groups).toHaveLength(3);
  });
});

describe("deriveVerificationConfidence", () => {
  it("reports passed, failed, and blocked scopes from trusted evidence only", () => {
    const confidence = deriveVerificationConfidence([
      evidence("unit", {
        kind: "test",
        source: "tool",
        authority: "tool-observed",
        status: "passed",
        verification: { scope: "unit" },
      }),
      evidence("core", {
        kind: "verification",
        source: "desktop",
        authority: "desktop-observed",
        status: "passed",
        verification: { scope: "electron-core" },
      }),
      evidence("live", {
        kind: "verification",
        source: "runtime",
        authority: "runtime-observed",
        status: "blocked",
        verification: { scope: "electron-live" },
      }),
      evidence("native", {
        kind: "verification",
        source: "tool",
        authority: "tool-observed",
        status: "failed",
        verification: { scope: "native" },
      }),
      evidence("claim", {
        kind: "verification",
        source: "assistant",
        authority: "assistant-narrative",
        status: "passed",
        verification: { scope: "packaged" },
      }),
    ]);

    expect(confidence).toEqual({
      highestPassedScope: "electron-core",
      passedScopes: ["unit", "electron-core"],
      failedScopes: ["native"],
      blockedScopes: ["electron-live"],
      evidenceIds: ["unit", "core", "live", "native"],
    });
  });
});
