import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../../src/desktop-state";
import { SessionStateMap } from "../../electron/session-state-map";

function transcript(id: string, size: number): TranscriptMessage[] {
  return [{
    kind: "message",
    id,
    role: "assistant",
    text: "x".repeat(size),
    createdAt: "2026-07-30T00:00:00.000Z",
  }];
}

describe("SessionStateMap transcript cache", () => {
  it("evicts old dormant histories while protecting the selected task", () => {
    const state = new SessionStateMap();
    state.transcriptCache.set("old-1", transcript("old-1", 2_000));
    state.transcriptCache.set("selected", transcript("selected", 2_000));
    state.transcriptCache.set("old-2", transcript("old-2", 2_000));
    state.loadedTranscriptKeys.add("old-1");
    state.loadedTranscriptKeys.add("selected");
    state.loadedTranscriptKeys.add("old-2");

    const evicted = state.pruneTranscriptCache(new Set(["selected"]), 2, Number.POSITIVE_INFINITY);

    expect(evicted).toEqual(["old-1"]);
    expect(state.transcriptCache.has("selected")).toBe(true);
    expect(state.loadedTranscriptKeys.has("old-1")).toBe(false);
  });
});
