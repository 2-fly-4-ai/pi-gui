import { describe, expect, it } from "vitest";
import type { ReviewFileSnapshot } from "../../src/review/review-types";
import {
  assertReviewSnapshotBudget,
  MAX_REVIEW_SNAPSHOT_BYTES,
  MAX_REVIEW_SNAPSHOT_FILES,
} from "../../electron/review/review-snapshot";

function file(index: number, diff = "+ok"): ReviewFileSnapshot {
  return {
    path: `src/file-${index}.ts`,
    status: "modified",
    diff,
    anchors: [],
  };
}

describe("review snapshot budgets", () => {
  it("accepts a normal snapshot and rejects excessive files or aggregate bytes", () => {
    expect(() => assertReviewSnapshotBudget([file(1), file(2)])).not.toThrow();
    expect(() => assertReviewSnapshotBudget(
      Array.from({ length: MAX_REVIEW_SNAPSHOT_FILES + 1 }, (_, index) => file(index)),
    )).toThrow("changed files");
    expect(() => assertReviewSnapshotBudget([
      file(1, "x".repeat(MAX_REVIEW_SNAPSHOT_BYTES + 1)),
    ])).toThrow("32 MB or smaller");
  });
});
