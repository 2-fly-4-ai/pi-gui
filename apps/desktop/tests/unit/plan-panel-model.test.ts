import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../../src/desktop-state";
import { buildImplementPlanPrompt, detectLatestPlan, looksLikePlan } from "../../src/plan-panel-model";

const assistantMessage = (id: string, text: string): TranscriptMessage => ({
  kind: "message",
  id,
  role: "assistant",
  text,
  createdAt: "2026-07-08T00:00:00.000Z",
});

describe("looksLikePlan", () => {
  it("detects explicit plan headings and task-list plans", () => {
    expect(looksLikePlan("## Phase 4 Plan\n\n1. Inspect\n2. Implement")).toBe(true);
    expect(looksLikePlan("- [ ] Inspect state\n1. Patch reducer")).toBe(true);
  });

  it("ignores ordinary assistant prose", () => {
    expect(looksLikePlan("I checked the files and found no obvious issue.")).toBe(false);
  });
});

describe("detectLatestPlan", () => {
  it("returns the newest assistant plan and trims markdown", () => {
    const transcript: readonly TranscriptMessage[] = [
      assistantMessage("old", "## Old Plan\n\n1. Do old thing"),
      {
        kind: "message",
        id: "user-plan",
        role: "user",
        text: "## User Plan\n\n1. Not an assistant plan",
        createdAt: "2026-07-08T00:00:01.000Z",
      },
      assistantMessage("new", "\n# Renderer Decomposition Plan\n\n- [ ] Extract timeline\n1. Verify\n"),
    ];

    expect(detectLatestPlan(transcript)).toEqual({
      messageId: "new",
      title: "Renderer Decomposition Plan",
      markdown: "# Renderer Decomposition Plan\n\n- [ ] Extract timeline\n1. Verify",
    });
  });

  it("returns null when no assistant plan is present", () => {
    expect(detectLatestPlan([assistantMessage("plain", "No plan here.")])).toBeNull();
  });
});

describe("buildImplementPlanPrompt", () => {
  it("wraps the detected plan markdown in an implementation prompt", () => {
    expect(buildImplementPlanPrompt({
      messageId: "p1",
      title: "Plan",
      markdown: "## Plan\n\n1. Ship it",
    })).toBe("Please implement this plan:\n\n## Plan\n\n1. Ship it");
  });
});
