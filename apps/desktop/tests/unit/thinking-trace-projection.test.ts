import { describe, expect, it } from "vitest";
import { projectLatestThinkingPerRun } from "../../src/thinking-trace-projection";
import type { TranscriptMessage } from "../../src/timeline-types";

describe("thinking trace projection", () => {
  it("shows only the latest reasoning card within one user run", () => {
    const transcript: TranscriptMessage[] = [
      message("user-1", "user", "Inspect the folder"),
      thinking("thinking-1", "Plan the inspection"),
      tool("tool-1"),
      thinking("thinking-2", "Summarize the results"),
      tool("tool-2"),
      thinking("thinking-3", "Prepare the answer", "running"),
    ];

    const projected = projectLatestThinkingPerRun(transcript);

    expect(projected.filter((item) => item.kind === "thinking")).toEqual([
      expect.objectContaining({ id: "thinking-3", text: "Prepare the answer", status: "running" }),
    ]);
    expect(projected.filter((item) => item.kind === "tool")).toHaveLength(2);
  });

  it("preserves one reasoning card for each distinct user run", () => {
    const transcript: TranscriptMessage[] = [
      message("user-1", "user", "First request"),
      thinking("thinking-1", "First plan"),
      thinking("thinking-2", "First final plan"),
      summary("summary-1"),
      message("user-2", "user", "Second request"),
      thinking("thinking-3", "Second plan"),
      message("assistant-1", "assistant", "Done"),
    ];

    expect(
      projectLatestThinkingPerRun(transcript)
        .filter((item) => item.kind === "thinking")
        .map((item) => item.id),
    ).toEqual(["thinking-2", "thinking-3"]);
  });

  it("preserves the original array when no thinking card is superseded", () => {
    const transcript: TranscriptMessage[] = [
      message("user-1", "user", "Inspect"),
      thinking("thinking-1", "Plan"),
      tool("tool-1"),
    ];

    expect(projectLatestThinkingPerRun(transcript)).toBe(transcript);
  });
});

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
): Extract<TranscriptMessage, { kind: "message" }> {
  return {
    kind: "message",
    id,
    role,
    text,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

function thinking(
  id: string,
  text: string,
  status: "running" | "done" = "done",
): Extract<TranscriptMessage, { kind: "thinking" }> {
  return {
    kind: "thinking",
    id,
    text,
    status,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

function tool(id: string): Extract<TranscriptMessage, { kind: "tool" }> {
  return {
    kind: "tool",
    id,
    callId: id,
    toolName: "bash",
    status: "success",
    label: "Ran command",
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

function summary(id: string): Extract<TranscriptMessage, { kind: "summary" }> {
  return {
    kind: "summary",
    id,
    label: "Completed",
    presentation: "divider",
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}
