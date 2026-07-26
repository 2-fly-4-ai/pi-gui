import { describe, expect, it } from "vitest";
import type { SessionTreeSnapshot } from "@pi-gui/session-driver/types";
import {
  branchRecommendation,
  compareBranch,
  listComparableBranches,
} from "../../src/product-experience/branch-comparison";

const tree: SessionTreeSnapshot = {
  leafId: "right",
  roots: [{
    id: "root",
    parentId: null,
    kind: "message",
    role: "user",
    timestamp: "2026-07-24T00:00:00.000Z",
    title: "User",
    preview: "Start",
    children: [
      {
        id: "left",
        parentId: "root",
        kind: "message",
        role: "assistant",
        timestamp: "2026-07-24T00:00:05.000Z",
        title: "Assistant",
        preview: "Working result",
        children: [],
      },
      {
        id: "right",
        parentId: "root",
        kind: "message",
        role: "assistant",
        timestamp: "2026-07-24T00:00:08.000Z",
        title: "Assistant",
        preview: "Failed: blocked by API",
        children: [],
      },
    ],
  }],
};

describe("branch comparison", () => {
  it("lists durable leaves and keeps unsupported attribution honest", () => {
    expect(listComparableBranches(tree).map((branch) => branch.id)).toEqual(["left", "right"]);
    expect(compareBranch(tree, "left")).toMatchObject({
      duration: "5s",
      filesChanged: "Not attributed by the runtime",
      verification: "No branch-specific evidence recorded",
      blockers: "None observed",
    });
  });

  it("keeps narrative recommendation separate from observed metrics", () => {
    const left = compareBranch(tree, "left");
    const right = compareBranch(tree, "right");
    expect(left && right ? branchRecommendation(left, right) : "").toContain("Working result");
    expect(right?.blockers).toContain("Failed");
  });
});
