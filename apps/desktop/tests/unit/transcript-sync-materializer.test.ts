import { describe, expect, it } from "vitest";
import type { SelectedTranscriptRecord, TranscriptMessage } from "../../src/desktop-state";
import {
  applyTranscriptSyncEvent,
  createTranscriptMaterializerState,
} from "../../src/state/transcript-sync-materializer";

const message = (id: string, text = id): TranscriptMessage => ({
  kind: "message",
  id,
  role: "assistant",
  text,
  createdAt: "2026-07-09T00:00:00.000Z",
});

const selectedTranscript = (
  transcript: readonly TranscriptMessage[],
  workspaceId = "workspace-1",
  sessionId = "session-1",
): SelectedTranscriptRecord => ({
  workspaceId,
  sessionId,
  transcript,
});

describe("createTranscriptMaterializerState", () => {
  it("reuses the immutable selected transcript without another full-history copy", () => {
    const source = [message("m1")];
    const state = createTranscriptMaterializerState(selectedTranscript(source), 4);

    expect(state).toMatchObject({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sequence: 4,
      transcript: source,
      resyncing: false,
    });
    expect(state?.transcript).toBe(source);
  });

  it("keeps null selections empty", () => {
    expect(createTranscriptMaterializerState(null)).toBeNull();
  });
});

describe("applyTranscriptSyncEvent", () => {
  it("applies reset events as authoritative snapshots", () => {
    const state = createTranscriptMaterializerState(selectedTranscript([message("old")]), 7);

    const result = applyTranscriptSyncEvent(state, {
      kind: "reset",
      workspaceId: "workspace-2",
      sessionId: "session-2",
      sequence: 1,
      transcript: [message("new")],
    });

    expect(result.status).toBe("applied");
    expect(result.state).toMatchObject({
      workspaceId: "workspace-2",
      sessionId: "session-2",
      sequence: 1,
      resyncing: false,
    });
    expect(result.state.transcript.map((item) => item.id)).toEqual(["new"]);
  });

  it("appends ordered events for the current transcript", () => {
    const state = createTranscriptMaterializerState(selectedTranscript([message("m1")]), 3);

    const result = applyTranscriptSyncEvent(state, {
      kind: "append",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sequence: 4,
      items: [message("m2"), message("m3")],
    });

    expect(result.status).toBe("applied");
    expect(result.state.sequence).toBe(4);
    expect(result.state.transcript.map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps long-running append streams inside the renderer row budget", () => {
    let state = createTranscriptMaterializerState(selectedTranscript([]), 0);
    for (let sequence = 1; sequence <= 2_600; sequence += 1) {
      const result = applyTranscriptSyncEvent(state, {
        kind: "append",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        sequence,
        items: [message(`m${sequence}`)],
      });
      expect(result.status).toBe("applied");
      state = result.state;
    }

    expect(state?.transcript.length).toBeLessThanOrEqual(2_501);
    expect(state?.transcript[0]).toMatchObject({
      kind: "summary",
      id: expect.stringContaining("__pi-gui-omitted-history__"),
    });
    expect(state?.transcript.at(-1)?.id).toBe("m2600");
  });

  it("ignores non-reset events for stale selections", () => {
    const state = createTranscriptMaterializerState(selectedTranscript([message("m1")]), 3);

    const result = applyTranscriptSyncEvent(state, {
      kind: "append",
      workspaceId: "workspace-1",
      sessionId: "other-session",
      sequence: 4,
      items: [message("m2")],
    });

    expect(result).toEqual({
      status: "ignored",
      state,
    });
  });

  it("requests a reset when an event sequence skips ahead", () => {
    const state = createTranscriptMaterializerState(selectedTranscript([message("m1")]), 3);

    const result = applyTranscriptSyncEvent(state, {
      kind: "append",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sequence: 6,
      items: [message("m2")],
    });

    expect(result.status).toBe("gap");
    expect(result.state).toMatchObject({ sequence: 3, resyncing: true });
    expect(result.request).toEqual({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      expectedSequence: 4,
      reason: "gap",
    });
  });

  it("replaces the final item for streaming updates", () => {
    const state = createTranscriptMaterializerState(selectedTranscript([
      message("m1"),
      message("stream", "partial"),
    ]), 4);

    const result = applyTranscriptSyncEvent(state, {
      kind: "update-last",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sequence: 5,
      item: message("stream", "complete"),
    });

    expect(result.status).toBe("applied");
    expect(result.state.transcript.map((item) => item.id)).toEqual(["m1", "stream"]);
    expect(result.state.transcript.at(-1)).toMatchObject({ text: "complete" });
  });

  it("truncates by a stable item id", () => {
    const state = createTranscriptMaterializerState(selectedTranscript([
      message("m1"),
      message("m2"),
      message("m3"),
    ]), 5);

    const result = applyTranscriptSyncEvent(state, {
      kind: "truncate",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sequence: 6,
      afterItemId: "m2",
    });

    expect(result.status).toBe("applied");
    expect(result.state.transcript.map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("requests a reset when a truncate anchor is missing", () => {
    const state = createTranscriptMaterializerState(selectedTranscript([message("m1")]), 5);

    const result = applyTranscriptSyncEvent(state, {
      kind: "truncate",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sequence: 6,
      afterItemId: "missing",
    });

    expect(result.status).toBe("gap");
    expect(result.request).toMatchObject({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      expectedSequence: 6,
      reason: "gap",
    });
  });
});
