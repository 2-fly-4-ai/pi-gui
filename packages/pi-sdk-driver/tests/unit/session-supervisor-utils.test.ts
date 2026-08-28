import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  createWorkspaceRef,
  determineRunOutcome,
  forcePersistSession,
  injectFileAttachmentPreamble,
  messageText,
  mergeSessionConfigWithToolAccess,
  normalizeLegacyAssistantMessage,
  sessionKey,
  toSessionErrorInfo,
  transcriptFromMessages,
} from "../../src/session-supervisor-utils";
import { mergeReplaceableDriverEvent } from "../../src/session-supervisor";

describe("session-supervisor utilities", () => {
  it("coalesces adjacent replaceable stream events without folding lifecycle boundaries", () => {
    const sessionRef = { workspaceId: "w1", sessionId: "s1" };
    expect(mergeReplaceableDriverEvent(
      {
        type: "assistantDelta",
        sessionRef,
        runId: "run-1",
        timestamp: "2026-07-30T00:00:00.000Z",
        text: "hello ",
      },
      {
        type: "assistantDelta",
        sessionRef,
        runId: "run-1",
        timestamp: "2026-07-30T00:00:00.010Z",
        text: "world",
      },
    )).toMatchObject({
      type: "assistantDelta",
      text: "hello world",
      timestamp: "2026-07-30T00:00:00.010Z",
    });
    expect(mergeReplaceableDriverEvent(
      {
        type: "toolStarted",
        sessionRef,
        runId: "run-1",
        timestamp: "2026-07-30T00:00:00.020Z",
        toolName: "read",
        callId: "call-1",
      },
      {
        type: "toolFinished",
        sessionRef,
        runId: "run-1",
        timestamp: "2026-07-30T00:00:00.030Z",
        callId: "call-1",
        success: true,
      },
    )).toBeUndefined();
  });

  it("builds snapshots with defensive copies and derived titles", () => {
    const snapshot = buildSnapshot({
      ref: { workspaceId: "w1", sessionId: "s1" },
      workspace: { workspaceId: "w1", path: "/repo/pi-gui", displayName: "" },
      title: " ",
      status: "idle",
      updatedAt: "2026-07-08T00:00:00.000Z",
      archivedAt: undefined,
      preview: "Preview",
      config: undefined,
      runningRunId: undefined,
      queuedMessages: [],
      runtimeSummary: undefined,
    });

    expect(snapshot.title).toBe("pi-gui");
    expect(snapshot.ref).toEqual({ workspaceId: "w1", sessionId: "s1" });
    expect(snapshot.workspace).toEqual({ workspaceId: "w1", path: "/repo/pi-gui", displayName: "" });
  });

  it("merges model/thinking config while preserving tool access", () => {
    expect(mergeSessionConfigWithToolAccess(
      { toolAccess: { mode: "read-only" } },
      { model: { provider: "openai", modelId: "gpt-5" }, thinkingLevel: "high" },
    )).toEqual({
      provider: "openai",
      modelId: "gpt-5",
      thinkingLevel: "high",
      toolAccess: { mode: "read-only" },
    });
  });

  it("formats stable workspace and session keys", () => {
    expect(createWorkspaceRef("/repo/pi-gui", "pi-gui")).toEqual({
      workspaceId: "/repo/pi-gui",
      path: "/repo/pi-gui",
      displayName: "pi-gui",
    });
    expect(sessionKey({ workspaceId: "w1", sessionId: "s1" })).toBe("w1:s1");
  });

  it("keeps Pi's delayed flush state aligned after eagerly persisting a new thread", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-gui-session-flush-"));
    try {
      const sessionManager = SessionManager.create(workspace);
      sessionManager.appendSessionInfo("New thread");
      forcePersistSession(sessionManager);
      expect(() => sessionManager.appendMessage({
        role: "assistant",
        content: [],
      } as never)).not.toThrow();

      const sessionFile = sessionManager.getSessionFile();
      expect(sessionFile).toBeTruthy();
      expect((await readFile(sessionFile!, "utf8")).trim().split("\n")).toHaveLength(3);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("detects failed run outcomes from assistant stop reasons", () => {
    expect(determineRunOutcome([
      { role: "assistant", stopReason: "error", errorMessage: "Tool failed" },
    ])).toEqual({
      success: false,
      error: { message: "Tool failed", code: "ERROR" },
    });
    expect(determineRunOutcome([{ role: "assistant", content: "Done" }])).toEqual({ success: true });
  });

  it("serializes file attachments into user transcript messages", () => {
    const text = injectFileAttachmentPreamble("Please inspect this.", [
      {
        kind: "file",
        id: "file-1",
        name: "app.ts",
        mimeType: "text/typescript",
        fsPath: "/repo/app.ts",
        sizeBytes: 42,
      },
    ]);

    expect(messageText({ role: "user", content: text })).toBe("Please inspect this.");
    expect(transcriptFromMessages([
      { role: "user", id: "u1", createdAt: "2026-07-08T00:00:00.000Z", content: text },
    ])).toEqual([
      {
        kind: "message",
        id: "u1",
        role: "user",
        text: "Please inspect this.",
        attachments: [
          {
            kind: "file",
            name: "app.ts",
            mimeType: "text/typescript",
            fsPath: "/repo/app.ts",
            sizeBytes: 42,
          },
        ],
        createdAt: "2026-07-08T00:00:00.000Z",
      },
    ]);
  });

  it("splits assistant thinking and text content into transcript entries", () => {
    expect(transcriptFromMessages([
      {
        role: "assistant",
        id: "a1",
        createdAt: "2026-07-08T00:00:00.000Z",
        content: [
          { type: "text", text: "First answer" },
          { type: "thinking", thinking: "Reasoning" },
          { type: "text", text: "Final answer" },
        ],
      },
    ])).toEqual([
      {
        kind: "thinking",
        id: "a1:thinking-0",
        text: "Reasoning",
        createdAt: "2026-07-08T00:00:00.000Z",
        status: "done",
      },
      {
        kind: "message",
        id: "a1",
        role: "assistant",
        text: "First answer Final answer",
        createdAt: "2026-07-08T00:00:00.000Z",
      },
    ]);
  });

  it("normalizes errors into session error info", () => {
    expect(toSessionErrorInfo(new Error("Boom"), "RUN_FAILED")).toMatchObject({
      message: "Boom",
      code: "RUN_FAILED",
      details: { name: "Error" },
    });
  });

  it("normalizes legacy assistant records without rewriting valid usage", () => {
    const legacyMessage: Record<string, unknown> = {
      role: "assistant",
      content: "Legacy answer",
      timestamp: 123,
      usage: {
        input: 5,
        output: 3,
      },
    };
    expect(normalizeLegacyAssistantMessage(legacyMessage, {
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.5",
    })).toBe(true);
    expect(legacyMessage).toMatchObject({
      content: [{ type: "text", text: "Legacy answer" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.5",
      stopReason: "stop",
      usage: {
        input: 5,
        output: 3,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 8,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
    });
    expect(normalizeLegacyAssistantMessage(legacyMessage)).toBe(false);
  });
});
