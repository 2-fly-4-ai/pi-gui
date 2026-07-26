import { describe, expect, it } from "vitest";
import { compressTimelineRows } from "../../src/semantic-timeline-compression";
import type { TranscriptMessage } from "../../src/timeline-types";

describe("semantic timeline compression", () => {
  it("groups repetitive correlated reads with a stable first-row ID and keeps raw rows", () => {
    const initial = [
      tool("read-1", "read", "Read README", 0),
      tool("read-2", "read", "Read package", 1_000),
      tool("read-3", "read", "Read source", 2_000),
    ];
    const [group] = compressTimelineRows(initial, "compact");
    expect(group).toMatchObject({
      kind: "semantic-group",
      id: "semantic-group:read-1",
      groupKind: "read",
      count: 3,
      summary: "Read 3 items",
      durationMs: 2_000,
    });
    if (group?.kind !== "semantic-group") throw new Error("Expected a semantic group.");
    expect(group.items.map((item) => item.id)).toEqual(["read-1", "read-2", "read-3"]);
    expect(group.exceptions).toEqual(["Read package", "Read source"]);

    const [grown] = compressTimelineRows([...initial, tool("read-4", "read", "Read tests", 3_000)], "compact");
    expect(grown?.id).toBe(group.id);
  });

  it("never merges across user messages, failures, different correlation, agents, or the time window", () => {
    const rows: TranscriptMessage[] = [
      tool("search-1", "grep", "Search one", 0, "child-a"),
      tool("search-2", "grep", "Search two", 1_000, "child-a"),
      message("user-boundary", "Continue", 2_000),
      tool("search-3", "grep", "Search three", 3_000, "child-a"),
      tool("search-failed", "grep", "Search failed", 4_000, "child-a", "error"),
      tool("search-4", "grep", "Search four", 5_000, "child-a"),
      tool("search-5", "grep", "Search five", 6_000, "child-b"),
      tool("agent", "Agent", "Reviewer", 7_000, "child-b"),
      tool("late-1", "read", "Read late one", 8_000),
      tool("late-2", "read", "Read late two", 60_000),
    ];

    const compressed = compressTimelineRows(rows, "compact");
    const groups = compressed.filter((row) => row.kind === "semantic-group");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["search-1", "search-2"]);
  });

  it("keeps fully expanded mode raw and automatic mode calm only for long transcripts", () => {
    const short = [tool("a", "read", "Read A", 0), tool("b", "read", "Read B", 1), tool("c", "read", "Read C", 2)];
    expect(compressTimelineRows(short, "automatic")).toBe(short);
    expect(compressTimelineRows(short, "expanded")).toBe(short);

    const long = Array.from({ length: 30 }, (_, index) => tool(`read-${index}`, "read", `Read ${index}`, index));
    expect(compressTimelineRows(long, "automatic")).toHaveLength(1);
  });

  it("compresses a 10k-row transcript into bounded display rows within the performance budget", () => {
    const transcript = Array.from({ length: 10_000 }, (_, index) =>
      tool(`read-${index}`, "read", `Read file ${index}`, index)
    );
    const startedAt = performance.now();
    const compressed = compressTimelineRows(transcript, "automatic");
    const elapsedMs = performance.now() - startedAt;

    expect(compressed).toHaveLength(1);
    expect(compressed[0]).toMatchObject({ kind: "semantic-group", count: 10_000 });
    expect(elapsedMs).toBeLessThan(500);
  });
});

function tool(
  id: string,
  toolName: string,
  label: string,
  offsetMs: number,
  metadata = "parent",
  status: "success" | "error" = "success",
): Extract<TranscriptMessage, { kind: "tool" }> {
  const createdAt = new Date(Date.UTC(2026, 6, 24, 0, 0, 0, offsetMs)).toISOString();
  return {
    kind: "tool",
    id,
    callId: id,
    toolName,
    status,
    label,
    metadata,
    createdAt,
    updatedAt: createdAt,
  };
}

function message(id: string, text: string, offsetMs: number): Extract<TranscriptMessage, { kind: "message" }> {
  return {
    kind: "message",
    id,
    role: "user",
    text,
    createdAt: new Date(Date.UTC(2026, 6, 24, 0, 0, 0, offsetMs)).toISOString(),
  };
}
