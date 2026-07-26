import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../../src/desktop-state";
import {
  formatPreviewText,
  previewFromTranscript,
  restorePersistedQueuedComposerMessages,
  toSessionQueuedMessages,
} from "../../electron/app-store-utils";

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

describe("queued composer persistence", () => {
  it("recovers valid and malformed items without sending stale entries back to the runtime", () => {
    const restored = restorePersistedQueuedComposerMessages([
      {
        id: "valid",
        mode: "steer",
        text: "Keep my context",
        metadata: { contextManifestSnapshotId: "context-1" },
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:01.000Z",
      },
      { id: "malformed", mode: "unknown" },
    ]);

    expect(restored).toMatchObject([
      {
        id: "valid",
        mode: "steer",
        recoveryState: "stale",
        metadata: { contextManifestSnapshotId: "context-1" },
      },
      {
        id: "malformed",
        mode: "followUp",
        recoveryState: "invalid",
      },
    ]);
    expect(toSessionQueuedMessages(restored)).toEqual([]);
  });

  it("retains an artifact reference version when a queued message is recovered", () => {
    const [restored] = restorePersistedQueuedComposerMessages([{
      id: "artifact-message",
      mode: "followUp",
      text: "Review this artifact",
      attachments: [{
        id: "artifact",
        kind: "file",
        name: "report.md",
        mimeType: "text/markdown",
        fsPath: "/workspace/reports/report.md",
        sizeBytes: 42,
        source: "workspace-reference",
        status: "ready",
        artifactReference: {
          workspaceId: "workspace",
          relativePath: "reports/report.md",
          observedAt: "2026-07-25T00:00:00.000Z",
          version: {
            sizeBytes: 42,
            modifiedAt: "2026-07-25T00:00:00.000Z",
          },
          sensitivity: "normal",
          includeInHandoff: false,
        },
      }],
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    }]);

    expect(restored?.attachments[0]).toMatchObject({
      artifactReference: {
        workspaceId: "workspace",
        relativePath: "reports/report.md",
        version: {
          sizeBytes: 42,
          modifiedAt: "2026-07-25T00:00:00.000Z",
        },
      },
    });
  });
});
