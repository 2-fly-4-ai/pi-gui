import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../../src/desktop-state";
import {
  RECOVERY_MESSAGE_IMAGE_BYTES,
  RECOVERY_TRANSCRIPT_MAX_BYTES,
  RECOVERY_TRANSCRIPT_MAX_ROWS,
  RENDERER_MESSAGE_TEXT_LIMIT,
  RENDERER_TRANSCRIPT_MAX_ROWS,
  RENDERER_TOOL_STRUCTURED_VALUE_LIMIT,
  RENDERER_TOOL_TEXT_LIMIT,
  projectTranscriptForRenderer,
  projectTranscriptMessageForRenderer,
} from "../../electron/selected-transcript-projection";

function tool(overrides: Partial<Extract<TranscriptMessage, { kind: "tool" }>> = {}): Extract<TranscriptMessage, { kind: "tool" }> {
  return {
    kind: "tool",
    id: "tool-1",
    callId: "tool-1",
    toolName: "bash",
    status: "success",
    label: "Ran command",
    createdAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("selected transcript renderer projection", () => {
  it("removes duplicate structured output while retaining visible output text", () => {
    const projected = projectTranscriptMessageForRenderer(tool({
      output: { content: [{ type: "text", text: "complete" }] },
      outputText: "complete",
    }));

    expect(projected).toMatchObject({ kind: "tool", outputText: "complete" });
    expect(projected).not.toHaveProperty("output");
    expect(projected).not.toHaveProperty("payloadTruncated");
  });

  it("bounds a multi-megabyte historical tool result before IPC", () => {
    const huge = "x".repeat(2_000_000);
    const projected = projectTranscriptMessageForRenderer(tool({
      input: { command: "test", nested: huge },
      output: { content: [{ type: "text", text: huge }] },
      outputText: huge,
    }));

    expect(projected).toMatchObject({
      kind: "tool",
      payloadTruncated: true,
    });
    if (projected.kind !== "tool") throw new Error("Expected tool projection");
    expect(projected.outputText?.length).toBeLessThan(RENDERER_TOOL_TEXT_LIMIT + 200);
    expect(projected.payloadSizeBytes).toBeGreaterThan(4_000_000);
    expect(projected.output).toBeUndefined();
    expect(JSON.stringify(projected.input).length).toBeLessThan(RENDERER_TOOL_STRUCTURED_VALUE_LIMIT);
    expect(JSON.stringify(projected).length).toBeLessThan(100_000);
  });

  it("keeps small write-tool output needed by the inline diff renderer", () => {
    const output = { diff: "@@ -1 +1 @@\n-old\n+new" };
    const projected = projectTranscriptMessageForRenderer(tool({
      toolName: "apply_patch",
      output,
      outputText: "updated",
    }));

    expect(projected).toMatchObject({ kind: "tool", output, outputText: "updated" });
  });

  it("bounds ordinary message text and large historical image payloads", () => {
    const projected = projectTranscriptMessageForRenderer({
      kind: "message",
      id: "message-1",
      role: "user",
      text: "t".repeat(RENDERER_MESSAGE_TEXT_LIMIT + 100_000),
      createdAt: "2026-07-30T00:00:00.000Z",
      attachments: [
        {
          kind: "image",
          mimeType: "image/png",
          name: "large.png",
          data: "a".repeat(24 * 1024 * 1024),
        },
      ],
    });

    expect(projected.kind).toBe("message");
    if (projected.kind !== "message") throw new Error("Expected message projection");
    expect(projected.text.length).toBeLessThan(RENDERER_MESSAGE_TEXT_LIMIT + 200);
    expect(projected.attachments?.[0]).toMatchObject({
      kind: "image",
      data: "",
      dataOmitted: true,
    });
  });

  it("keeps only the newest bounded renderer window and marks omitted history", () => {
    const transcript = Array.from({ length: RENDERER_TRANSCRIPT_MAX_ROWS + 50 }, (_, index): TranscriptMessage => ({
      kind: "message",
      id: `message-${index}`,
      role: "assistant",
      text: `message ${index}`,
      createdAt: "2026-07-30T00:00:00.000Z",
    }));

    const projected = projectTranscriptForRenderer(transcript);
    expect(projected).toHaveLength(RENDERER_TRANSCRIPT_MAX_ROWS + 1);
    expect(projected[0]).toMatchObject({
      kind: "summary",
      id: expect.stringContaining(":50"),
    });
    expect(projected.at(-1)?.id).toBe(`message-${transcript.length - 1}`);
  });

  it("builds a much smaller but non-empty crash-recovery window", () => {
    const transcript = Array.from({ length: RECOVERY_TRANSCRIPT_MAX_ROWS + 20 }, (_, index): TranscriptMessage => ({
      kind: "message",
      id: `recovery-${index}`,
      role: "assistant",
      text: `recovery message ${index}`,
      createdAt: "2026-08-23T00:00:00.000Z",
      ...(index === RECOVERY_TRANSCRIPT_MAX_ROWS + 19
        ? {
            attachments: [{
              kind: "image" as const,
              mimeType: "image/png",
              name: "oversized.png",
              data: "a".repeat((RECOVERY_MESSAGE_IMAGE_BYTES + 1) * 2),
            }],
          }
        : {}),
    }));

    const projected = projectTranscriptForRenderer(transcript, {
      maxRows: RECOVERY_TRANSCRIPT_MAX_ROWS,
      maxBytes: RECOVERY_TRANSCRIPT_MAX_BYTES,
      maxImageBytes: RECOVERY_MESSAGE_IMAGE_BYTES,
    });
    expect(projected.length).toBeGreaterThan(1);
    expect(projected.length).toBeLessThanOrEqual(RECOVERY_TRANSCRIPT_MAX_ROWS + 1);
    expect(projected[0]?.id).toContain("__pi-gui-omitted-history__");
    expect(projected.at(-1)).toMatchObject({ id: `recovery-${transcript.length - 1}` });
    const last = projected.at(-1);
    expect(last?.kind === "message" ? last.attachments?.[0] : undefined).toMatchObject({ dataOmitted: true, data: "" });
  });
});
