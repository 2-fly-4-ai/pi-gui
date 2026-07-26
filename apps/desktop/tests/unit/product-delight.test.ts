import { describe, expect, it } from "vitest";
import type { TaskEvidenceRecord } from "../../src/product-experience/task-evidence";
import {
  canAnimateProductDelight,
  deriveProductPersonalityState,
  isEvidenceBackedTerminalSuccess,
} from "../../src/product-experience/product-delight";

const evidence = (patch: Partial<TaskEvidenceRecord>): TaskEvidenceRecord => ({
  schemaVersion: 1,
  id: "record",
  workspaceId: "workspace",
  sessionId: "session",
  timestamp: "2026-07-25T00:00:00.000Z",
  kind: "activity",
  source: "runtime",
  authority: "runtime-observed",
  summary: "Observed",
  ...patch,
});

describe("product delight", () => {
  it("maps empty, working, waiting, subagent, success, and failure states", () => {
    expect(deriveProductPersonalityState([], "idle").state).toBe("empty");
    expect(deriveProductPersonalityState([], "running").state).toBe("working");
    expect(deriveProductPersonalityState([evidence({
      status: "pending",
      activity: { type: "waiting-approval" },
    })], "running").state).toBe("waiting");
    expect(deriveProductPersonalityState([evidence({
      source: "subagent",
      status: "running",
    })], "running").state).toBe("subagent");
    expect(deriveProductPersonalityState([evidence({
      kind: "completion",
      status: "passed",
      completion: { outcome: "completed" },
    })], "idle").state).toBe("success");
    expect(deriveProductPersonalityState([evidence({
      kind: "completion",
      status: "failed",
      completion: { outcome: "failed" },
    })], "idle").state).toBe("failure");
  });

  it("requires observed completion and green required verification", () => {
    const verification = evidence({
      id: "test",
      kind: "test",
      status: "passed",
      source: "tool",
      authority: "tool-observed",
      verification: { scope: "unit", exitCode: 0 },
    });
    const completion = evidence({
      id: "completion",
      kind: "completion",
      status: "passed",
      completion: { outcome: "completed", verificationEvidenceIds: ["test"] },
    });
    expect(isEvidenceBackedTerminalSuccess([completion, verification], completion)).toBe(true);
    expect(isEvidenceBackedTerminalSuccess([
      completion,
      { ...verification, status: "failed" },
    ], completion)).toBe(false);
    expect(isEvidenceBackedTerminalSuccess([
      { ...completion, authority: "assistant-narrative" },
      verification,
    ])).toBe(false);
    expect(isEvidenceBackedTerminalSuccess([
      {
        ...completion,
        completion: {
          ...completion.completion!,
          blockerEvidenceIds: ["blocker"],
        },
      },
      verification,
      evidence({
        id: "blocker",
        kind: "error",
        status: "blocked",
      }),
    ])).toBe(false);
  });

  it("suppresses delight animation when reduced motion is requested", () => {
    const reducedMotionDocument = {
      defaultView: {
        matchMedia: (query: string) => ({
          matches: query === "(prefers-reduced-motion: reduce)",
        }),
      },
    } as unknown as Document;

    expect(canAnimateProductDelight(reducedMotionDocument)).toBe(false);
  });
});
