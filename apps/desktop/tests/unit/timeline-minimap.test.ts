import { describe, expect, it } from "vitest";
import type { AttentionMarker } from "../../src/attention-markers";
import { compressTimelineRows } from "../../src/semantic-timeline-compression";
import { buildTimelineMinimap } from "../../src/timeline-minimap";
import type { TranscriptMessage } from "../../src/timeline-types";

describe("timeline minimap", () => {
  it("hides for short threads and caps huge timelines to aggregated bins", () => {
    const short = Array.from({ length: 99 }, (_, index) => activity(`short-${index}`, index));
    expect(buildTimelineMinimap(short, short, [])).toEqual([]);

    const huge = Array.from({ length: 10_000 }, (_, index) =>
      index % 40 === 0 ? user(`user-${index}`, index) : activity(`row-${index}`, index)
    );
    const segments = buildTimelineMinimap(huge, huge, [], 32);
    expect(segments.length).toBeLessThanOrEqual(32);
    expect(segments.some((segment) => segment.count > 1)).toBe(true);
    expect(segments.every((segment) => segment.types.includes("user"))).toBe(true);
  });

  it("encodes required signal types and targets stable compressed row IDs", () => {
    const transcript: TranscriptMessage[] = Array.from({ length: 120 }, (_, index) => readTool(`read-${index}`, index));
    transcript[0] = user("user-0", 0);
    transcript[20] = { ...readTool("agent-20", 20), toolName: "Agent", label: "Reviewer completed" };
    const displayRows = compressTimelineRows(transcript, "compact");
    const compressed = displayRows.find((row) => row.kind === "semantic-group");
    if (!compressed) throw new Error("Expected compressed display rows.");
    const markers: AttentionMarker[] = [
      marker("failure", compressed.id, "failure"),
      marker("approval", "agent-20", "approval"),
      marker("decision", "read-80", "decision"),
      marker("milestone", "read-90", "milestone"),
      marker("completion", "read-119", "completion"),
    ];
    const segments = buildTimelineMinimap(transcript, displayRows, markers);
    const types = new Set(segments.flatMap((segment) => segment.types));
    expect(types).toEqual(new Set(["user", "subagent", "failure", "approval", "decision", "milestone", "completion"]));
    expect(segments.find((segment) => segment.types.includes("failure"))?.rowId).toBe(compressed.id);
    expect(segments.every((segment) => displayRows.some((row) => row.id === segment.rowId))).toBe(true);
  });
});

function timestamp(index: number): string {
  return new Date(Date.UTC(2026, 6, 24, 0, 0, 0, index)).toISOString();
}

function activity(id: string, index: number): Extract<TranscriptMessage, { kind: "activity" }> {
  return { kind: "activity", id, label: "Working", createdAt: timestamp(index) };
}

function user(id: string, index: number): Extract<TranscriptMessage, { kind: "message" }> {
  return { kind: "message", id, role: "user", text: id, createdAt: timestamp(index) };
}

function readTool(id: string, index: number): Extract<TranscriptMessage, { kind: "tool" }> {
  return {
    kind: "tool",
    id,
    callId: id,
    toolName: "read",
    status: "success",
    label: `Read ${id}`,
    createdAt: timestamp(index),
    updatedAt: timestamp(index),
  };
}

function marker(id: string, rowId: string, type: AttentionMarker["type"]): AttentionMarker {
  return { id, rowId, type, label: id, timestamp: timestamp(1) };
}
