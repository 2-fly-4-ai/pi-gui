import { describe, expect, it } from "vitest";
import { searchSettings } from "../../src/product-experience/settings-search";

describe("natural-language settings search", () => {
  it.each([
    ["make text bigger", "appearance-density"],
    ["subagent model", "agents-model"],
    ["turn off crash reports", "general-crash-reports"],
  ])("maps %s to the exact curated control", (query, id) => {
    expect(searchSettings(query)[0]?.id).toBe(id);
  });

  it("stays local, deterministic, and empty for unrelated queries", () => {
    expect(searchSettings("quantum sandwich")).toEqual([]);
    expect(searchSettings("default model")).toEqual(searchSettings("default model"));
  });
});
