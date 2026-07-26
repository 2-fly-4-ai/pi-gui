import { describe, expect, it } from "vitest";
import {
  applyHunkRejections,
  buildHunkRestorePreview,
  computePiAttributedHunks,
} from "../../src/product-experience/hunk-restoration";

const before = [
  "one\n",
  "two\n",
  "three\n",
  "four\n",
  "five\n",
  "six\n",
  "seven\n",
  "eight\n",
].join("");

const piAfter = [
  "one\n",
  "two\n",
  "THREE BY PI\n",
  "four\n",
  "five\n",
  "six\n",
  "SEVEN BY PI\n",
  "eight\n",
].join("");

describe("hunk restoration substrate", () => {
  it("computes separate Pi-attributed hunks with stable line coordinates", () => {
    const hunks = computePiAttributedHunks(before, piAfter);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      beforeStart: 2,
      afterStart: 2,
      beforeLines: ["three\n"],
      afterLines: ["THREE BY PI\n"],
    });
    expect(hunks[1]).toMatchObject({
      beforeStart: 6,
      afterStart: 6,
      beforeLines: ["seven\n"],
      afterLines: ["SEVEN BY PI\n"],
    });
  });

  it("keeps non-overlapping later edits and rejects only a selected safe hunk", () => {
    const current = `${piAfter}user-added-tail\n`;
    const preview = buildHunkRestorePreview(before, piAfter, current);
    expect(preview.safeCount).toBe(2);
    const second = preview.hunks[1];
    expect(second?.status).toBe("safe");
    const restored = applyHunkRejections(current, preview, second ? [second.id] : []);
    expect(restored).toContain("THREE BY PI\n");
    expect(restored).toContain("seven\n");
    expect(restored).not.toContain("SEVEN BY PI\n");
    expect(restored).toContain("user-added-tail\n");
  });

  it("marks only an overlapping later edit conflicted", () => {
    const current = piAfter.replace("THREE BY PI\n", "THREE BY USER\n");
    const preview = buildHunkRestorePreview(before, piAfter, current);
    expect(preview.hunks[0]).toMatchObject({
      status: "conflict",
      reason: "Later edits overlap this hunk or its surrounding context.",
    });
    expect(preview.hunks[1]?.status).toBe("safe");
    expect(() => applyHunkRejections(
      current,
      preview,
      preview.hunks[0] ? [preview.hunks[0].id] : [],
    )).toThrow("unavailable for one-click rejection");
  });

  it("recognizes already-restored hunks and preserves CRLF line endings", () => {
    const crlfBefore = "alpha\r\nbeta\r\ngamma\r\n";
    const crlfAfter = "alpha\r\nBETA\r\ngamma\r\n";
    const preview = buildHunkRestorePreview(crlfBefore, crlfAfter, crlfBefore);
    expect(preview.alreadyRestoredCount).toBe(1);
    expect(preview.hunks[0]?.status).toBe("already-restored");
  });

  it("supports pure insertion and deletion rejection", () => {
    const insertionPreview = buildHunkRestorePreview(
      "a\nb\n",
      "a\ninserted\nb\n",
      "a\ninserted\nb\n",
    );
    const insertion = insertionPreview.hunks[0];
    expect(applyHunkRejections(
      "a\ninserted\nb\n",
      insertionPreview,
      insertion ? [insertion.id] : [],
    )).toBe("a\nb\n");

    const deletionPreview = buildHunkRestorePreview("a\nremoved\nb\n", "a\nb\n", "a\nb\n");
    const deletion = deletionPreview.hunks[0];
    expect(applyHunkRejections(
      "a\nb\n",
      deletionPreview,
      deletion ? [deletion.id] : [],
    )).toBe("a\nremoved\nb\n");
  });
});
