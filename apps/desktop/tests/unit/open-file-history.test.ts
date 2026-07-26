import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pruneOpenFileHistory,
  readOpenFileHistory,
  recordOpenedFile,
} from "../../src/open-file-history";

describe("open file history", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("records only explicit events and keeps the latest location per workspace path", () => {
    recordOpenedFile({ workspaceId: "w", path: "src/a.ts", line: 3, source: "timeline" });
    recordOpenedFile({ workspaceId: "w", path: "src/a.ts", line: 9, source: "review" });
    expect(readOpenFileHistory("w")).toMatchObject([{
      path: "src/a.ts",
      line: 9,
      source: "review",
    }]);
  });

  it("prunes paths that no longer exist without touching another workspace", () => {
    recordOpenedFile({ workspaceId: "w", path: "gone.ts", source: "changes" });
    recordOpenedFile({ workspaceId: "other", path: "keep.ts", source: "changes" });
    pruneOpenFileHistory("w", new Set());
    expect(readOpenFileHistory()).toMatchObject([{ workspaceId: "other", path: "keep.ts" }]);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}
