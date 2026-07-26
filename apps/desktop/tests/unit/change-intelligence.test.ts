import { describe, expect, it } from "vitest";
import type { ReviewFileSnapshot } from "../../src/review/review-types";
import type { TaskEvidenceRecord } from "../../src/product-experience/task-evidence";
import { buildChangeReviewGroups } from "../../src/product-experience/change-intelligence";

const files: readonly ReviewFileSnapshot[] = [
  { path: "src/app.ts", status: "modified", diff: "", anchors: [] },
  { path: "user.txt", status: "modified", diff: "", anchors: [] },
];
const base = {
  schemaVersion: 1,
  workspaceId: "w",
  sessionId: "s",
  timestamp: "2026-07-24T00:00:00.000Z",
  source: "tool",
  authority: "tool-observed",
  summary: "observed",
} as const;

describe("change intelligence", () => {
  it("uses latest structured attribution and never guesses unknown ownership", () => {
    const evidence: TaskEvidenceRecord[] = [
      {
        ...base,
        id: "old",
        runId: "r1",
        kind: "file-write",
        fileChange: { path: "src/app.ts", operation: "modify", ownership: "pi", intent: "Feature" },
      },
      {
        ...base,
        id: "new",
        runId: "r2",
        timestamp: "2026-07-24T00:01:00.000Z",
        kind: "file-write",
        fileChange: { path: "src/app.ts", operation: "modify", ownership: "user", intent: "User follow-up" },
      },
    ];
    const groups = buildChangeReviewGroups(files, evidence);
    expect(groups.find((group) => group.intent === "User follow-up")?.files[0]).toMatchObject({
      attribution: "user",
      runId: "r2",
    });
    expect(groups.find((group) => group.intent === "Unknown / external changes")?.files[0]?.attribution).toBe("unknown");
  });

  it("distinguishes explicit test links from unrelated passed tests", () => {
    const evidence: TaskEvidenceRecord[] = [{
      ...base,
      id: "test",
      kind: "test",
      status: "passed",
      verification: {
        scope: "unit",
        command: "vitest",
        relatedPaths: ["src/app.ts"],
      },
    }];
    const groups = buildChangeReviewGroups(files, evidence);
    const mapped = groups.flatMap((group) => group.files);
    expect(mapped.find((file) => file.file.path === "src/app.ts")?.verification).toBe("verified");
    expect(mapped.find((file) => file.file.path === "user.txt")?.verification).toBe("unrelated");
  });

  it.each([
    ["failed", "failed"],
    ["skipped", "scope-unknown"],
  ] as const)("derives %s explicit verification evidence", (status, expected) => {
    const evidence: TaskEvidenceRecord[] = [{
      ...base,
      id: `test-${status}`,
      kind: "test",
      status,
      verification: {
        scope: "unit",
        command: "vitest src/app.ts",
        relatedPaths: ["src/app.ts"],
      },
    }];
    const mapped = buildChangeReviewGroups(files.slice(0, 1), evidence).flatMap((group) => group.files);
    expect(mapped[0]?.verification).toBe(expected);
  });

  it("keeps unknown test scope distinct from no test run", () => {
    const scopedUnknown: TaskEvidenceRecord[] = [{
      ...base,
      id: "unknown",
      kind: "test",
      verification: {
        scope: "unit",
        command: "vitest",
      },
    }];
    expect(buildChangeReviewGroups(files.slice(0, 1), [])[0]?.verification).toBe("not-run");
    expect(buildChangeReviewGroups(files.slice(0, 1), scopedUnknown)[0]?.verification).toBe("scope-unknown");
  });

  it("recalculates coverage from the latest equally authoritative test result", () => {
    const testEvidence = (id: string, status: "failed" | "passed", timestamp: string): TaskEvidenceRecord => ({
      ...base,
      id,
      timestamp,
      kind: "test",
      status,
      verification: {
        scope: "unit",
        command: "vitest src/app.ts",
        relatedPaths: ["src/app.ts"],
      },
    });
    const groups = buildChangeReviewGroups(files.slice(0, 1), [
      testEvidence("failed-first", "failed", "2026-07-24T00:00:00.000Z"),
      testEvidence("passed-later", "passed", "2026-07-24T00:01:00.000Z"),
    ]);
    expect(groups[0]?.verification).toBe("verified");
  });
});
