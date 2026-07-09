import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../../src/desktop-state";
import { formatPreviewText, previewFromTranscript } from "../../electron/app-store-utils";

const assistantMessage = (id: string, text: string): TranscriptMessage => ({
  kind: "message",
  id,
  role: "assistant",
  text,
  createdAt: `2026-07-09T00:00:0${id}.000Z`,
});

const userMessage = (id: string, text: string): TranscriptMessage => ({
  kind: "message",
  id,
  role: "user",
  text,
  createdAt: `2026-07-09T00:00:0${id}.000Z`,
});

describe("formatPreviewText", () => {
  it("turns common markdown into plain preview text", () => {
    expect(formatPreviewText("## Plan\n\n- [ ] Inspect `src/App.tsx`\n- Use [docs](https://example.com)")).toBe(
      "Plan Inspect src/App.tsx Use docs",
    );
  });

  it("drops empty markdown fence lines", () => {
    expect(formatPreviewText("```ts\nconst value = 1;\n```")).toBe("const value = 1;");
  });
});

describe("previewFromTranscript", () => {
  it("prefers the latest assistant message with markdown stripped", () => {
    const preview = previewFromTranscript([
      userMessage("1", "Please write a plan"),
      assistantMessage("2", "## Implementation Plan\n\n1. Update `src/sidebar.tsx`\n2. Verify"),
    ]);

    expect(preview).toBe("Implementation Plan Update src/sidebar.tsx Verify");
  });

  it("falls back past empty markdown-only assistant messages", () => {
    const preview = previewFromTranscript([
      userMessage("1", "Initial request"),
      assistantMessage("2", "# Previous answer"),
      assistantMessage("3", "```"),
    ]);

    expect(preview).toBe("Previous answer");
  });
});
