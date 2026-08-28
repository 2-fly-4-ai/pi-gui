import { describe, expect, it } from "vitest";
import { deriveAttentionMarkers } from "../../src/attention-markers";
import type { TaskEvidenceKind, TaskEvidenceRecord, TaskEvidenceStatus } from "../../src/product-experience/task-evidence";
import type { TranscriptMessage } from "../../src/timeline-types";

describe("attention markers", () => {
  it("derives every supported marker only from explicit user rows or structured evidence", () => {
    const transcript: TranscriptMessage[] = [
      message("user-1", "Start", 0),
      tool("tool-1", 1_000),
      { kind: "summary", id: "summary-1", label: "Worked for 1s", presentation: "divider", createdAt: timestamp(8_000) },
    ];
    const evidence = [
      record("approval-pending", "approval", "pending", 1_100, { toolCallId: "tool-1" }),
      record("approval-done", "approval", "passed", 1_200, { toolCallId: "tool-1" }),
      record("failure", "error", "failed", 2_000, { toolCallId: "tool-1" }),
      record("checkpoint", "checkpoint", "passed", 3_000, { toolCallId: "tool-1" }),
      record("decision", "decision", "passed", 4_000, { toolCallId: "tool-1" }),
      record("test", "test", "passed", 5_000, { toolCallId: "tool-1" }),
      record("completion", "completion", "passed", 6_000),
    ];

    const markers = deriveAttentionMarkers(transcript, evidence);
    expect(new Set(markers.map((marker) => marker.type))).toEqual(new Set([
      "direction-change",
      "input-required",
      "approval",
      "failure",
      "checkpoint",
      "decision",
      "milestone",
      "completion",
    ]));
    expect(markers.find((marker) => marker.id.includes("approval-pending"))?.rowId).toBe("tool-1");
    expect(markers.every((marker) => marker.id.startsWith("direction:") || marker.id.startsWith("milestone:") || marker.id.startsWith("evidence:"))).toBe(true);
  });

  it("keeps IDs and row anchors stable when the same durable evidence is rehydrated", () => {
    const transcript = [message("user-1", "Start", 0), tool("tool-1", 1_000)];
    const evidence = [record("failure-1", "error", "failed", 1_100, { toolCallId: "tool-1" })];
    expect(deriveAttentionMarkers(transcript, evidence)).toEqual(deriveAttentionMarkers([...transcript], [...evidence]));
  });

  it("never attaches uncorrelated milestone evidence to an ordinary chat message", () => {
    const transcript: TranscriptMessage[] = [
      message("user-1", "Start", 0),
      { kind: "summary", id: "summary-1", label: "Worked for 1s", presentation: "divider", createdAt: timestamp(1_000) },
      message("user-2", "Continue", 2_000),
    ];
    const evidence = [
      record("test", "test", "passed", 2_000),
      record("completion", "completion", "passed", 1_000),
    ];

    const markers = deriveAttentionMarkers(transcript, evidence);
    expect(markers.find((marker) => marker.evidenceId === "test")).toBeUndefined();
    expect(markers.find((marker) => marker.evidenceId === "completion")?.rowId).toBe("summary-1");
  });
});

function timestamp(offsetMs: number): string {
  return new Date(Date.UTC(2026, 6, 24, 0, 0, 0, offsetMs)).toISOString();
}

function message(id: string, text: string, offsetMs: number): Extract<TranscriptMessage, { kind: "message" }> {
  return { kind: "message", id, role: "user", text, createdAt: timestamp(offsetMs) };
}

function tool(id: string, offsetMs: number): Extract<TranscriptMessage, { kind: "tool" }> {
  return {
    kind: "tool",
    id,
    callId: id,
    toolName: "bash",
    status: "error",
    label: "Failed command",
    createdAt: timestamp(offsetMs),
    updatedAt: timestamp(offsetMs),
  };
}

function record(
  id: string,
  kind: TaskEvidenceKind,
  status: TaskEvidenceStatus,
  offsetMs: number,
  correlation?: TaskEvidenceRecord["correlation"],
): TaskEvidenceRecord {
  return {
    schemaVersion: 1,
    id,
    workspaceId: "workspace",
    sessionId: "session",
    timestamp: timestamp(offsetMs),
    kind,
    source: "desktop",
    authority: "desktop-observed",
    status,
    summary: id,
    ...(correlation ? { correlation } : {}),
  };
}
