import { describe, expect, it } from "vitest";
import {
  DISPLAY_MODE_PROJECTION_MAX_BYTES,
  DISPLAY_MODE_PROJECTION_MAX_ROWS,
  buildDisplayModeThreadProjection,
} from "../../src/display-mode-projection";
import type { TranscriptMessage } from "../../src/timeline-types";

describe("Display Mode projection", () => {
  it("keeps only the newest bounded rows", () => {
    const transcript = Array.from({ length: 30 }, (_, index) => message(`message-${index}`, `row ${index}`));
    const projection = buildDisplayModeThreadProjection({
      workspaceId: "workspace",
      sessionId: "session",
      revision: 1,
      sourceUpdatedAt: "2026-07-27T00:00:00.000Z",
      transcript,
      showThinking: true,
    });

    expect(projection.excerptRows).toHaveLength(DISPLAY_MODE_PROJECTION_MAX_ROWS);
    expect(projection.excerptRows.at(-1)).toMatchObject({ id: "message-29", text: "row 29" });
    expect(projection.excerptRows[0]).toMatchObject({ id: "message-22" });
    expect(projection.truncated).toBe(true);
    expect(projection.serializedBytes).toBeLessThanOrEqual(DISPLAY_MODE_PROJECTION_MAX_BYTES);
  });

  it("clips oversized message and tool payloads without retaining tool input or output objects", () => {
    const huge = "x".repeat(500_000);
    const transcript: TranscriptMessage[] = [
      message("message", `http://localhost:4173/demo ${huge}`),
      {
        kind: "tool",
        id: "tool",
        callId: "tool",
        toolName: "read",
        status: "success",
        label: "Read giant result",
        detail: huge,
        input: { secretLargeInput: huge },
        output: { huge },
        outputText: huge,
        createdAt: "2026-07-27T00:00:01.000Z",
      },
    ];
    const projection = buildDisplayModeThreadProjection({
      workspaceId: "workspace",
      sessionId: "session",
      revision: 2,
      sourceUpdatedAt: "2026-07-27T00:00:00.000Z",
      transcript,
      showThinking: true,
    });

    expect(projection.serializedBytes).toBeLessThanOrEqual(DISPLAY_MODE_PROJECTION_MAX_BYTES);
    expect(projection.truncated).toBe(true);
    expect(projection.previewUrls).toContain("http://localhost:4173/demo");
    const tool = projection.excerptRows.find((row) => row.kind === "tool");
    expect(tool).toMatchObject({ kind: "tool", toolName: "read" });
    expect(tool).not.toHaveProperty("input");
    expect(tool).not.toHaveProperty("output");
  });

  it("omits thinking rows when disabled and strips attachment data payloads", () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: "thinking",
        id: "thinking",
        text: "private reasoning",
        createdAt: "2026-07-27T00:00:00.000Z",
      },
      {
        ...message("attachment", "see image"),
        attachments: [{
          id: "image",
          kind: "image",
          name: "image.png",
          mimeType: "image/png",
          data: "base64-payload-that-must-not-be-projected",
        }],
      },
    ];
    const projection = buildDisplayModeThreadProjection({
      workspaceId: "workspace",
      sessionId: "session",
      revision: 3,
      sourceUpdatedAt: "2026-07-27T00:00:00.000Z",
      transcript,
      showThinking: false,
    });

    expect(projection.excerptRows.some((row) => row.kind === "thinking")).toBe(false);
    expect(JSON.stringify(projection)).not.toContain("base64-payload-that-must-not-be-projected");
  });
});

function message(id: string, text: string): Extract<TranscriptMessage, { kind: "message" }> {
  return {
    kind: "message",
    id,
    role: "assistant",
    text,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}
